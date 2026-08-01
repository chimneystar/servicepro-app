/**
 * Payments — the reads that decide what a customer is told they owe.
 *
 * Two properties matter more here than on any other table.
 *
 * FIRST, PAGING. A truncated payment list does not look broken. It looks like a
 * smaller number, and the number is a balance. This is the same defect that
 * sent an accountant an incomplete ledger; the difference is that here it would
 * be shown to the customer as what they owe.
 *
 * SECOND, STATUS. A declined card and a settled payment are separate rows and
 * only some of them are money. The `settled` filter belongs in the query, and
 * it belongs in ONE query rather than being retyped per screen — a screen that
 * forgets it credits a failed card.
 */

import type { ServerClient } from "@/lib/supabase/server";
import { readAll, readAtMost, readOne } from "./db";

/** The statuses that represent money actually received. */
export const COLLECTED_STATUSES = ["settled", "partially_refunded"] as const;

/** Payments against one invoice that actually settled, oldest first. */
export function listSettledForInvoice(supabase: ServerClient, invoiceId: string) {
  return readAll("payments.listSettledForInvoice", () =>
    supabase
      .from("payments")
      .select(
        "amount_minor, base_amount_minor, refunded_minor, normalized_status, method, reference, paid_at",
      )
      .eq("invoice_id", invoiceId)
      .in("normalized_status", [...COLLECTED_STATUSES])
      .order("paid_at"),
  );
}

/** Every payment against one invoice, whatever its status. */
export function listForInvoice(supabase: ServerClient, invoiceId: string) {
  return readAll("payments.listForInvoice", () =>
    supabase
      .from("payments")
      .select("amount_minor, base_amount_minor, refunded_minor, normalized_status")
      .eq("invoice_id", invoiceId),
  );
}

/** Payments across several invoices — the job screen's per-invoice ledger. */
export function listForInvoices(supabase: ServerClient, invoiceIds: string[]) {
  if (!invoiceIds.length) return Promise.resolve([]);
  return readAll("payments.listForInvoices", () =>
    supabase
      .from("payments")
      .select("invoice_id, amount_minor, method, reference, paid_at")
      .in("invoice_id", invoiceIds)
      .order("paid_at"),
  );
}

/** Collected money across several invoices — what the commission report divides. */
export function listCollectedForInvoices(supabase: ServerClient, invoiceIds: string[]) {
  if (!invoiceIds.length) return Promise.resolve([]);
  return readAll("payments.listCollectedForInvoices", () =>
    supabase
      .from("payments")
      .select("invoice_id, base_amount_minor, amount_minor, refunded_minor, normalized_status")
      .in("invoice_id", invoiceIds)
      .in("normalized_status", [...COLLECTED_STATUSES]),
  );
}

/** Collected money in a date window — the revenue report. */
export function listCollectedInWindow(supabase: ServerClient, start: string, end: string) {
  return readAll("payments.listCollectedInWindow", () =>
    supabase
      .from("payments")
      .select("invoice_id, base_amount_minor, amount_minor, refunded_minor, normalized_status")
      .in("normalized_status", [...COLLECTED_STATUSES])
      .gte("paid_at", `${start}T00:00:00`)
      .lte("paid_at", `${end}T23:59:59`),
  );
}

/** Payments in a window with everything the accounting export writes out. */
export function listForExport(supabase: ServerClient, from: string, to: string) {
  return readAll("payments.listForExport", () =>
    supabase
      .from("payments")
      .select(
        "id, amount_minor, base_amount_minor, refunded_minor, normalized_status, method, reference, paid_at, invoices(number, customers(name))",
      )
      .gte("paid_at", `${from}T00:00:00`)
      .lte("paid_at", `${to}T23:59:59`)
      .order("paid_at"),
  );
}

/** Deposits recorded against an estimate rather than an invoice. */
export function listForEstimate(supabase: ServerClient, estimateId: string) {
  return readAll("payments.listForEstimate", () =>
    supabase
      .from("payments")
      .select("id, amount_minor, base_amount_minor, refunded_minor, normalized_status, paid_at")
      .eq("estimate_id", estimateId),
  );
}

/** One payment, or null. */
export function findById(supabase: ServerClient, id: string) {
  return readOne(
    "payments.findById",
    supabase.from("payments").select("*").eq("id", id).maybeSingle(),
  );
}

/** The most recent payments, for a dashboard strip. The bound is required. */
export function listRecent(supabase: ServerClient, limit: number) {
  return readAtMost(
    "payments.listRecent",
    () =>
      supabase
        .from("payments")
        .select("id, amount_minor, method, paid_at, normalized_status")
        .order("paid_at", { ascending: false }),
    limit,
  );
}
