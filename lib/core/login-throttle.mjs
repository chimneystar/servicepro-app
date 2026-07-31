// Brute-force policy for staff sign-in.
//
// THE DEFECT THIS FIXES: `app/login/LoginForm.tsx` called
// supabase.auth.signInWithPassword straight from the browser. There was no
// throttle, no lockout, and no record — a script could try a million passwords
// against an owner account and the business would never know it had happened.
//
// TWO GATES, ON PURPOSE:
//   * the per-account gate stops the password of one known user being guessed;
//   * the per-network gate stops one host spraying one password across every
//     account in the business.
// Neither alone is sufficient, and the account gate alone is a denial-of-service
// vector (lock a rival out by failing on their address), which is why the
// account lock is short and escalating rather than permanent.
//
// SCOPE NOTE, honestly: lib/core/rate-limit.mjs is per-instance and says so.
// This policy is evaluated against counts read from Postgres, so it holds
// across serverless instances. The in-process limiter is still used in front of
// it as a cheap first gate — it costs no round trip and absorbs a flood before
// the database sees it — but the DURABLE decision is this one.
//
// Tests: tests/login-throttle.test.mjs

export const LOGIN_POLICY = {
  /** Failures counted within this window, per account. */
  accountWindowMs: 15 * 60_000,
  /** Failures allowed before the account is locked. */
  accountMaxFailures: 5,
  /** First lock length; doubles for each further tier, capped. */
  accountBaseLockMs: 5 * 60_000,
  accountMaxLockMs: 60 * 60_000,
  /** Failures counted within this window, per network prefix. */
  ipWindowMs: 15 * 60_000,
  ipMaxFailures: 20,
  ipLockMs: 15 * 60_000,
};

/**
 * How long an account is locked after `failures` failures.
 * 5 -> 5 min, 10 -> 10 min, 15 -> 20 min, 20 -> 40 min, 25+ -> 60 min (cap).
 * Returns 0 while the account is still under the threshold.
 */
export function accountLockMs(failures, policy = LOGIN_POLICY) {
  const tier = Math.floor(Number(failures ?? 0) / policy.accountMaxFailures);
  if (tier < 1) return 0;
  return Math.min(policy.accountBaseLockMs * 2 ** (tier - 1), policy.accountMaxLockMs);
}

/**
 * Decide whether a sign-in attempt may proceed.
 *
 * @param {object} input
 * @param {number} input.accountFailures  consecutive failures for this email inside the window
 * @param {number} input.ipFailures       failures from this network inside the window
 * @param {number|null} [input.lastAccountFailureAt] epoch ms of the most recent account failure
 * @param {number|null} [input.lastIpFailureAt]      epoch ms of the most recent network failure
 * @param {number} input.now
 * @returns {{ allowed: boolean, reason: string|null, retryAfterSeconds: number }}
 */
export function evaluateLoginAttempt(input, policy = LOGIN_POLICY) {
  const now = Number(input?.now ?? Date.now());
  const accountFailures = Math.max(0, Number(input?.accountFailures ?? 0));
  const ipFailures = Math.max(0, Number(input?.ipFailures ?? 0));
  const lastAccount = input?.lastAccountFailureAt == null ? null : Number(input.lastAccountFailureAt);
  const lastIp = input?.lastIpFailureAt == null ? null : Number(input.lastIpFailureAt);

  const allowed = { allowed: true, reason: null, retryAfterSeconds: 0 };

  // Network gate first: a spray attack should not have to hit an account
  // threshold before it is stopped.
  if (ipFailures >= policy.ipMaxFailures && lastIp != null) {
    const until = lastIp + policy.ipLockMs;
    if (until > now) {
      return { allowed: false, reason: "network_locked", retryAfterSeconds: Math.ceil((until - now) / 1000) };
    }
  }

  const lockMs = accountLockMs(accountFailures, policy);
  if (lockMs > 0 && lastAccount != null) {
    const until = lastAccount + lockMs;
    if (until > now) {
      return { allowed: false, reason: "account_locked", retryAfterSeconds: Math.ceil((until - now) / 1000) };
    }
  }

  return allowed;
}

