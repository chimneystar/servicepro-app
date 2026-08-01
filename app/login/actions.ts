"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { getLocale } from "@/lib/locale-server";
import { getRequestContext, contextColumns, type RequestContext } from "@/lib/request-context";
import { appUrl, providers, sendEmail } from "@/lib/providers";
// @ts-ignore -- pure logic, proven both ways in tests/rate-limit.test.mjs
import { consume } from "@/lib/core/rate-limit.mjs";
// @ts-ignore -- pure logic, proven both ways in tests/login-throttle.test.mjs
import {
  LOGIN_POLICY,
  evaluateLoginAttempt,
  describeThrottle,
  invalidCredentialsMessage,
  isNewSignInDevice,
  loginAlertEmail,
} from "@/lib/core/login-throttle.mjs";
// @ts-ignore -- pure logic, proven both ways in tests/security.test.mjs
import { escapeHtml } from "@/lib/core/security.mjs";

export type LoginState = {
  ok: boolean;
  error?: string;
  notice?: string;
  /** The password was right but a second factor is required to finish. */
  mfaRequired?: boolean;
  factorId?: string;
};

type Locale = "en" | "he";

/**
 * Staff sign-in, moved to the server.
 *
 * THE DEFECT: `LoginForm.tsx` called supabase.auth.signInWithPassword straight
 * from the browser, so there was no throttle, no lockout, no record and no
 * possible alert. Password guessing against an owner account — the account that
 * controls payouts and every customer record — was unlimited and invisible.
 *
 * Two gates, in order of cost:
 *   1. lib/core/rate-limit.mjs, in process. Free, absorbs a flood, and honest
 *      about being per-instance.
 *   2. counts read from Postgres via login_throttle_counts(). This one holds
 *      across serverless instances and is the gate that actually decides.
 *
 * Neither the throttle message nor the failure message ever reveals whether the
 * address is registered.
 */
