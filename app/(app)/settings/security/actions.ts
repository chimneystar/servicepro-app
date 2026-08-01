"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { getRequestContext, contextColumns } from "@/lib/request-context";
import type { Json } from "@/lib/supabase/database.types";
// @ts-ignore -- pure logic, proven both ways in tests/password-policy.test.mjs
import { evaluatePassword, describePasswordFailures } from "@/lib/core/password-policy.mjs";
// @ts-ignore -- pure logic, proven both ways in tests/rate-limit.test.mjs
import { consume } from "@/lib/core/rate-limit.mjs";

export type SecurityResult = { ok: boolean; error?: string; notice?: string; problems?: string[] };

/** Write a security event with the request context. Never throws at the caller. */
async function logEvent(
  profileId: string,
  organizationId: string | null,
  eventType: string,
  // `details` lands in a jsonb column, so it is typed as JSON rather than as an
  // arbitrary record — `Record<string, unknown>` admits values that cannot be
  // serialised and would be silently dropped or rejected on the way in.
  details: Json,
) {
  try {
    const context = await getRequestContext();
    // The table has a SELECT policy and no write policy, so only the service
    // role can append to it. That is the point: an audit trail a member can
    // write is an audit trail a member can forge.
    await createAdminClient()
      .from("account_security_events")
      .insert({
        organization_id: organizationId,
        profile_id: profileId,
        event_type: eventType,
        details,
        ...contextColumns(context),
      });
  } catch {
    /* the action's own outcome must not depend on the audit write */
  }
}

/**
 * Sign out every device (ledger 6b.6).
 *
 * THE DEFECT: a lost phone could not be signed out. There was no session view,
 * no revocation, and no way to end a session other than waiting for the refresh
 * token to expire.
 *
 * `scope: "global"` revokes every refresh token Supabase holds for this user,
 * so every other browser and phone is signed out at its next refresh. It is the
 * real thing, not a cosmetic flag — and it signs THIS browser out too, which is
 * why the screen says so before you press it.
 */
export async function signOutEverywhere(): Promise<SecurityResult> {
  const locale = (await getLocale()) === "he" ? "he" : "en";
  const he = locale === "he";
  const profile = await requireProfile();
  const supabase = await createClient();

  const { error } = await supabase.auth.signOut({ scope: "global" });
  if (error)
    return {
      ok: false,
      error: he
        ? "לא הצלחנו לנתק את המכשירים. נסו שוב."
        : "We could not sign the devices out. Try again.",
    };

  await supabase.from("profile_security").upsert(
    {
      profile_id: profile.id,
      organization_id: profile.organization_id,
      sessions_revoked_at: new Date().toISOString(),
    },
    { onConflict: "profile_id" },
  );
  await logEvent(profile.id, profile.organization_id, "sessions_revoked", { scope: "global" });

  revalidatePath("/settings/security");
  return { ok: true, notice: he ? "כל המכשירים נותקו." : "Every device has been signed out." };
}

/** Turn the new-device email alert on or off for this account. */
export async function setLoginAlerts(enabled: boolean): Promise<SecurityResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("profile_security").upsert(
    {
      profile_id: profile.id,
      organization_id: profile.organization_id,
      login_alerts_enabled: enabled,
    },
    { onConflict: "profile_id" },
  );
  if (error) {
    const he = (await getLocale()) === "he";
    return {
      ok: false,
      error: he ? "לא הצלחנו לשמור את ההגדרה." : "We could not save that setting.",
    };
  }
  await logEvent(
    profile.id,
    profile.organization_id,
    enabled ? "login_alerts_enabled" : "login_alerts_disabled",
    null,
  );
  revalidatePath("/settings/security");
  return { ok: true };
}

/**
 * Mirror a two-factor enrolment or removal onto the profile.
 *
 * Supabase Auth owns the factors; this records WHEN it happened and WHO did it
 * so that turning MFA off is as auditable as turning it on. It is deliberately
 * not a second source of truth — the panel always reads the factor list from
 * Supabase itself.
 */
export async function recordTwoFactorChange(enrolled: boolean): Promise<SecurityResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const now = new Date().toISOString();
  await supabase.from("profile_security").upsert(
    {
      profile_id: profile.id,
      organization_id: profile.organization_id,
      ...(enrolled ? { mfa_enrolled_at: now } : { mfa_removed_at: now }),
    },
    { onConflict: "profile_id" },
  );
  await logEvent(
    profile.id,
    profile.organization_id,
    enrolled ? "mfa_enrolled" : "mfa_removed",
    null,
  );
  revalidatePath("/settings/security");
  return { ok: true };
}

/**
 * Change the password — with the SAME server-side policy signup uses.
 *
 * `supabase.auth.updateUser({ password })` was reachable from the browser with
 * no strength rule at all, so an account created under the policy could be
 * downgraded to "1234" a minute later. The current password is re-verified
 * first, because a stolen session should not be able to take the account.
 */
export async function changePassword(
  _previous: SecurityResult,
  formData: FormData,
): Promise<SecurityResult> {
  const locale = (await getLocale()) === "he" ? "he" : "en";
  const he = locale === "he";
  const profile = await requireProfile();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next !== confirm)
    return { ok: false, error: he ? "הסיסמאות אינן תואמות." : "The passwords do not match." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email)
    return {
      ok: false,
      error: he ? "לא הצלחנו לאמת את החשבון." : "We could not verify this account.",
    };

  const gate = consume(`password-change:${user.id}`, 5, 900_000);
  if (!gate.allowed)
    return {
      ok: false,
      error: he ? "יותר מדי ניסיונות. נסו שוב מאוחר יותר." : "Too many attempts. Try again later.",
    };

  const verdict = evaluatePassword(next, { email: user.email, fullName: profile.full_name }) as {
    ok: boolean;
    failures: string[];
  };
  if (!verdict.ok) {
    return {
      ok: false,
      error: he
        ? "הסיסמה החדשה אינה עומדת בדרישות."
        : "That new password does not meet the policy.",
      problems: describePasswordFailures(verdict.failures, locale) as string[],
    };
  }

  const { error: reauth } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (reauth) {
    await logEvent(profile.id, profile.organization_id, "password_change_refused", {
      reason: "current_password_wrong",
    });
    return {
      ok: false,
      error: he ? "הסיסמה הנוכחית אינה נכונה." : "That current password is not correct.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { ok: false, error: error.message };

  await supabase.from("profile_security").upsert(
    {
      profile_id: profile.id,
      organization_id: profile.organization_id,
      last_password_change_at: new Date().toISOString(),
    },
    { onConflict: "profile_id" },
  );
  await logEvent(profile.id, profile.organization_id, "password_changed", null);

  revalidatePath("/settings/security");
  return { ok: true, notice: he ? "הסיסמה עודכנה." : "Your password has been changed." };
}
