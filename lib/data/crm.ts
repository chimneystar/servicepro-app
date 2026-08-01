/**
 * CRM query shapes with no home in an existing repository: warranty
 * callbacks/coverage, and the trash screen's recovery reads (a paged,
 * per-table read with the deleted_by column retry, plus the id-lookup
 * helpers it resolves parents through).
 *
 * See lib/data/db.ts for why nothing here applies its own range, and for how
 * errors and row-level security are handled.
 *
 * `pageDeletedRows` needs a row page AND a true total from the same request,
 * which `readPage` (whose answer is only `hasMore`) does not give. The first
 * version met that by reaching around the gateway and calling `.range()` here,
 * with a comment arguing the exception was narrow and disciplined. The guard in
 * tests/data-layer.test.mjs refused it, and the guard was right: an exception
 * granted for a good reason is still an exception, and a rule with exceptions
 * is advice. `readPageWithTotal` was added to the gateway instead, so this
 * function states a PAGE and still never states a range.
 */

import type { ServerClient } from "@/lib/supabase/server";
import {
  readAll,
  readAtMost,
  readPageWithTotal,
  type Rangeable,
  type RangeableCounted,
} from "./db";

// --- warranties --------------------------------------------------------

export type WarrantyCallbackRow = {
  id: string;
  original_job_id: string;
  callback_job_id: string | null;
  issue: string;
  priority: string;
  responsibility: string;
  status: string;
  scheduled_for: string | null;
  resolution: string | null;
  reported_at: string;
};

/** Warranty callbacks, newest first — the warranty center's queue. The bound is required. */
export function listCallbacks(supabase: ServerClient, limit: number) {
  return readAtMost(
    "crm.listCallbacks",
    () =>
      supabase
        .from("warranty_callbacks")
        .select(
          "id,original_job_id,callback_job_id,issue,priority,responsibility,status,scheduled_for,resolution,reported_at",
        )
        .order("reported_at", { ascending: false }),
    limit,
  );
}

export type ActiveWarrantyRow = {
  id: string;
  job_id: string;
  coverage_type: string;
  starts_on: string;
  expires_on: string | null;
  status: string;
};

/** Active job warranties, soonest-expiring first — the warranty center's expiry rail. The bound is required. */
export function listActiveWarranties(supabase: ServerClient, limit: number) {
  return readAtMost(
    "crm.listActiveWarranties",
    () =>
      supabase
        .from("job_warranties")
        .select("id,job_id,coverage_type,starts_on,expires_on,status")
        .eq("status", "active")
        .order("expires_on", { ascending: true, nullsFirst: false }),
    limit,
  );
}

// --- trash / recovery ----------------------------------------------------

export type RecoverableTable = "customers" | "jobs" | "estimates" | "invoices";

export type DeletedPage = {
  table: RecoverableTable;
  rows: Record<string, unknown>[];
  total: number;
  error: string | null;
};

/**
 * One page of soft-deleted rows for a recoverable table, plus the true total.
 *
 * `deleted_by` was added by migration 037. If that migration has not been
 * applied the select fails as a whole, so it is retried without that column
 * rather than blanking the entire screen — a trash list missing one column
 * still restores records; a 500 does not. The failure, if the retry also
 * fails, is returned as `error` rather than swallowed: the caller shows an
 * "unreadable" banner instead of pretending the table is empty.
 */
export async function pageDeletedRows(
  supabase: ServerClient,
  orgId: string,
  table: RecoverableTable,
  columns: string,
  { page, size }: { page: number; size: number },
): Promise<DeletedPage> {
  const run = (cols: string) =>
    readPageWithTotal<Record<string, unknown>>(
      `crm.pageDeletedRows.${table}`,
      () =>
        supabase
          .from(table)
          .select(`${cols}, deleted_at`, { count: "exact" })
          .eq("organization_id", orgId)
          .not("deleted_at", "is", null)
          .order("deleted_at", { ascending: false }) as unknown as RangeableCounted<
          Record<string, unknown>
        >,
      { page, size },
    );

  try {
    const withActor = await run(`${columns}, deleted_by`);
    return { table, rows: withActor.rows, total: withActor.total, error: null };
  } catch {
    // Migration 037 is not applied: retry without the column it added.
  }
  try {
    const fallback = await run(columns);
    return { table, rows: fallback.rows, total: fallback.total, error: null };
  } catch (cause) {
    // Returned, not swallowed: the caller shows an "unreadable" banner rather
    // than an empty table, which would read as "nothing was deleted".
    return {
      table,
      rows: [],
      total: 0,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * id -> row, for a bounded set of ids (at most one page's worth) across the
 * four recoverable tables plus `profiles` — the source of "deleted by".
 */
export async function lookupByIds(
  supabase: ServerClient,
  table: RecoverableTable | "profiles",
  ids: string[],
  columns: string,
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (!ids.length) return map;
  // `table` is a union across five unrelated shapes and `columns` is a runtime
  // string (the columns genuinely differ per table — see the call site), so
  // postgrest-js cannot infer a single row type here; the cast states what the
  // trash screen already assumed of this read before it moved into this file.
  const rows = await readAll<Record<string, unknown>>(
    `crm.lookupByIds.${table}`,
    () =>
      supabase.from(table).select(columns).in("id", ids) as unknown as Rangeable<
        Record<string, unknown>
      >,
  );
  for (const row of rows) map.set(String(row.id), row);
  return map;
}

/** Customers erased to satisfy a completed privacy DELETION request — trash refuses to restore them. */
export async function listPrivacyErasedCustomerIds(
  supabase: ServerClient,
  orgId: string,
  customerIds: string[],
): Promise<Set<string>> {
  const erased = new Set<string>();
  if (!customerIds.length) return erased;
  const rows = await readAll<{ customer_id: string | null }>(
    "crm.listPrivacyErasedCustomerIds",
    () =>
      supabase
        .from("privacy_requests")
        .select("customer_id")
        .eq("organization_id", orgId)
        .eq("request_type", "deletion")
        .eq("status", "completed")
        .in("customer_id", customerIds),
  );
  for (const row of rows) if (row.customer_id) erased.add(row.customer_id);
  return erased;
}
