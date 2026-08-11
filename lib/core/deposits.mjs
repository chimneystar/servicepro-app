// =====================================================================
//  deposits.mjs — the two deposit settings that were stored and never read.
//
//  1. payment_settings.default_deposit_type / _bps / _minor — the organisation
//     default deposit. `/settings/payments` saved it; NO DOCUMENT CODE HAS EVER
//     READ IT. Every estimate was created with deposit_minor = 0, so the owner
//     who set "25% deposit" once and expected it to apply got nothing, and only
//     found out when a customer scheduled work without paying.
//
//  2. booking_settings.payment_mode / deposit_value — the booking deposit. It
//     was surfaced as copy on the booking form ("a secure payment link will be
//     sent after confirmation") and no link was ever sent, because no deposit
//     was ever calculated, requested or charged.
//
//  UNITS, stated explicitly because the columns do not say:
//    default_deposit_bps    — basis points (2500 = 25%), 0..10000 by CHECK.
//    default_deposit_minor  — integer minor units (cents).
//    booking deposit_value  — `integer not null default 0`, and its meaning
//                             depends on payment_mode. The settings form labels
//                             the single input "Amount or percentage" with
//                             step=1, so:
//                               'percentage' -> whole percent (25 = 25%)
//                               'fixed'      -> whole currency units (75 = $75)
//                               'full'       -> ignored; the whole price
//                               'none'       -> no deposit
//                             There is no other reading available: the input
//                             cannot express cents, so treating the value as
//                             minor units would silently turn a $75 deposit
//                             into 75 cents.
//
//  Tests: tests/deposits.test.mjs
// =====================================================================

/** Round a non-negative integer division half-up, with integer arithmetic only. */
function divRoundHalfUp(numerator, denominator) {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new Error("divRoundHalfUp expects integers with denominator > 0");
  }
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

const wholeMinor = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
};

export const DEPOSIT_TYPES = ["none", "percent", "fixed"];
export const BOOKING_PAYMENT_MODES = ["none", "fixed", "percentage", "full"];

/**
 * The organisation's default deposit for a document of `totalMinor`.
 *
 * Returns integer minor units, never negative, never more than the document
 * total — a fixed default of $500 on a $200 job asks for $200, not a deposit
 * that exceeds the bill and can never be settled.
 *
 * A malformed settings row (null, a string, a NaN) yields 0 rather than NaN:
 * the failure mode of NaN here is an estimate whose deposit_minor cannot be
 * stored at all, i.e. estimate creation breaking for the whole organisation.
 */
export function defaultDepositMinor(settings, totalMinor) {
  const total = wholeMinor(totalMinor);
  if (total <= 0) return 0;
  const type = String(settings?.default_deposit_type ?? settings?.type ?? "none");
  if (!DEPOSIT_TYPES.includes(type) || type === "none") return 0;

  if (type === "percent") {
    const bps = wholeMinor(settings?.default_deposit_bps ?? settings?.bps);
    if (bps <= 0) return 0;
    return Math.min(total, divRoundHalfUp(total * Math.min(bps, 10000), 10000));
  }

  const fixed = wholeMinor(settings?.default_deposit_minor ?? settings?.fixedMinor);
  return Math.min(total, fixed);
}

/**
 * The deposit an online booking must collect, in integer minor units.
 *
 * `servicePriceMinor` is `booking_services.price_minor` — the price the customer
 * was shown for the service they picked. A service priced at 0 (a free
 * inspection, or a business that never filled the price in) yields no deposit
 * for every mode INCLUDING 'fixed': asking for a fixed deposit against a
 * priceless booking would be charging for something with no stated value.
 */
export function bookingDepositMinor({ mode, value, servicePriceMinor }) {
  const price = wholeMinor(servicePriceMinor);
  const chosen = String(mode ?? "none");
  if (!BOOKING_PAYMENT_MODES.includes(chosen) || chosen === "none" || price <= 0) return 0;

  if (chosen === "full") return price;

  const raw = wholeMinor(value);
  if (raw <= 0) return 0;

  if (chosen === "percentage") {
    return Math.min(price, divRoundHalfUp(price * Math.min(raw, 100), 100));
  }
  // 'fixed' — whole currency units, converted to minor units.
  return Math.min(price, raw * 100);
}

/** Human-readable description of a deposit rule, for the settings screen. */
export function describeDeposit(settings, sampleTotalMinor = 100000) {
  const amount = defaultDepositMinor(settings, sampleTotalMinor);
  return { sampleTotalMinor, depositMinor: amount, applies: amount > 0 };
}
