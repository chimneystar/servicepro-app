// Pure refund arithmetic and validation.
//
// Kept separate from lib/payments/refunds.ts so the rules that decide how much
// money can go back are unit-tested rather than reasoned about. Every branch
// here has a test that proves it BOTH refuses the bad case and permits the good
// one — a refund guard that only ever refuses would block legitimate corrections
// just as damagingly as one that lets an over-refund through.
//
// Tests: tests/refunds.test.mjs

const finite = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Statuses representing money actually received, and therefore refundable. */
export const REFUNDABLE_STATUSES = ["settled", "partially_refunded"];

/** What a single payment collected, in minor units. */
export function collectedOnPayment(payment) {
  return Math.max(0, finite(payment?.base_amount_minor ?? payment?.amount_minor));
}

/** What remains refundable on a single payment. */
export function remainingRefundable(payment) {
  return Math.max(0, collectedOnPayment(payment) - Math.max(0, finite(payment?.refunded_minor)));
}

/**
 * Net money still held from a set of payments — collected minus refunded.
 * Used to decide whether an invoice is still covered after a refund.
 */
export function refundableMinor(payments) {
  return (payments ?? [])
    .filter((p) => REFUNDABLE_STATUSES.includes(String(p?.normalized_status ?? "")))
    .reduce((sum, p) => sum + remainingRefundable(p), 0);
}

/**
 * Validate a requested refund against a payment.
 * Returns `{ ok: true, amountMinor }` or `{ ok: false, error }` — never throws,
 * so the caller can surface the reason to the user rather than a stack trace.
 */
export function validateRefundAmount(payment, requestedMinor) {
  const amount = Number(requestedMinor);

  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    return { ok: false, error: "Enter a refund amount." };
  }
  if (amount <= 0) {
    return { ok: false, error: "A refund must be greater than zero." };
  }

  const remaining = remainingRefundable(payment);
  if (remaining <= 0) {
    return { ok: false, error: "This payment has already been fully refunded." };
  }
  if (amount > remaining) {
    return {
      ok: false,
      error: `That is more than remains on this payment (${(remaining / 100).toFixed(2)} available).`,
    };
  }

  return { ok: true, amountMinor: amount };
}
