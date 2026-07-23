// =====================================================================
//  money.mjs — currency-safe calculations. NO floating point for money.
//  Multi-currency (USD, ILS, ...). Sales tax / VAT handled the same way.
//
//  Principles (why calculation mistakes cannot happen here):
//   * All money is stored & computed as INTEGER "minor units" (cents /
//     agorot): 1 USD = 100 cents, 1 ILS = 100 agorot. No floats, ever.
//   * Quantities are INTEGER "milliunits" (qty * 1000) so 1.5 hours etc.
//     are exact.
//   * Tax is a rate in BASIS POINTS (e.g. 8.25% = 825, US sales tax;
//     18% = 1800, Israeli VAT). Tax is added ON TOP of the subtotal and
//     shown as its own line — correct for US sales tax and for VAT display.
//   * Every division rounds half-up with pure integer arithmetic.
//   * The document total is ALWAYS recomputed on the server from the line
//     items — the client can never submit a total we didn't calculate.
// =====================================================================

/** Round a non-negative integer division, half-up, with integer math. */
function divRoundHalfUp(numerator, denominator) {
  if (denominator <= 0) throw new Error("denominator must be > 0");
  const sign = numerator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  return sign * Math.floor((n + Math.floor(denominator / 2)) / denominator);
}

/** Parse a user-entered amount ("1,234.5", "$100", "0.075") to integer minor units. */
export function parseAmountToMinor(input) {
  if (typeof input === "number") input = String(input);
  const cleaned = String(input).replace(/[$₪,\s]/g, "");
  if (cleaned === "") return 0;
  const m = cleaned.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error(`invalid amount: ${input}`);
  const sign = m[1] === "-" ? -1 : 1;
  const whole = m[2];
  const frac = m[3] ?? "";
  const minorDigits = (frac + "00").slice(0, 2);
  const roundDigit = frac.length > 2 ? frac.charCodeAt(2) - 48 : 0;
  let minor = Number(whole) * 100 + Number(minorDigits);
  if (roundDigit >= 5) minor += 1; // half-up on 3rd decimal
  return sign * minor;
}

/** Parse a quantity ("1.5", "8", "0.25") to integer milliunits (qty*1000). */
export function parseQtyToMilli(input) {
  if (typeof input === "number") input = String(input);
  const cleaned = String(input).replace(/[,\s]/g, "");
  if (cleaned === "") return 0;
  const m = cleaned.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error(`invalid quantity: ${input}`);
  const whole = m[1];
  const frac = m[2] ?? "";
  const milliDigits = (frac + "000").slice(0, 3);
  const roundDigit = frac.length > 3 ? frac.charCodeAt(3) - 48 : 0;
  let milli = Number(whole) * 1000 + Number(milliDigits);
  if (roundDigit >= 5) milli += 1;
  return milli;
}

/** Line subtotal (minor units) from qty(milliunits) and unit price(minor units). */
export function lineSubtotalMinor(qtyMilli, unitPriceMinor) {
  if (!Number.isInteger(qtyMilli) || !Number.isInteger(unitPriceMinor))
    throw new Error("lineSubtotalMinor expects integers");
  if (qtyMilli < 0 || unitPriceMinor < 0)
    throw new Error("negative values not allowed");
  return divRoundHalfUp(qtyMilli * unitPriceMinor, 1000);
}

/**
 * Compute an estimate/invoice total. All inputs & outputs are integers (minor units).
 * @param {{items:{qtyMilli:number,unitPriceMinor:number}[], discountMinor?:number, taxRateBps?:number}} doc
 *        taxRateBps = tax rate in basis points (8.25% = 825; 18% = 1800; no tax = 0).
 * @returns {{subtotalMinor:number, discountMinor:number, taxableMinor:number, taxMinor:number, totalMinor:number}}
 */
export function computeDocument(doc) {
  const items = doc.items ?? [];
  const taxRateBps = Number.isInteger(doc.taxRateBps) ? doc.taxRateBps : 0;
  if (taxRateBps < 0 || taxRateBps > 100000) throw new Error("taxRateBps out of range");

  let subtotal = 0;
  for (const it of items) subtotal += lineSubtotalMinor(it.qtyMilli, it.unitPriceMinor);

  const requestedDiscount = Number.isInteger(doc.discountMinor) ? doc.discountMinor : 0;
  if (requestedDiscount < 0) throw new Error("discount must be >= 0");
  const discount = Math.min(requestedDiscount, subtotal);
  const taxable = subtotal - discount;
  const tax = divRoundHalfUp(taxable * taxRateBps, 10000);
  const total = taxable + tax;

  if (!Number.isSafeInteger(total)) throw new Error("amount too large");
  return { subtotalMinor: subtotal, discountMinor: discount, taxableMinor: taxable, taxMinor: tax, totalMinor: total };
}

const CURRENCIES = {
  USD: { symbol: "$", defaultLocale: "en-US" },
  ILS: { symbol: "₪", defaultLocale: "he-IL" },
  EUR: { symbol: "€", defaultLocale: "en-IE" },
};

/** Format integer minor units as money, e.g. formatMoney(33040,{currency:'USD'}) => "$330.40". */
export function formatMoney(minor, { currency = "USD", locale } = {}) {
  const cur = CURRENCIES[currency] ?? CURRENCIES.USD;
  const loc = locale ?? cur.defaultLocale;
  const sign = minor < 0 ? "-" : "";
  const num = (Math.abs(minor) / 100).toLocaleString(loc, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${cur.symbol}${num}`;
}

export const MINOR_PER_UNIT = 100;
export const _internal = { divRoundHalfUp };
