"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  authorizeSupportAccess,
  getPlatformAdmin,
  recordSupportAccess,
} from "@/lib/platform-admin";
// @ts-ignore -- pure logic, proven both ways in tests/secret-keyring.test.mjs
import {
  parseKeyring,
  planRotation,
  describeRotationPlan,
  rotatePayload,
} from "@/lib/core/secret-keyring.mjs";

export type AdminResult = { ok: boolean; error?: string };
const initialError = "The change could not be saved. Check the required fields and try again.";
async function guard() {
  const profile = await requireProfile(),
    platform = await getPlatformAdmin(profile.id);
  if (!platform) throw new Error("forbidden");
  return { profile, platform, admin: createAdminClient() };
}

export async function createSupportCase(
  _previous: AdminResult,
  formData: FormData,
): Promise<AdminResult> {
  try {
    const { profile, admin } = await guard();
    const subject = String(formData.get("subject") ?? "").trim();
    if (!subject) return { ok: false, error: initialError };
    const { error } = await admin.from("support_cases").insert({
      organization_id: String(formData.get("organizationId") ?? "") || null,
      subject,
      description: String(formData.get("description") ?? "").trim() || null,
      severity: String(formData.get("severity") ?? "normal"),
      opened_by: profile.id,
      assigned_to: profile.id,
    });
    if (error) return { ok: false, error: initialError };
    revalidatePath("/admin");
    return { ok: true };
  } catch {
    return { ok: false, error: "Platform access is required." };
  }
}
export async function updateSupportCase(id: string, status: string): Promise<AdminResult> {
  try {
    const { admin } = await guard();
    if (!["open", "investigating", "waiting", "resolved", "closed"].includes(status))
      return { ok: false, error: initialError };
    const { error } = await admin
      .from("support_cases")
      .update({
        status,
        resolved_at: ["resolved", "closed"].includes(status) ? new Date().toISOString() : null,
      })
      .eq("id", id);
    if (error) return { ok: false, error: initialError };
    revalidatePath("/admin");
    return { ok: true };
  } catch {
    return { ok: false, error: "Platform access is required." };
  }
}
export async function createSupportSession(
  _previous: AdminResult,
  formData: FormData,
): Promise<AdminResult> {
  try {
    const { profile, admin } = await guard();
    const caseId = String(formData.get("caseId") ?? ""),
      reason = String(formData.get("reason") ?? "").trim(),
      hours = Math.min(8, Math.max(1, Number(formData.get("hours") ?? 1)));
    if (!caseId || !reason) return { ok: false, error: initialError };
    const { data: supportCase } = await admin
      .from("support_cases")
      .select("organization_id")
      .eq("id", caseId)
      .single();
    if (!supportCase?.organization_id)
      return { ok: false, error: "The case must be linked to a business." };
    const { error } = await admin.from("support_sessions").insert({
      case_id: caseId,
      organization_id: supportCase.organization_id,
      admin_user_id: profile.id,
      reason,
      access_level: String(formData.get("accessLevel") ?? "read_only"),
      expires_at: new Date(Date.now() + hours * 3600000).toISOString(),
    });
    if (error) return { ok: false, error: initialError };
    revalidatePath("/admin");
    return { ok: true };
  } catch {
    return { ok: false, error: "Platform access is required." };
  }
}
export async function revokeSupportSession(id: string): Promise<AdminResult> {
  try {
    const { profile, admin } = await guard();
    const { data: session } = await admin
      .from("support_sessions")
      .select("organization_id")
      .eq("id", id)
      .maybeSingle();
    const { error } = await admin
      .from("support_sessions")
      .update({ revoked_at: new Date().toISOString(), revoked_by: profile.id })
      .eq("id", id);
    if (error) return { ok: false, error: initialError };
    // Revoking used to change a timestamp nothing consulted. It now ends access
    // immediately (every check re-reads the row), and the revocation itself is
    // part of the same audit trail as the accesses it ends.
    if (session?.organization_id) {
      await recordSupportAccess({
        adminUserId: profile.id,
        organizationId: session.organization_id,
        action: "session_revoked",
        verdict: {
          granted: false,
          reason: "revoked",
          message: "",
          sessionId: id,
          caseId: null,
          accessLevel: null,
          expiresAt: null,
        },
      });
    }
    revalidatePath("/admin");
    return { ok: true };
  } catch {
    return { ok: false, error: "Platform access is required." };
  }
}
// =====================================================================
//  The support session finally grants something (ledger 5.17).
//
//  `support_sessions` used to be a record of an access grant that granted
//  nothing: no code anywhere read it, so opening a session, letting it expire
//  and revoking it were all the same to the system. This is the first call in
//  the product whose answer depends on the session being active, unexpired and
//  unrevoked — and it is refused, out loud and with the reason, when it is not.
//
//  Access is re-checked on every invocation; nothing about the verdict is
//  cached anywhere, so a revoked session stops working on the very next click.
// =====================================================================
export type BusinessSnapshot = {
  organizationId: string;
  name: string;
  accessLevel: string;
  expiresAt: string | null;
  counts: {
    customers: number;
    jobs: number;
    openJobs: number;
    invoices: number;
    unpaidInvoices: number;
    team: number;
  };
  recentActivity: { table: string; action: string; at: string }[];
};
export type SnapshotResult = { ok: boolean; error?: string; snapshot?: BusinessSnapshot };

