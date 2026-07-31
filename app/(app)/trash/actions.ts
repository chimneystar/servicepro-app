"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";
// @ts-ignore — pure, unit-tested restore rules, proven both ways (tests/recovery.test.mjs)
import {
  isRecoverableKind,
  tableForKind,
  restoreBlockers,
  restoreFailureMessage,
  RESTORE_ROLES,
} from "@/lib/core/recovery.mjs";

export type RestoreResult = { ok: boolean; error?: string };

/** Paths whose lists change when a record comes back. */
const AFFECTED: Record<string, string[]> = {
  customer: ["/trash", "/customers"],
  job: ["/trash", "/jobs", "/schedule", "/dispatch"],
  estimate: ["/trash", "/estimates"],
  invoice: ["/trash", "/invoices", "/finance"],
};

/**
 * Restore one soft-deleted record (ledger 6a.4).
 *
 * Guarded three times over, deliberately:
 *   - role, here, so the user gets a sentence instead of a 403;
 *   - the consistency rules from lib/core/recovery.mjs, here, so the user is
 *     told WHICH parent to restore first;
 *   - the same rules again as triggers in db/037_recovery.sql, which are the
 *     actual authority. The check below is a read followed by a write and is
 *     therefore a race; the trigger is not, and it also covers any other caller.
 */
export async function restoreRecord(kind: string, id: string): Promise<RestoreResult> {
  let profile;
  try {
    profile = await requireProfile();
    assertRole(profile, RESTORE_ROLES as ("owner" | "office" | "tech")[]);
  } catch {
    return { ok: false, error: "You do not have permission to restore records." };
  }

  if (!isRecoverableKind(kind))
    return { ok: false, error: "That kind of record cannot be restored." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Unknown record." };

  const table = tableForKind(kind) as string;
  const supabase = await createClient();

  // Read the row and its parents so the refusal can name what is wrong.
  const columns =
    kind === "invoice"
      ? "id, deleted_at, customer_id, job_id, estimate_id"
      : kind === "customer"
        ? "id, deleted_at"
        : "id, deleted_at, customer_id";

  const { data: row, error: readError } = await supabase
    .from(table)
    .select(columns)
    .eq("id", id)
    .eq("organization_id", profile.organization_id!)
    .maybeSingle();
  if (readError) return { ok: false, error: restoreFailureMessage(readError).message };
  if (!row) return { ok: false, error: "That record no longer exists." };

  const record = row as unknown as Record<string, string | null>;
  const context: Record<string, unknown> = { deleted: record.deleted_at != null };

  if (kind === "customer") {
    const { count } = await supabase
      .from("privacy_requests")
      .select("id", { head: true, count: "exact" })
      .eq("customer_id", id)
      .eq("request_type", "deletion")
      .eq("status", "completed");
    context.privacyErased = (count ?? 0) > 0;
  } else {
    context.customer = await parentState(supabase, "customers", record.customer_id, "name");
    if (kind === "invoice") {
      if (record.job_id)
        context.job = await parentState(supabase, "jobs", record.job_id, "service");
      // invoices.estimate_id carries no FK (migration 024), so it is resolved
      // by explicit lookup rather than an embed that PostgREST cannot build.
      if (record.estimate_id)
        context.estimate = await parentState(supabase, "estimates", record.estimate_id, "number");
    }
  }

  const blockers = restoreBlockers(kind, context) as { message: string }[];
  if (blockers.length) return { ok: false, error: blockers.map((b) => b.message).join(" ") };

  // `.not("deleted_at", "is", null)` makes the write itself conditional: two
  // people clicking Restore at once cannot both be told it worked.
  const { data: updated, error } = await supabase
    .from(table)
    .update({ deleted_at: null })
    .eq("id", id)
    .eq("organization_id", profile.organization_id!)
    .not("deleted_at", "is", null)
    .select("id");
  if (error) return { ok: false, error: restoreFailureMessage(error).message };
  if (!updated?.length) return { ok: false, error: "That record was already restored." };

  for (const path of AFFECTED[kind] ?? ["/trash"]) revalidatePath(path);
  return { ok: true };
}

/** deleted_at + a human label for one parent row, or null when it is gone. */
async function parentState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  parentId: string | null,
  labelColumn: string,
): Promise<{ deleted: boolean; name: string | null } | null> {
  if (!parentId) return null;
  const { data } = await supabase
    .from(table)
    .select(`deleted_at, ${labelColumn}`)
    .eq("id", parentId)
    .maybeSingle();
  if (!data) return null;
  const parent = data as unknown as Record<string, unknown>;
  const label = parent[labelColumn];
  return { deleted: parent.deleted_at != null, name: label == null ? null : String(label) };
}
