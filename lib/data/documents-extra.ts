/**
 * Query shapes for `app/(app)/invoices`, `app/(app)/estimates` and
 * `app/(app)/expenses` that don't match any shape already in
 * `lib/data/invoices.ts`, `lib/data/estimates.ts`, `lib/data/payments.ts` or
 * `lib/data/operations.ts` — one extra column, a different filter, or a
 * conditional shape a call site builds at runtime.
 *
 * Kept separate from those files rather than added to them: this migration
 * (6-2-migrate-documents) does not own those files, and several other
 * workstreams are reading them at the same time.
 */

import type { ServerClient } from "@/lib/supabase/server";
import { DataError, readAll, readAtMost } from "./db";

const INVOICE_CUSTOMER = "customers!invoices_customer_org_fk";
const ESTIMATE_CUSTOMER = "customers!estimates_customer_org_fk";

/** The statuses that represent money actually received (mirrors payments.ts). */
const SETTLED = ["settled", "partially_refunded"] as const;

/**
 * CRM Project predates migration 036 in some live environments. A missing
 * document-integrity column must not make the whole invoices or estimates
 * screen disappear; retry the read with its legacy shape and give the UI safe
 * defaults. Once migration 036 is installed, the richer first query continues
 * to be used without any compatibility branch.
 */
function isMissingDocumentIntegrityColumn(error: unknown) {
  return (
    error instanceof DataError &&
    error.code === "42703" &&
    /\b(?:voided_at|credited_minor)\b/.test(error.message)
  );
}

// --- invoices ----------------------------------------------------------

/**
 * The `/invoices` list screen's row: contact details alongside the totals,
 * where `lib/data/invoices.ts` has only narrower or export-shaped reads.
 */
export async function listInvoicesForListPage(supabase: ServerClient) {
  try {
    return await readAll("documentsExtra.listInvoicesForListPage", () =>
      supabase
        .from("invoices")
        .select(
          `id, number, status, total_minor, issue_date, public_token, voided_at, credited_minor, ${INVOICE_CUSTOMER}(name, email, phone)`,
        )
        .is("deleted_at", null)
        .eq("archived", false)
        .order("number", { ascending: false }),
    );
  } catch (error) {
    if (!isMissingDocumentIntegrityColumn(error)) throw error;
    return (
      await readAll("documentsExtra.listInvoicesForListPage", () =>
        supabase
          .from("invoices")
          .select(
            `id, number, status, total_minor, issue_date, public_token, ${INVOICE_CUSTOMER}(name, email, phone)`,
          )
          .is("deleted_at", null)
          .eq("archived", false)
          .order("number", { ascending: false }),
      )
    ).map((row) => ({
      ...row,
      voided_at: null,
      credited_minor: 0,
    }));
  }
}

/**
 * Settled payments for one invoice's detail screen — including a deposit paid
 * against the estimate the invoice was converted from, matching
 * `openBalance()` in `lib/payments/server.ts`. Not the same shape as
 * `payments.listSettledForInvoice`, which only ever filters by `invoice_id`.
 */
export function listSettledPaymentsForInvoiceOrEstimate(
  supabase: ServerClient,
  invoiceId: string,
  estimateId: string | null,
) {
  return readAll("documentsExtra.listSettledPaymentsForInvoiceOrEstimate", () => {
    const base = supabase
      .from("payments")
      .select(
        "amount_minor, base_amount_minor, refunded_minor, normalized_status, method, reference, paid_at",
      )
      .in("normalized_status", [...SETTLED])
      .order("paid_at");
    return estimateId
      ? base.or(`invoice_id.eq.${invoiceId},estimate_id.eq.${estimateId}`)
      : base.eq("invoice_id", invoiceId);
  });
}

/**
 * At most `limit` payment ids for one invoice — used only to check whether a
 * payment has already been logged before recording a manual one. The bound is
 * required, as everywhere else in the gateway.
 */
export function listPaymentIdsForInvoice(supabase: ServerClient, invoiceId: string, limit: number) {
  return readAtMost(
    "documentsExtra.listPaymentIdsForInvoice",
    () => supabase.from("payments").select("id").eq("invoice_id", invoiceId),
    limit,
  );
}

/**
 * Invoices selected for a bulk send, with the customer fields consent and
 * messaging need — a wider embed than any existing invoices repository read.
 */
export function listInvoicesForBulkSend(supabase: ServerClient, ids: string[]) {
  if (!ids.length) return Promise.resolve([]);
  return readAll("documentsExtra.listInvoicesForBulkSend", () =>
    supabase
      .from("invoices")
      .select(
        `id, number, total_minor, public_token, customer_id, ${INVOICE_CUSTOMER}(id, name, phone, email, sms_opt_in, email_opt_in, deleted_at)`,
      )
      .in("id", ids)
      .is("deleted_at", null),
  );
}

// --- estimates -----------------------------------------------------------

/**
 * The `/estimates` list screen's row: contact details alongside the totals,
 * the estimates equivalent of `listInvoicesForListPage` above.
 */
export async function listEstimatesForListPage(supabase: ServerClient) {
  try {
    return await readAll("documentsExtra.listEstimatesForListPage", () =>
      supabase
        .from("estimates")
        .select(
          `id, number, status, total_minor, issue_date, public_token, voided_at, ${ESTIMATE_CUSTOMER}(name, email, phone)`,
        )
        .is("deleted_at", null)
        .eq("archived", false)
        .order("number", { ascending: false }),
    );
  } catch (error) {
    if (!isMissingDocumentIntegrityColumn(error)) throw error;
    return (
      await readAll("documentsExtra.listEstimatesForListPage", () =>
        supabase
          .from("estimates")
          .select(
            `id, number, status, total_minor, issue_date, public_token, ${ESTIMATE_CUSTOMER}(name, email, phone)`,
          )
          .is("deleted_at", null)
          .eq("archived", false)
          .order("number", { ascending: false }),
      )
    ).map((row) => ({ ...row, voided_at: null }));
  }
}

// --- expenses --------------------------------------------------------------

/**
 * Every expense, newest first, for the `/expenses` screen.
 *
 * Unlike every shape in `lib/data/operations.ts`, this one carries no date
 * window — the screen renders the full list and computes this month's total
 * client-side. Was read with no bound at all before this migration.
 */
export function listAllExpenses(supabase: ServerClient) {
  return readAll("documentsExtra.listAllExpenses", () =>
    supabase
      .from("expenses")
      .select("id, expense_date, category, vendor, amount_minor")
      .order("expense_date", { ascending: false }),
  );
}
