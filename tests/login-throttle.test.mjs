import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  LOGIN_POLICY,
  accountLockMs,
  evaluateLoginAttempt,
  attemptsRemaining,
  describeRetryAfter,
  describeThrottle,
  invalidCredentialsMessage,
  isNewSignInDevice,
  loginAlertEmail,
} from "../lib/core/login-throttle.mjs";
import { escapeHtml } from "../lib/core/security.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);

// ---------------------------------------------------------------------------
// THE DEFECT: staff sign-in was unthrottled AND unlogged. A script could try a
// million passwords against the owner account — the account that controls
// payouts — and the business would never know it had happened.
// ---------------------------------------------------------------------------

test("a normal sign-in is ALLOWED, including after a couple of typos", () => {
  assert.deepEqual(evaluateLoginAttempt({ accountFailures: 0, ipFailures: 0, now: NOW }), {
    allowed: true,
    reason: null,
    retryAfterSeconds: 0,
  });
  // Four failures is under the threshold: somebody who mistypes must still get in.
  assert.equal(
    evaluateLoginAttempt({ accountFailures: 4, lastAccountFailureAt: NOW - 1000, now: NOW })
      .allowed,
    true,
  );
  assert.equal(attemptsRemaining(4), 1);
  assert.equal(attemptsRemaining(0), LOGIN_POLICY.accountMaxFailures);
});

test("the fifth failure LOCKS the account, and the lock expires on its own", () => {
  const locked = evaluateLoginAttempt({ accountFailures: 5, lastAccountFailureAt: NOW, now: NOW });
  assert.equal(locked.allowed, false);
  assert.equal(locked.reason, "account_locked");
  assert.equal(locked.retryAfterSeconds, LOGIN_POLICY.accountBaseLockMs / 1000);

  // One second after the window, the same failure count no longer blocks: a
  // permanent lock is a denial-of-service anyone can trigger on a rival.
  const later = evaluateLoginAttempt({
    accountFailures: 5,
    lastAccountFailureAt: NOW,
    now: NOW + LOGIN_POLICY.accountBaseLockMs + 1000,
  });
  assert.equal(later.allowed, true);
});

test("the lock escalates with persistence and then stops escalating", () => {
  assert.equal(accountLockMs(4), 0);
  assert.equal(accountLockMs(5), 5 * 60_000);
  assert.equal(accountLockMs(10), 10 * 60_000);
  assert.equal(accountLockMs(15), 20 * 60_000);
  assert.equal(accountLockMs(20), 40 * 60_000);
  assert.equal(accountLockMs(25), 60 * 60_000);
  assert.equal(
    accountLockMs(1000),
    LOGIN_POLICY.accountMaxLockMs,
    "capped, so a lock can never become permanent",
  );
});

test("a password spray across many accounts is stopped by the NETWORK gate", () => {
  // The account gate alone would never fire here: one attempt per account.
  const spray = evaluateLoginAttempt({
    accountFailures: 1,
    ipFailures: 20,
    lastIpFailureAt: NOW,
    now: NOW,
  });
  assert.equal(spray.allowed, false);
  assert.equal(spray.reason, "network_locked");
  assert.equal(spray.retryAfterSeconds, LOGIN_POLICY.ipLockMs / 1000);

  // Under the network threshold, an innocent office behind one NAT still works.
  assert.equal(
    evaluateLoginAttempt({ accountFailures: 1, ipFailures: 19, lastIpFailureAt: NOW, now: NOW })
      .allowed,
    true,
  );
});

test("the network gate is checked FIRST, so a spray is named as a spray", () => {
  const both = evaluateLoginAttempt({
    accountFailures: 5,
    lastAccountFailureAt: NOW,
    ipFailures: 20,
    lastIpFailureAt: NOW,
    now: NOW,
  });
  assert.equal(both.reason, "network_locked");
});

test("counts with no timestamp cannot lock anyone out for ever", () => {
  // A null last-failure means the window cannot be computed. Refusing on that
  // basis would lock an account until somebody edited the database.
  assert.equal(
    evaluateLoginAttempt({ accountFailures: 99, lastAccountFailureAt: null, now: NOW }).allowed,
    true,
  );
  assert.equal(
    evaluateLoginAttempt({ ipFailures: 99, lastIpFailureAt: null, now: NOW }).allowed,
    true,
  );
});

test("no message ever reveals whether the account exists", () => {
  for (const locale of ["en", "he"]) {
    const wrong = invalidCredentialsMessage(locale);
    assert.ok(wrong.length > 5);
    assert.ok(
      !/exist|registered|unknown|לא נמצא|קיים/.test(wrong),
      `"${wrong}" must not disclose account existence`,
    );
    const throttled = describeThrottle("account_locked", 300, locale);
    assert.ok(!/exist|registered|לא נמצא/.test(throttled));
    assert.ok(
      describeThrottle("network_locked", 300, locale) !== throttled,
      "the two reasons read differently",
    );
  }
});