/** Attempts remaining before the account locks — shown to the person, not to a guesser. */
export function attemptsRemaining(accountFailures, policy = LOGIN_POLICY) {
  const used = Math.max(0, Number(accountFailures ?? 0)) % policy.accountMaxFailures;
  return policy.accountMaxFailures - used;
}

/** A retry delay in words. */
export function describeRetryAfter(seconds, locale = "en") {
  const total = Math.max(1, Math.ceil(Number(seconds ?? 0)));
  const minutes = Math.ceil(total / 60);
  if (locale === "he") return total < 60 ? `${total} שניות` : `${minutes} דקות`;
  if (total < 60) return `${total} second${total === 1 ? "" : "s"}`;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** The message a throttled sign-in gets. It never says whether the account exists. */
export function describeThrottle(reason, retryAfterSeconds, locale = "en") {
  const wait = describeRetryAfter(retryAfterSeconds, locale);
  if (locale === "he") {
    return reason === "network_locked"
      ? `יותר מדי ניסיונות התחברות מהרשת הזו. נסו שוב בעוד ${wait}.`
      : `יותר מדי ניסיונות התחברות כושלים. נסו שוב בעוד ${wait}, או אפסו את הסיסמה.`;
  }
  return reason === "network_locked"
    ? `Too many sign-in attempts from this network. Try again in ${wait}.`
    : `Too many failed sign-in attempts. Try again in ${wait}, or reset your password.`;
}

/**
 * A failed sign-in must not reveal whether the address is registered.
 * One sentence for every wrong-credential outcome.
 */
export function invalidCredentialsMessage(locale = "en") {
  return locale === "he"
    ? "האימייל או הסיסמה אינם נכונים."
    : "That email or password is not correct.";
}

/**
 * Whether this sign-in came from somewhere the account has not been seen
 * before. An empty history is NOT "new" — the first ever sign-in would
 * otherwise alert on itself, training people to ignore the alert.
 */
export function isNewSignInDevice(signature, knownSignatures) {
  const known = Array.isArray(knownSignatures) ? knownSignatures.filter(Boolean) : [];
  if (!signature || known.length === 0) return false;
  return !known.includes(signature);
}

/** Login alert email. Untrusted values are escaped by the caller's escapeHtml. */
export function loginAlertEmail({ locale = "en", device, ip, at, appUrl, escape = (value) => String(value ?? "") }) {
  const he = locale === "he";
  const when = String(at ?? "");
  const where = ip ? `${escape(device)} · ${escape(ip)}` : escape(device);
  const securityUrl = appUrl ? `${String(appUrl).replace(/\/$/, "")}/settings/security` : null;
  const subject = he ? "התחברות חדשה לחשבון שלך" : "New sign-in to your account";
  const lines = he
    ? [
        "זוהתה התחברות לחשבון שלך ממכשיר או רשת שלא ראינו קודם.",
        `מתי: ${escape(when)}`,
        `מאיפה: ${where}`,
        "אם זה הייתם אתם — אין מה לעשות. אם לא, שנו סיסמה מיד ונתקו את כל המכשירים.",
      ]
    : [
        "Your account was signed in to from a device or network we have not seen before.",
        `When: ${escape(when)}`,
        `Where: ${where}`,
        "If this was you, nothing to do. If it was not, change your password now and sign out every device.",
      ];
  const link = securityUrl
    ? `<p><a href="${securityUrl}">${he ? "פתחו את הגדרות האבטחה" : "Open security settings"}</a></p>`
    : "";
  const html = `<div><h2>${subject}</h2>${lines.map((line) => `<p>${line}</p>`).join("")}${link}</div>`;
  return { subject, html, text: lines.join("\n") };
}