export async function signIn(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const locale = ((await getLocale()) === "he" ? "he" : "en") as Locale;
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { ok: false, error: invalidCredentialsMessage(locale) };

  const context = await getRequestContext();
  const callerKey = context.ip ?? "unknown";

  // Gate 1 — in process. Deliberately generous: it exists to stop a flood, not
  // to be the policy.
  const burst = consume(`login:ip:${callerKey}`, 30, 60_000);
  const perAccount = consume(`login:account:${email}`, 15, 60_000);
  if (!burst.allowed || !perAccount.allowed) {
    const retry = Math.max(burst.retryAfterSeconds, perAccount.retryAfterSeconds);
    return {
      ok: false,
      error: describeThrottle(burst.allowed ? "account_locked" : "network_locked", retry, locale),
    };
  }

  const admin = adminOrNull();

  // Gate 2 — durable, in the database.
  if (admin) {
    const { data: counts } = await admin.rpc("login_throttle_counts", {
      p_email: email,
      p_network: context.network,
      p_window_minutes: Math.round(LOGIN_POLICY.accountWindowMs / 60_000),
    });
    const verdict = evaluateLoginAttempt({
      accountFailures: Number((counts as any)?.account_failures ?? 0),
      ipFailures: Number((counts as any)?.ip_failures ?? 0),
      lastAccountFailureAt: toEpoch((counts as any)?.last_account_failure_at),
      lastIpFailureAt: toEpoch((counts as any)?.last_ip_failure_at),
      now: Date.now(),
    });
    if (!verdict.allowed) {
      await recordAttempt(admin, email, false, `throttled:${verdict.reason}`, context);
      return {
        ok: false,
        error: describeThrottle(verdict.reason, verdict.retryAfterSeconds, locale),
      };
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data?.user) {
    if (admin)
      await recordAttempt(admin, email, false, error?.message ?? "invalid_credentials", context);
    return { ok: false, error: invalidCredentialsMessage(locale) };
  }

  if (admin) await recordAttempt(admin, email, true, null, context);

  // A verified second factor means the password alone has not finished the job.
  const mfa = await pendingSecondFactor(supabase);
  if (mfa) {
    await recordSecurityEvent(admin, data.user.id, "mfa_challenge_required", context, null);
    return { ok: true, mfaRequired: true, factorId: mfa };
  }

  await afterSuccessfulSignIn(admin, data.user.id, email, context, locale);
  return { ok: true };
}

/**
 * Second step of a two-factor sign-in. The session already exists at aal1; a
 * correct code raises it to aal2.
 */
export async function verifyTwoFactor(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const locale = ((await getLocale()) === "he" ? "he" : "en") as Locale;
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  const factorId = String(formData.get("factorId") ?? "");
  if (!factorId || code.length < 6) {
    return {
      ok: false,
      mfaRequired: true,
      factorId,
      error: locale === "he" ? "הזינו את הקוד בן שש הספרות." : "Enter the six-digit code.",
    };
  }

  const context = await getRequestContext();
  // A code is six digits: guessing is cheap unless it is throttled.
  const gate = consume(`mfa:${context.ip ?? "unknown"}:${factorId}`, 10, 300_000);
  if (!gate.allowed) {
    return {
      ok: false,
      mfaRequired: true,
      factorId,
      error: describeThrottle("account_locked", gate.retryAfterSeconds, locale),
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  const admin = adminOrNull();

  if (error) {
    if (user)
      await recordSecurityEvent(admin, user.id, "mfa_challenge_failed", context, {
        reason: error.message?.slice(0, 200) ?? null,
      });
    return {
      ok: false,
      mfaRequired: true,
      factorId,
      error:
        locale === "he"
          ? "הקוד אינו נכון או שפג תוקפו."
          : "That code is not correct, or it has expired.",
    };
  }

  if (user) {
    await recordSecurityEvent(admin, user.id, "mfa_challenge_passed", context, null);
    await afterSuccessfulSignIn(admin, user.id, user.email ?? "", context, locale);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function adminOrNull() {
  // SUPABASE_SERVICE_ROLE_KEY is validated as REQUIRED by lib/core/env-check.mjs.
  // If it is nevertheless absent the throttle degrades to the in-process gate
  // rather than locking every member of the business out of their own app.
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

function toEpoch(value: unknown): number | null {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

async function recordAttempt(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
  success: boolean,
  reason: string | null,
  context: RequestContext,
) {
  try {
    await admin.rpc("record_login_attempt", {
      p_email: email,
      p_success: success,
      p_reason: reason,
      p_ip: context.ip,
      p_ip_source: context.ipSource,
      p_ip_trusted: context.ipTrusted,
      p_network: context.network,
      p_user_agent: context.userAgent,
      p_device: context.device,
    });
  } catch {
    // Never let the audit write stop a legitimate sign-in.
  }
}

async function recordSecurityEvent(
  admin: ReturnType<typeof createAdminClient> | null,
  profileId: string,
  eventType: string,
  context: RequestContext,
  // `details` lands in a jsonb column, so it is bounded by what JSON can hold.
  details: Json,
) {
  if (!admin) return;
  try {
    const { data: profile } = await admin
      .from("profiles")
      .select("organization_id")
      .eq("id", profileId)
      .maybeSingle();
    await admin.from("account_security_events").insert({
      organization_id: profile?.organization_id ?? null,
      profile_id: profileId,
      event_type: eventType,
      details,
      ...contextColumns(context),
    });
  } catch {
    /* audit only */
  }
}

/** The id of a verified factor still owed for this session, or null. */
async function pendingSecondFactor(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  try {
    const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!level || level.nextLevel !== "aal2" || level.currentLevel === "aal2") return null;
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verified = (factors?.totp ?? []).find(
      (factor: { status: string }) => factor.status === "verified",
    );
    return verified?.id ?? null;
  } catch {
    // A Supabase project with MFA disabled answers with an error here. That is
    // not a reason to refuse a sign-in that has already proved the password.
    return null;
  }
}

/**
 * Record the sign-in, and tell the person if it came from somewhere new.
 *
 * "New" is a coarse device label plus a /24 (or /48) network prefix, so a
 * commute does not generate an alert every morning and an actual new machine
 * in another country does.
 */
async function afterSuccessfulSignIn(
  admin: ReturnType<typeof createAdminClient> | null,
  profileId: string,
  email: string,
  context: RequestContext,
  locale: Locale,
) {
  if (!admin) return;
  try {
    const { data: profile } = await admin
      .from("profiles")
      .select("organization_id, full_name")
      .eq("id", profileId)
      .maybeSingle();
    const organizationId = profile?.organization_id ?? null;

    const { data: seen } = await admin
      .from("account_security_events")
      .select("device_signature")
      .eq("profile_id", profileId)
      .eq("event_type", "sign_in")
      .order("at", { ascending: false })
      .limit(50);
    const known = (seen ?? [])
      .map((row: { device_signature: string | null }) => row.device_signature)
      .filter(Boolean);
    const isNew = isNewSignInDevice(context.signature, known) as boolean;

    await admin.from("account_security_events").insert({
      organization_id: organizationId,
      profile_id: profileId,
      event_type: "sign_in",
      details: isNew ? { new_device: true } : null,
      ...contextColumns(context),
    });

    await admin.from("profile_security").upsert(
      {
        profile_id: profileId,
        organization_id: organizationId,
        last_sign_in_at: new Date().toISOString(),
      },
      { onConflict: "profile_id" },
    );

    if (!isNew) return;

    const { data: security } = await admin
      .from("profile_security")
      .select("login_alerts_enabled")
      .eq("profile_id", profileId)
      .maybeSingle();
    if (security && security.login_alerts_enabled === false) return;

    const alert = loginAlertEmail({
      locale,
      device: context.device,
      ip: context.ip,
      at: new Date().toUTCString(),
      appUrl: appUrl(),
      escape: escapeHtml,
    }) as { subject: string; html: string };

    if (providers.email() && email) {
      try {
        await sendEmail(email, alert.subject, alert.html);
      } catch (cause: any) {
        await admin.from("account_security_events").insert({
          organization_id: organizationId,
          profile_id: profileId,
          event_type: "login_alert_failed",
          details: { reason: String(cause?.message ?? cause).slice(0, 300) },
          ...contextColumns(context),
        });
      }
    } else {
      // No provider: the alert is still RECORDED, and /settings/security shows
      // it. Silence would be the failure mode this branch exists to remove.
      await admin.from("account_security_events").insert({
        organization_id: organizationId,
        profile_id: profileId,
        event_type: "login_alert_undelivered",
        details: { reason: "no email provider is connected (RESEND_API_KEY / EMAIL_FROM)" },
        ...contextColumns(context),
      });
    }
  } catch {
    /* audit only */
  }
}