test("retry delays read as time, not as seconds-since-epoch", () => {
  assert.equal(describeRetryAfter(1), "1 second");
  assert.equal(describeRetryAfter(45), "45 seconds");
  assert.equal(describeRetryAfter(60), "1 minute");
  assert.equal(describeRetryAfter(300), "5 minutes");
  assert.equal(describeRetryAfter(0), "1 second", "never say zero: it invites an immediate retry");
  assert.match(describeRetryAfter(300, "he"), /דקות/);
});

test("a FIRST-EVER sign-in does not alert on itself", () => {
  // Alerting on the first sign-in trains people to ignore the alert, which is
  // how a real one gets missed.
  assert.equal(isNewSignInDevice("Chrome on Mac|203.0.113.0/24", []), false);
  assert.equal(isNewSignInDevice("Chrome on Mac|203.0.113.0/24", null), false);
  assert.equal(isNewSignInDevice("", ["Chrome on Mac|203.0.113.0/24"]), false);
});

test("a genuinely new device DOES alert, and a known one does not", () => {
  const known = ["Chrome on Mac|203.0.113.0/24", "Safari on iPhone|198.51.100.0/24"];
  assert.equal(isNewSignInDevice("Chrome on Mac|203.0.113.0/24", known), false);
  assert.equal(isNewSignInDevice("Firefox on Windows|192.0.2.0/24", known), true);
  assert.equal(
    isNewSignInDevice("Chrome on Mac|192.0.2.0/24", known),
    true,
    "same browser, different country",
  );
});

test("the alert email escapes what it interpolates and links to the security page", () => {
  const alert = loginAlertEmail({
    locale: "en",
    device: `Chrome <script>alert("x")</script>`,
    ip: "203.0.113.9",
    at: "Fri, 31 Jul 2026 12:00:00 GMT",
    appUrl: "https://app.servicepro.test/",
    escape: escapeHtml,
  });
  assert.match(alert.subject, /New sign-in/);
  assert.ok(!alert.html.includes("<script>"), "a user agent is attacker-controlled text");
  assert.ok(alert.html.includes("&lt;script&gt;"));
  assert.ok(alert.html.includes("https://app.servicepro.test/settings/security"));
  assert.ok(alert.html.includes("203.0.113.9"));
  assert.ok(alert.text.includes("203.0.113.9"));

  const he = loginAlertEmail({
    locale: "he",
    device: "Chrome on Mac",
    ip: null,
    at: "x",
    appUrl: "",
  });
  assert.notEqual(he.subject, alert.subject, "the alert is written in the person's language");
  assert.ok(!he.html.includes("href"), "no link is offered when no app URL is configured");
});

// ---------------------------------------------------------------------------
// Structural: the gate has to be in the sign-in path.
// ---------------------------------------------------------------------------
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

test("sign-in happens on the server and is both throttled and recorded", () => {
  const action = strip(readFileSync(join(root, "app/login/actions.ts"), "utf8"));
  assert.match(action, /^"use server"/m);
  assert.ok(action.includes("evaluateLoginAttempt"), "the durable gate must be consulted");
  assert.ok(
    action.includes("login_throttle_counts"),
    "counts come from Postgres, not from process memory alone",
  );
  assert.ok(action.includes("record_login_attempt"), "every attempt is recorded");
  assert.ok(action.includes("consume("), "and the cheap in-process gate still absorbs a flood");
  assert.ok(
    action.includes("invalidCredentialsMessage"),
    "failures must not disclose account existence",
  );
});

test("the login form no longer calls Supabase from the browser", () => {
  const form = strip(readFileSync(join(root, "app/login/LoginForm.tsx"), "utf8"));
  assert.ok(
    !form.includes("signInWithPassword"),
    "the browser cannot throttle, record or alert on itself",
  );
  assert.ok(form.includes("signIn"), "it posts to the server action");
  assert.ok(form.includes("verifyTwoFactor"), "and carries the second-factor step");
});

test("the limiter's per-instance caveat is respected rather than ignored", () => {
  const limiter = readFileSync(join(root, "lib/core/rate-limit.mjs"), "utf8");
  assert.match(
    limiter,
    /NOT a distributed[\s\S]{0,8}limiter/,
    "the honest note must still be there",
  );
  const policy = readFileSync(join(root, "lib/core/login-throttle.mjs"), "utf8");
  assert.match(policy, /per-instance/, "and the login policy must acknowledge it");
});
