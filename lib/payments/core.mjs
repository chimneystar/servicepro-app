/** Normalize Helcim card and ACH responses without treating ACH submission as settlement. */
export function normalizeHelcimTransaction(data) {
  const isAch =
    data?.statusAuth !== undefined || String(data?.type ?? "").toUpperCase() === "WITHDRAWAL";
  if (isAch) {
    const authorization = String(data?.statusAuth ?? "").toUpperCase();
    const clearing = String(data?.statusClearing ?? "").toUpperCase();
    const settled = clearing === "1" || clearing === "APPROVED" || clearing === "CLOSED";
    const failed =
      authorization === "2" ||
      authorization === "DECLINED" ||
      clearing === "4" ||
      clearing === "DECLINED";
    return { method: "ach", status: failed ? "failed" : settled ? "settled" : "processing" };
  }
  const status = String(data?.status ?? "").toUpperCase();
  return {
    method: "card",
    status: status === "APPROVED" || status === "APPROVAL" ? "settled" : "failed",
  };
}
/** Payment statuses that represent money the business has actually received. */
export const SETTLED_STATUSES = ["settled", "partially_refunded"];

/**
 * Money actually collected from a set of payment rows, in minor units.
 *
 * Two rules, both of which were violated somewhere in the app:
 *   - only settled/partially_refunded rows count (a declined card and an ACH
 *     transfer still in flight are NOT money);
 *   - refunds are subtracted.
 */
export function creditedMinor(rows) {
  // A non-finite value must contribute 0, not NaN. Math.max(0, NaN) is NaN, so
  // a single malformed row would otherwise poison the entire balance and make
  // an invoice unpayable — the same class of defect as the float money maths in
  // finance/actions.ts.
  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  return (rows ?? [])
    .filter((row) => SETTLED_STATUSES.includes(String(row?.normalized_status ?? "")))
    .reduce(
      (sum, row) =>
        sum +
        Math.max(
          0,
          num(row?.base_amount_minor ?? row?.amount_minor ?? 0) - num(row?.refunded_minor ?? 0),
        ),
      0,
    );
}

/**
 * What is still owed on a document, in minor units.
 *
 * For an invoice converted from an estimate, `rows` must include payments booked
 * against BOTH the invoice and the originating estimate — a paid deposit lives
 * on payments.estimate_id, and omitting it is what caused customers to be billed
 * for their deposit a second time. See db/024_deposit_credit.sql.
 */
export function openBalanceMinor(amountMinor, rows) {
  const total = Number(amountMinor);
  return Math.max(0, (Number.isFinite(total) ? total : 0) - creditedMinor(rows));
}

/** Validate the base amount while allowing Helcim's eligible Fee Saver surcharge. */
export function paymentAmountParts(requestedMinor, actualAmount, feeSaverRequested) {
  const actualMinor = Math.round(Number(actualAmount) * 100);
  const maxWithFee = feeSaverRequested
    ? Math.ceil(Number(requestedMinor) * 1.06) + 1
    : Number(requestedMinor);
  if (
    !Number.isSafeInteger(actualMinor) ||
    actualMinor < requestedMinor ||
    actualMinor > maxWithFee
  ) {
    throw new Error("payment amount mismatch");
  }
  return { actualMinor, surchargeMinor: Math.max(0, actualMinor - requestedMinor) };
}
