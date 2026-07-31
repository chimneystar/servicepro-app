// Reporting arithmetic. Plain ESM so `node --test` executes it directly.
//
// WHY THIS EXISTS
// ---------------
// /reports, /reports/custom and /reports/commission each computed revenue and
// margin inline, and all three got it wrong in the same two ways:
//
//   1. "Revenue collected" summed invoices.total_minor for invoices whose status
//      is 'paid'. That is what was BILLED, not what was RECEIVED — it ignores
//      partial payments, refunds and surcharges, and counts an invoice a user
//      hand-marked paid at full face value even if no money arrived.
//
//   2. Gross profit was computed from item-level figures (qty x price - cost),
//      which EXCLUDE discount and tax, while revenue INCLUDED both. The two
//      sides of the margin were on different bases, so on any discounted
//      invoice the reported margin exceeded reality.
//
// The owner makes payroll and tax decisions on these numbers, so they are
// computed here once, in integer minor units, and unit-tested.
//
// Tests: tests/reporting.test.mjs

import { computeDocument, lineSubtotalMinor } from "./money.mjs";

/** Payment statuses that represent money actually received. */
export const COLLECTED_STATUSES = ["settled", "partially_refunded"];

const finite = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Cash actually collected, in minor units: settled payments net of refunds.
 * This is the honest answer to "how much money came in".
 */
export function collectedMinor(payments) {
  return (payments ?? [])
    .filter((p) => COLLECTED_STATUSES.includes(String(p?.normalized_status ?? "")))
    .reduce((sum, p) => sum + Math.max(0, finite(p?.base_amount_minor ?? p?.amount_minor) - finite(p?.refunded_minor)), 0);
}

/** Total cost of materials on a set of invoice line items. */
export function materialsCostMinor(items) {
  return (items ?? []).reduce(
    (sum, it) => sum + lineSubtotalMinor(finite(it?.qty_milli), finite(it?.cost_minor)),
    0,
  );
}

/**
 * Revenue excluding tax for one invoice.
 *
 * Tax collected is a liability owed to the tax authority, not income. Counting
 * it as revenue inflates both the revenue line and the margin.
 */
export function invoiceRevenueExTaxMinor(invoice, items) {
  const totals = computeDocument({
    items: (items ?? []).map((it) => ({
      qtyMilli: finite(it?.qty_milli),
      unitPriceMinor: finite(it?.unit_price_minor),
      taxable: it?.taxable !== false,
    })),
    discountMinor: finite(invoice?.discount_minor),
    taxRateBps: finite(invoice?.tax_rate_bps),
  });
  return totals.totalMinor - totals.taxMinor;
}

/**
 * The full picture for a reporting period.
 *
 * `payments`  — settled payment rows whose paid_at falls in the period.
 * `invoices`  — invoices considered earned in the period.
 * `itemsByInvoice` — invoice_id -> line items.
 *
 * `collectedMinor` is cash in. `grossProfitMinor` deliberately uses revenue
 * EXCLUDING tax minus materials cost, so both sides of the margin share a basis.
 */
export function periodTotals({ payments, invoices, itemsByInvoice, expensesMinor = 0 }) {
  const collected = collectedMinor(payments);

  let revenueExTax = 0;
  let materials = 0;
  for (const invoice of invoices ?? []) {
    const items = itemsByInvoice?.[invoice.id] ?? [];
    revenueExTax += invoiceRevenueExTaxMinor(invoice, items);
    materials += materialsCostMinor(items);
  }

  const grossProfit = revenueExTax - materials;
  return {
    collectedMinor: collected,
    revenueExTaxMinor: revenueExTax,
    materialsCostMinor: materials,
    grossProfitMinor: grossProfit,
    expensesMinor: finite(expensesMinor),
    netProfitMinor: grossProfit - finite(expensesMinor),
  };
}

/**
 * Commission base per technician.
 *
 * Commission was paid on jobs.price_minor — what was QUOTED — so technicians
 * earned on work the business was never paid for. This attributes actual
 * collected money to the technician assigned to the invoice's job.
 *
 * `rows`: { technician, collectedMinor } after grouping.
 */
export function commissionMinor(collectedForTechMinor, commissionPct) {
  const pct = Math.min(100, Math.max(0, finite(commissionPct)));
  const collected = Math.max(0, finite(collectedForTechMinor));
  // Integer half-up: (collected * pct + 50) / 100, floored.
  return Math.floor((collected * pct + 50) / 100);
}
