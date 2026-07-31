// =====================================================================
//  ach-hold.mjs — "hold the work until the bank clears the money".
//
//  THE GAP THIS CLOSES. `payment_settings.ach_hold_until_settled` defaulted to
//  true, was rendered as a switch labelled "The job remains on hold until the
//  bank confirms settlement", and WAS READ BY NOTHING. The customer-facing
//  payment screen made the same promise in two languages. No code anywhere held
//  anything.
//
//  WHY AN ACH HOLD IS NOT THE SAME AS "the invoice is not paid yet". The rest of
//  this product already refuses to count an in-flight ACH as money: every
//  collected-money reader filters on normalized_status in ('settled',
//  'partially_refunded'). That was never the question. The question the toggle
//  asks is the opposite one — *may the work start before the money clears?* ACH
//  takes days and can be returned after it appears to have gone through, so a
//  business that dispatches a technician on a submitted-but-uncleared transfer
//  is carrying real risk, and a business that would rather carry that risk
//  (a long-standing customer, a small job) should be able to say so.
//
//  So the hold governs RELEASE OF DEPOSIT-GATED WORK:
//    hold ON  (default) — the work is released when the deposit SETTLES.
//    hold OFF           — the work is released as soon as the deposit is
//                         SUBMITTED, and the business accepts the return risk.
//
//  It deliberately does NOT block a technician from completing a job in the
//  field. Work already done is done; refusing to record it because a customer's
//  bank is slow would corrupt the timesheet and the job record to no purpose.
//
//  `can_override_ach_holds` — a permission that has existed since migration 017
//  and, like the toggle, granted nothing — is what lets a named person release a
//  held deposit early, one at a time, with the release recorded.
//
//  Tests: tests/ach-hold.test.mjs
// =====================================================================

const finite = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Statuses that mean the money has actually arrived. */
export const SETTLED_STATUSES = ["settled", "partially_refunded"];

/**
 * Is this payment row an ACH transfer?
 *
 * `payments.method` is written as the literal "ACH" by confirmHelcimCheckout
 * (see lib/payments/server.ts) and as "Zelle"/"Check"/"Credit card" elsewhere,
 * so the method string is the discriminator. Matched case-insensitively because
 * a hand-recorded payment may say "ach".
 */
export function isAchPayment(payment) {
  return (
    String(payment?.method ?? "")
      .trim()
      .toUpperCase() === "ACH"
  );
}

/** Is this payment still in flight at the bank? */
export function isInFlight(payment) {
  return String(payment?.normalized_status ?? "") === "processing";
}

/** Money actually received from these rows, net of refunds, in minor units. */
export function settledMinor(payments) {
  return (payments ?? [])
    .filter((p) => SETTLED_STATUSES.includes(String(p?.normalized_status ?? "")))
    .reduce(
      (sum, p) =>
        sum +
        Math.max(0, finite(p?.base_amount_minor ?? p?.amount_minor) - finite(p?.refunded_minor)),
      0,
    );
}

/** Money submitted by ACH that has not cleared, in minor units. */
export function pendingAchMinor(payments) {
  return (payments ?? [])
    .filter((p) => isAchPayment(p) && isInFlight(p))
    .reduce((sum, p) => sum + Math.max(0, finite(p?.base_amount_minor ?? p?.amount_minor)), 0);
}

/**
 * Is there an uncleared ACH transfer that the hold applies to?
 * `held` is false when the business switched the hold off, even though the
 * money is still in flight — that is the whole point of the switch.
 */
export function achHoldState({ holdEnabled, payments }) {
  const pendingMinor = pendingAchMinor(payments);
  const count = (payments ?? []).filter((p) => isAchPayment(p) && isInFlight(p)).length;
  return { held: !!holdEnabled && pendingMinor > 0, pendingMinor, count };
}

/**
 * Should deposit-gated work be released?
 *
 * @param {{holdEnabled:boolean, requiredMinor:number, payments:Array, overridden?:boolean}} input
 * @returns {{released:boolean, reason:string, settledMinor:number, pendingMinor:number}}
 *
 * `overridden` is a recorded decision by someone holding can_override_ach_holds.
 * It releases in-flight ACH only — it can never release work whose deposit was
 * never paid at all, because there would be nothing to override.
 */
export function depositReleaseDecision({
  holdEnabled,
  requiredMinor,
  payments,
  overridden = false,
}) {
  const required = Math.max(0, finite(requiredMinor));
  const settled = settledMinor(payments);
  const pending = pendingAchMinor(payments);

  if (required <= 0)
    return {
      released: true,
      reason: "no_deposit_required",
      settledMinor: settled,
      pendingMinor: pending,
    };
  if (settled >= required)
    return { released: true, reason: "settled", settledMinor: settled, pendingMinor: pending };

  if (settled + pending >= required) {
    if (!holdEnabled)
      return {
        released: true,
        reason: "hold_disabled",
        settledMinor: settled,
        pendingMinor: pending,
      };
    if (overridden)
      return { released: true, reason: "overridden", settledMinor: settled, pendingMinor: pending };
    return {
      released: false,
      reason: "awaiting_settlement",
      settledMinor: settled,
      pendingMinor: pending,
    };
  }

  return {
    released: false,
    reason: "deposit_unpaid",
    settledMinor: settled,
    pendingMinor: pending,
  };
}
