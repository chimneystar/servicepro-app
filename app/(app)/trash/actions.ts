"use server";

import { revalidatePath } from "next/cache";
import { createClient, type ServerClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";
// @ts-ignore — pure, unit-tested restore rules, proven both ways (tests/recovery.test.mjs)
import {
  isRecoverableKind,
  KIND_TABLE,
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
    assertRole(profile, [...RESTORE_ROLES]);
  } catch {
    return { ok: false, error: "You do not have permission to restore records." };
  }

  if (!isRecoverableKind(kind))
    return { ok: false, error: "That kind of record cannot be restored." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Unknown record." };

  const supabase = await createClient();
  const orgId = profile.organization_id;

  // Read the row and its parents so the refusal can name what is wrong.
  //
  // One branch per kind. `tableForKind(kind)` still exists and is still the
  // single source of the mapping, but a table name has to reach `.from()` as a
  // literal before the client can check anything about the query — the columns
  // below differ per kind, and this is the only shape in which that is
  // verified rather than asserted.
  const read = async () => {
    if (kind === "invoice")
      return await supabase
        .from("invoices")
        .select("id, deleted_at, customer_id, job_id, estimate_id")
        .eq("id", id)
        .eq("organization_id", orgId)
        .maybeSingle();
    if (kind === "customer")
      return await supabase
        .from("customers")
        .select("id, deleted_at")
        .eq("id", id)
        .eq("organization_id", orgId)
        .maybeSingle();
    if (kind === "job")
      return await supabase
        .from("jobs")
        .select("id, deleted_at, customer_id")
        .eq("id", id)
        .eq("organization_id", orgId)
        .maybeSingle();
    return await supabase
      .from("estimates")
      .select("id, deleted_at, customer_id")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();
  };
  const { data: row, error: readError } = await read();
  if (readError) return { ok: false, error: restoreFailureMessage(readError).message };
  if (!row) return { ok: false, error: "That record no longer exists." };

  const record: {
    deleted_at: string | null;
    customer_id?: string | null;
    job_id?: string | null;
    estimate_id?: string | null;
  } = row;
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
    context.customer = await parentState(supabase, record.customer_id ?? null, "customer");
    if (kind === "invoice") {
      if (record.job_id) context.job = await parentState(supabase, record.job_id ?? null, "job");
      // invoices.estimate_id carries no FK (migration 024), so it is resolved
      // by explicit lookup rather than an embed that PostgREST cannot build.
      if (record.estimate_id)
        context.estimate = await parentState(supabase, record.estimate_id ?? null, "estimate");
    }
  }

  const blockers = restoreBlockers(kind, context) as { message: string }[];
  if (blockers.length) return { ok: false, error: blockers.map((b) => b.message).join(" ") };

  // `.not("deleted_at", "is", null)` makes the write itself conditional: two
  // people clicking Restore at once cannot both be told it worked.
  const restore = (table: "customers" | "jobs" | "estimates" | "invoices") =>
    supabase
      .from(table)
      .update({ deleted_at: null })
      .eq("id", id)
      .eq("organization_id", orgId)
      .not("deleted_at", "is", null)
      .select("id");
  const { data: updated, error } = await restore(KIND_TABLE[kind]);
  if (error) return { ok: false, error: restoreFailureMessage(error).message };
  if (!updated?.length) return { ok: false, error: "That record was already restored." };

  for (const path of AFFECTED[kind] ?? ["/trash"]) revalidatePath(path);
  return { ok: true };
}

/** deleted_at + a human label for one parent row, or null when it is gone. */
async function parentState(
  supabase: ServerClient,
  parentId: string | null,
  parent: "customer" | "job" | "estimate",
): Promise<{ deleted: boolean; name: string | null } | null> {
  if (!parentId) return null;
  // The label column differs per parent (`name`, `service`, `number`), which is
  // why this used to interpolate a column name into the select string. A
  // literal per branch is the only form the typed client can check, and the
  // three queries it produces are the three it produced before.
  const row =
    parent === "customer"
      ? await supabase.from("customers").select("deleted_at, name").eq("id", parentId).maybeSingle()
      : parent === "job"
        ? await supabase.from("jobs").select("deleted_at, service").eq("id", parentId).maybeSingle()
        : await supabase
            .from("estimates")
            .select("deleted_at, number")
            .eq("id", parentId)
            .maybeSingle();
  if (!row.data) return null;
  const label =
    "name" in row.data ? row.data.name : "service" in row.data ? row.data.service : row.data.number;
  return { deleted: row.data.deleted_at != null, name: label == null ? null : String(label) };
}