export async function openBusinessSnapshot(organizationId: string): Promise<SnapshotResult> {
  const locale = (await getLocale()) === "he" ? "he" : "en";
  let profile, platform, admin;
  try {
    ({ profile, platform, admin } = await guard());
  } catch {
    return {
      ok: false,
      error: locale === "he" ? "נדרשת הרשאת פלטפורמה." : "Platform access is required.",
    };
  }
  if (!organizationId) return { ok: false, error: initialError };

  // Being in `platform_admins` is no longer enough on its own.
  const verdict = await authorizeSupportAccess({
    adminUserId: profile.id,
    organizationId,
    action: "business_snapshot",
    requiredLevel: "read_only",
    locale,
    details: { platform_role: platform.role },
  });
  if (!verdict.granted) return { ok: false, error: verdict.message };

  const { data: organization } = await admin
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();
  const count = async (table: string, apply?: (query: any) => any) => {
    let query = admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId);
    if (apply) query = apply(query);
    const { count: total } = await query;
    return total ?? 0;
  };
  // Column and enum names verified against db/001_schema.sql: jobs.status is the
  // job_status enum ('scheduled','in_progress','done','cancelled') and invoices
  // carry invoice_status ('unpaid','paid','void'). There is no `documents`
  // table in this schema.
  const [customers, jobs, openJobs, invoices, unpaidInvoices, team, activity] = await Promise.all([
    count("customers", (q: any) => q.is("deleted_at", null)),
    count("jobs", (q: any) => q.is("deleted_at", null)),
    count("jobs", (q: any) => q.is("deleted_at", null).in("status", ["scheduled", "in_progress"])),
    count("invoices", (q: any) => q.is("deleted_at", null)),
    count("invoices", (q: any) => q.is("deleted_at", null).eq("status", "unpaid")),
    count("profiles", (q: any) => q.eq("active", true)),
    admin
      .from("audit_log")
      .select("table_name, action, at")
      .eq("organization_id", organizationId)
      .order("at", { ascending: false })
      .limit(10),
  ]);

  return {
    ok: true,
    snapshot: {
      organizationId,
      name: organization?.name ?? organizationId,
      accessLevel: verdict.accessLevel ?? "read_only",
      expiresAt: verdict.expiresAt,
      counts: { customers, jobs, openJobs, invoices, unpaidInvoices, team },
      recentActivity: (activity.data ?? []).map((row: any) => ({
        table: row.table_name,
        action: row.action,
        at: row.at,
      })),
    },
  };
}

// =====================================================================
//  Encryption-key rotation for stored provider tokens (ledger 6b.9).
//
//  `merchant_secrets.key_version` has existed since migration 017 and nothing
//  has ever written anything but its default. PAYMENT_SECRETS_KEY therefore
//  could not be changed: doing so made every saved Helcim token permanently
//  unreadable, and .env.example said as much with no way to re-encrypt.
//
//  Rotation is deliberately PLANNED BEFORE IT RUNS. A rotation that
//  re-encrypts half the estate and then meets a row whose old key is missing
//  leaves two states at once, which is worse than not starting.
// =====================================================================
export type RotationState = { ok: boolean; error?: string; summary?: string };

export type KeyStatus = {
  configured: boolean;
  activeVersion: number;
  heldVersions: number[];
  problems: string[];
  rows: { keyVersion: number; count: number }[];
  plan: string;
  canRotate: boolean;
  lastRun: {
    status: string;
    toVersion: number;
    rotated: number;
    error: string | null;
    at: string;
  } | null;
};

