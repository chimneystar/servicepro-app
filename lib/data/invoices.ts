/**
 * Invoices and their line items.
 *
 * `invoices` embeds customers through `invoices!invoices_customer_id_fkey` for
 * the migration-014 reason described in lib/data/jobs.ts.
 *
 * WHY THE REPORTING SHAPES LIVE HERE. `/reports`, `/reports/custom` and the
 * accounting export each built their own "paid invoices in a window, plus their
 * items" pair. They agreed by coincidence, and the money engine
 * (`lib/core/reporting.mjs`) is fed by all three — so a divergence between them
 * is a divergence in what the business believes it earned.
 */

import type { ServerClient } from "@/lib/supabase/server";
import { readAll, readAtMost, readOne } from "./db";

const CUSTOMER = "customers!invoices_customer_id_fkey";

/** Paid invoices in a window, with the assignee the revenue is attributed to. */
export function listPaidInWindow(supabase: ServerClient, start: string, end: string) {
  return readAll("invoices.listPaidInWindow", () =>
    supabase
      .from("invoices")
      .select(
        "id, total_minor, discount_minor, tax_rate_bps, issue_date, jobs(assigned_to, profiles!jobs_assigned_to_fkey(full_name))",
      )
      .eq("status", "paid")
      .is("deleted_at", null)
      .gte("issue_date", start)
      .lte("issue_date", end),
  );
}

/** Paid invoice totals in a window — the expenses screen's revenue comparison. */
export function listPaidTotalsInWindow(supabase: ServerClient, start: string, end: string) {
  return readAll("invoices.listPaidTotalsInWindow", () =>
    supabase
      .from("invoices")
      .select("total_minor, issue_date")
      .eq("status", "paid")
      .is("deleted_at", null)
      .gte("issue_date", start)
      .lte("issue_date", end),
  );
}

/** Everything still owed. Unbounded in time on purpose — an old unpaid invoice is still owed. */
export function listUnpaid(supabase: ServerClient) {
  return readAll("invoices.listUnpaid", () =>
    supabase
      .from("invoices")
      .select("total_minor, issue_date")
      .eq("status", "unpaid")
      .is("deleted_at", null),
  );
}

/** Invoices raised against a set of jobs — the commission report's join. */
export function listByJobIds(supabase: ServerClient, jobIds: string[]) {
  if (!jobIds.length) return Promise.resolve([]);
  return readAll("invoices.listByJobIds", () =>
    supabase.from("invoices").select("id, job_id").in("job_id", jobIds).is("deleted_at", null),
  );
}

/** Named invoices by id — for resolving a bulk selection back to labels. */
export function listByIds(supabase: ServerClient, ids: string[]) {
  if (!ids.length) return Promise.resolve([]);
  return readAll("invoices.listByIds", () =>
    supabase.from("invoices").select("id, number, status").in("id", ids).is("deleted_at", null),
  );
}

/** Totals and status for one customer — the balance on the customer screen. */
export function listTotalsForCustomer(supabase: ServerClient, customerId: string) {
  return readAll("invoices.listTotalsForCustomer", () =>
    supabase
      .from("invoices")
      .select("total_minor, status")
      .eq("customer_id", customerId)
      .is("deleted_at", null),
  );
}

/** Invoices for the accounting export, with the customer name the ledger wants. */
export function listForExport(supabase: ServerClient, from: string, to: string) {
  return readAll("invoices.listForExport", () =>
    supabase
      .from("invoices")
      .select(
        `id, number, issue_date, status, total_minor, tax_rate_bps, discount_minor, ${CUSTOMER}(name)`,
      )
      .is("deleted_at", null)
      .gte("issue_date", from)
      .lte("issue_date", to)
      .order("number"),
  );
}

/** One invoice, or null. */
export function findById(supabase: ServerClient, id: string) {
  return readOne(
    "invoices.findById",
    supabase.from("invoices").select("*").eq("id", id).maybeSingle(),
  );
}

/** The most recent invoices, for a dashboard strip. The bound is required. */
export function listRecent(supabase: ServerClient, limit: number) {
  return readAtMost(
    "invoices.listRecent",
    () =>
      supabase
        .from("invoices")
        .select("id, number, status, total_minor, issue_date")
        .is("deleted_at", null)
        .order("issue_date", { ascending: false }),
    limit,
  );
}

// --- line items ------------------------------------------------------------

/** The lines on one invoice, in document order. */
export function listItems(supabase: ServerClient, invoiceId: string) {
  return readAll("invoices.listItems", () =>
    supabase
      .from("invoice_items")
      .select("title, description, qty_milli, unit_price_minor, taxable, image_path")
      .eq("invoice_id", invoiceId)
      .order("sort"),
  );
}

/** The lines on one invoice, including cost — the editor and margin reporting. */
export function listItemsWithCost(supabase: ServerClient, invoiceId: string) {
  return readAll("invoices.listItemsWithCost", () =>
    supabase
      .from("invoice_items")
      .select("title, description, qty_milli, unit_price_minor, cost_minor, taxable, image_path")
      .eq("invoice_id", invoiceId)
      .order("sort"),
  );
}

/**
 * Lines across many invoices — what the revenue engine is fed.
 *
 * Paged, and that matters more here than almost anywhere else: a year of
 * invoices is easily past 1000 LINES even for a small business, and a truncated
 * item list does not produce an obviously wrong number. It produces a slightly
 * low one.
 */
export function listItemsForInvoices(supabase: ServerClient, invoiceIds: string[]) {
  if (!invoiceIds.length) return Promise.resolve([]);
  return readAll("invoices.listItemsForInvoices", () =>
    supabase
      .from("invoice_items")
      .select("invoice_id, qty_milli, unit_price_minor, cost_minor, taxable")
      .in("invoice_id", invoiceIds),
  );
}

/** Lines across many invoices without the taxable flag — the custom report's narrower read. */
export function listItemCostsForInvoices(supabase: ServerClient, invoiceIds: string[]) {
  if (!invoiceIds.length) return Promise.resolve([]);
  return readAll("invoices.listItemCostsForInvoices", () =>
    supabase
      .from("invoice_items")
      .select("invoice_id, qty_milli, unit_price_minor, cost_minor")
      .in("invoice_id", invoiceIds),
  );
}
