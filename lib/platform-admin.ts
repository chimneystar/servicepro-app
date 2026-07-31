import { createAdminClient } from "@/lib/supabase/admin";
// @ts-ignore -- pure rules, proven both ways in tests/support-access.test.mjs
import { selectGrantingSession, supportAccessMessage } from "@/lib/core/support-access.mjs";

/** Fails closed when the service role or platform registry is unavailable. */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("platform_admins").select("user_id").eq("user_id", userId).eq("active", true).maybeSingle();
    return !error && Boolean(data);
  } catch {
    return false;
  }
}

export async function getPlatformAdmin(userId:string):Promise<{user_id:string;role:"support"|"operations"|"super_admin"}|null>{
  try{const admin=createAdminClient();const{data,error}=await admin.from("platform_admins").select("user_id,role").eq("user_id",userId).eq("active",true).maybeSingle();return error||!data?null:data as any;}catch{return null;}
}

// =====================================================================
//  Support sessions that actually grant something (ledger 5.17).
//
//  Before this, `support_sessions` was written by the console and read by
//  NOTHING: platform staff reached a business purely because they were in
//  `platform_admins`, so the reason, the expiry and the Revoke button were
//  decoration. The session is now the gate.
//
//  Two properties this deliberately keeps:
//   1. The session row is re-read on EVERY attempt. Nothing is cached, so a
//      revocation takes effect on the next action — not at the next login,
//      not when a cache expires.
//   2. Every attempt is recorded in `support_session_events`, granted or
//      refused, so support access has an audit trail for the first time.
// =====================================================================

export type SupportAccessLevel = "read_only" | "guided_write";
export type SupportAccessVerdict = {
  granted: boolean;
  reason: string;
  message: string;
  sessionId: string | null;
  caseId: string | null;
  accessLevel: SupportAccessLevel | null;
  expiresAt: string | null;
};

function verdictFrom(raw: any, locale: "en" | "he"): SupportAccessVerdict {
  return {
    granted: Boolean(raw?.granted),
    reason: String(raw?.reason ?? "no_session"),
    message: raw?.granted ? "" : (supportAccessMessage(raw?.reason ?? "no_session", locale) as string),
    sessionId: raw?.sessionId ?? null,
    caseId: raw?.caseId ?? null,
    accessLevel: (raw?.accessLevel ?? null) as SupportAccessLevel | null,
    expiresAt: raw?.expiresAt ? new Date(raw.expiresAt).toISOString() : null,
  };
}

/**
 * Does this member of platform staff currently hold a session granting the
 * requested level of access to this business?
 *
 * Read fresh every time. Never throws — a failure to consult the registry is a
 * refusal, not an escalation.
 */
export async function getSupportAccess(input: {
  adminUserId: string;
  organizationId: string;
  requiredLevel?: SupportAccessLevel;
  locale?: "en" | "he";
  now?: number;
}): Promise<SupportAccessVerdict> {
  const locale = input.locale ?? "en";
  const requiredLevel = input.requiredLevel ?? "read_only";
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("support_sessions")
      .select("id, case_id, organization_id, admin_user_id, access_level, starts_at, expires_at, revoked_at")
      .eq("admin_user_id", input.adminUserId)
      .eq("organization_id", input.organizationId);
    if (error) return verdictFrom({ granted: false, reason: "no_session" }, locale);
    return verdictFrom(
      selectGrantingSession(data ?? [], {
        now: input.now ?? Date.now(),
        adminUserId: input.adminUserId,
        organizationId: input.organizationId,
        requiredLevel,
      }),
      locale,
    );
  } catch {
    return verdictFrom({ granted: false, reason: "no_session" }, locale);
  }
}

/** Write the attempt down. A grant nobody can review is not accountability. */
export async function recordSupportAccess(input: {
  adminUserId: string;
  organizationId: string;
  action: string;
  verdict: SupportAccessVerdict;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("support_session_events").insert({
      session_id: input.verdict.sessionId,
      organization_id: input.organizationId,
      admin_user_id: input.adminUserId,
      action: input.action,
      granted: input.verdict.granted,
      refusal_reason: input.verdict.granted ? null : input.verdict.reason,
      details: input.details ?? {},
    });
    if (error) console.error(`[support] the access attempt could not be recorded: ${error.message}`);
  } catch (cause: any) {
    console.error(`[support] the access attempt could not be recorded: ${String(cause?.message ?? cause)}`);
  }
}

/** Check and record in one step. Returns the verdict; the caller decides. */
export async function authorizeSupportAccess(input: {
  adminUserId: string;
  organizationId: string;
  action: string;
  requiredLevel?: SupportAccessLevel;
  locale?: "en" | "he";
  details?: Record<string, unknown>;
}): Promise<SupportAccessVerdict> {
  const verdict = await getSupportAccess(input);
  await recordSupportAccess({ adminUserId: input.adminUserId, organizationId: input.organizationId, action: input.action, verdict, details: input.details });
  return verdict;
}