async function readKeyStatus(
  admin: ReturnType<typeof createAdminClient>,
  locale: "en" | "he",
): Promise<KeyStatus> {
  const keyring = parseKeyring(process.env) as any;
  const { data: rows } = await admin
    .from("merchant_secrets")
    .select("organization_id, key_version");
  const counts = new Map<number, number>();
  for (const row of (rows ?? []) as { key_version: number }[]) {
    const version = Number(row.key_version ?? 1);
    counts.set(version, (counts.get(version) ?? 0) + 1);
  }
  const plan = planRotation(rows ?? [], keyring) as any;
  const { data: last } = await admin
    .from("secret_key_rotations")
    .select("status, to_version, rows_rotated, error, started_at")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    configured: Boolean(keyring.configured),
    activeVersion: keyring.activeVersion,
    heldVersions: keyring.versions,
    problems: keyring.errors,
    rows: [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([keyVersion, count]) => ({ keyVersion, count })),
    plan: describeRotationPlan(plan, locale) as string,
    canRotate: Boolean(keyring.configured) && plan.ok && plan.toRotate.length > 0,
    lastRun: last
      ? {
          status: last.status,
          toVersion: last.to_version,
          rotated: last.rows_rotated,
          error: last.error,
          at: last.started_at,
        }
      : null,
  };
}

/** Read-only view of the keyring and what a rotation would do. */
export async function getKeyStatus(): Promise<{ ok: boolean; error?: string; status?: KeyStatus }> {
  const locale = (await getLocale()) === "he" ? "he" : "en";
  try {
    const { platform, admin } = await guard();
    if (!["operations", "super_admin"].includes(platform.role))
      return { ok: false, error: "Operations access is required." };
    return { ok: true, status: await readKeyStatus(admin, locale) };
  } catch {
    return { ok: false, error: "Platform access is required." };
  }
}

/**
 * Re-encrypt every stored merchant token under the active key.
 *
 * Each row is read, decrypted with the key its own `key_version` names,
 * re-encrypted under the active key and written back with the new version in
 * the SAME update — so a row is never left with a payload and a version that
 * disagree. A row that fails is counted and reported; the rotation does not
 * pretend to have finished.
 */
export async function rotatePaymentSecretsKey(_previous: RotationState): Promise<RotationState> {
  const locale = (await getLocale()) === "he" ? "he" : "en";
  const he = locale === "he";
  let profile, platform, admin;
  try {
    ({ profile, platform, admin } = await guard());
  } catch {
    return { ok: false, error: "Platform access is required." };
  }
  if (platform.role !== "super_admin") {
    return {
      ok: false,
      error: he
        ? "נדרשת הרשאת super_admin."
        : "Super-admin access is required to rotate an encryption key.",
    };
  }

  const keyring = parseKeyring(process.env) as any;
  const { data: rows } = await admin
    .from("merchant_secrets")
    .select("organization_id, encrypted_api_token, key_version");
  const plan = planRotation(rows ?? [], keyring) as any;

  if (!keyring.configured || !plan.ok) {
    await admin.from("secret_key_rotations").insert({
      target: "merchant_secrets",
      to_version: keyring.activeVersion,
      rows_total: (rows ?? []).length,
      status: "refused",
      error: [...keyring.errors, describeRotationPlan(plan, "en")].join(" | ").slice(0, 500),
      actor: profile.id,
      finished_at: new Date().toISOString(),
    });
    return { ok: false, error: [...keyring.errors, describeRotationPlan(plan, locale)].join(" ") };
  }
  if (plan.toRotate.length === 0)
    return { ok: true, summary: describeRotationPlan(plan, locale) as string };

  const { data: run } = await admin
    .from("secret_key_rotations")
    .insert({
      target: "merchant_secrets",
      from_versions: [...new Set(plan.toRotate.map((entry: any) => entry.keyVersion))],
      to_version: keyring.activeVersion,
      rows_total: (rows ?? []).length,
      actor: profile.id,
    })
    .select("id")
    .single();

  let rotated = 0;
  let skipped = 0;
  const failures: string[] = [];
  for (const row of (rows ?? []) as {
    organization_id: string;
    encrypted_api_token: string;
    key_version: number;
  }[]) {
    if (Number(row.key_version ?? 1) === keyring.activeVersion) {
      skipped += 1;
      continue;
    }
    try {
      const next = rotatePayload(row.encrypted_api_token, row.key_version, keyring) as {
        payload: string;
        keyVersion: number;
      };
      const { error } = await admin
        .from("merchant_secrets")
        .update({
          encrypted_api_token: next.payload,
          key_version: next.keyVersion,
          rotated_at: new Date().toISOString(),
        })
        .eq("organization_id", row.organization_id);
      if (error) throw new Error(error.message);
      rotated += 1;
    } catch (cause: any) {
      skipped += 1;
      failures.push(`${row.organization_id}: ${String(cause?.message ?? cause).slice(0, 120)}`);
    }
  }

  if (run?.id) {
    await admin
      .from("secret_key_rotations")
      .update({
        rows_rotated: rotated,
        rows_skipped: skipped,
        status: failures.length ? "failed" : "completed",
        error: failures.length ? failures.join(" | ").slice(0, 500) : null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);
  }

  revalidatePath("/admin");
  const summary = he
    ? `הוצפנו מחדש ${rotated} רשומות לגרסה ${keyring.activeVersion}.`
    : `Re-encrypted ${rotated} record(s) to key version ${keyring.activeVersion}.`;
  if (failures.length)
    return { ok: false, error: `${summary} ${failures.length} failed: ${failures[0]}` };
  return { ok: true, summary };
}

export async function saveFeatureFlag(
  _previous: AdminResult,
  formData: FormData,
): Promise<AdminResult> {
  try {
    const { profile, platform, admin } = await guard();
    if (!["operations", "super_admin"].includes(platform.role))
      return { ok: false, error: "Operations access is required." };
    const key = String(formData.get("key") ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_");
    if (!key) return { ok: false, error: initialError };
    const { error } = await admin.from("feature_flags").upsert(
      {
        key,
        description: String(formData.get("description") ?? "").trim() || null,
        enabled: formData.get("enabled") === "on",
        rollout_percent: Math.min(100, Math.max(0, Number(formData.get("rollout") ?? 0))),
        updated_by: profile.id,
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: initialError };
    revalidatePath("/admin");
    return { ok: true };
  } catch {
    return { ok: false, error: "Platform access is required." };
  }
}
export async function createRelease(
  _previous: AdminResult,
  formData: FormData,
): Promise<AdminResult> {
  try {
    const { profile, platform, admin } = await guard();
    if (!["operations", "super_admin"].includes(platform.role))
      return { ok: false, error: "Operations access is required." };
    const version = String(formData.get("version") ?? "").trim(),
      title = String(formData.get("title") ?? "").trim();
    if (!version || !title) return { ok: false, error: initialError };
    const { error } = await admin.from("release_records").insert({
      version,
      title,
      summary: String(formData.get("summary") ?? "").trim() || null,
      git_sha: String(formData.get("gitSha") ?? "").trim() || null,
      deployment_url: String(formData.get("deploymentUrl") ?? "").trim() || null,
      risk_level: String(formData.get("risk") ?? "standard"),
      regression_checklist: {
        features_preserved: formData.get("featuresPreserved") === "on",
        bilingual_checked: formData.get("bilingualChecked") === "on",
        roles_checked: formData.get("rolesChecked") === "on",
        database_checked: formData.get("databaseChecked") === "on",
      },
      created_by: profile.id,
    });
    if (error) return { ok: false, error: initialError };
    revalidatePath("/admin");
    return { ok: true };
  } catch {
    return { ok: false, error: "Platform access is required." };
  }
}
export async function updateReleaseStatus(id: string, status: string): Promise<AdminResult> {
  try {
    const { profile, platform, admin } = await guard();
    if (platform.role !== "super_admin" && ["approved", "live", "rolled_back"].includes(status))
      return { ok: false, error: "Super-admin access is required for this release state." };
    if (
      !["draft", "review", "approved", "rolling_out", "live", "paused", "rolled_back"].includes(
        status,
      )
    )
      return { ok: false, error: initialError };
    const { data: release } = await admin
      .from("release_records")
      .select("regression_checklist,status")
      .eq("id", id)
      .single();
    const checks = release?.regression_checklist || {};
    if (
      ["approved", "rolling_out", "live"].includes(status) &&
      !Object.values(checks).every(Boolean)
    )
      return { ok: false, error: "Complete every regression check before approval or rollout." };
    const update: any = { status };
    if (status === "approved") {
      update.approved_by = profile.id;
      update.approved_at = new Date().toISOString();
    }
    if (status === "live") update.released_at = new Date().toISOString();
    const { error } = await admin.from("release_records").update(update).eq("id", id);
    if (error) return { ok: false, error: initialError };
    await admin.from("release_events").insert({
      release_id: id,
      actor_id: profile.id,
      action: `status:${status}`,
      details: { previous: release?.status },
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch {
    return { ok: false, error: "Platform access is required." };
  }
}
