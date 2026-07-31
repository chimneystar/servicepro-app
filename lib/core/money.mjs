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
  if (qtyMilli < 0 || unitPriceMinor < 0) throw new Error("negative values not allowed");
  return divRoundHalfUp(qtyMilli * unitPriceMinor, 1000);
}

/**
 * Compute an estimate/invoice total. All inputs & outputs are integers (minor units).
 *
 * Per-item tax: each item may carry `taxable` (default TRUE). Tax is applied
 * only to the taxable portion of the subtotal. A document-level discount is
 * split across the taxable / non-taxable portions in proportion to their share
 * of the subtotal, so the taxable base after discount stays exact and fair.
 *
 * `taxRateBps` is ONE effective rate. Where that rate comes from is the
 * caller's business: a flat organisation rate, or the combination of the tax
 * jurisdictions in force on the document's date (see `resolveTaxJurisdictions`,
 * which returns exactly this number). Combining happens BEFORE the multiply, so
 * there is a single half-up rounding for the whole document and no per-rule
 * rounding drift.
 *
 * `taxExempt` is ADDITIVE and defaults to false: a caller that does not pass it
 * gets byte-identical results to before this option existed.
 *
 * @param {{items:{qtyMilli:number,unitPriceMinor:number,taxable?:boolean}[],
 *          discountMinor?:number, taxRateBps?:number, taxExempt?:boolean}} doc
 *        taxRateBps = tax rate in basis points (8.25% = 825; 18% = 1800; no tax = 0).
 *        taxExempt  = the customer holds a valid exemption; no tax is charged and
 *                     the base that would have been taxed is reported separately
 *                     (a tax filing has to report exempt sales, not lose them).
 * @returns {{subtotalMinor:number, discountMinor:number, taxableMinor:number,
 *            taxMinor:number, totalMinor:number, taxRateBps:number, exemptMinor:number}}
 */
export function computeDocument(doc) {
  const items = doc.items ?? [];
  const taxRateBps = Number.isInteger(doc.taxRateBps) ? doc.taxRateBps : 0;
  if (taxRateBps < 0 || taxRateBps > 100000) throw new Error("taxRateBps out of range");
  const taxExempt = doc.taxExempt === true;
  const appliedRateBps = taxExempt ? 0 : taxRateBps;

  let subtotal = 0;
  let taxableSubtotal = 0;
  for (const it of items) {
    const line = lineSubtotalMinor(it.qtyMilli, it.unitPriceMinor);
    subtotal += line;
    if (it.taxable !== false) taxableSubtotal += line; // default: taxable
  }

  const requestedDiscount = Number.isInteger(doc.discountMinor) ? doc.discountMinor : 0;
  if (requestedDiscount < 0) throw new Error("discount must be >= 0");
  const discount = Math.min(requestedDiscount, subtotal);

  // Allocate the discount to the taxable portion proportionally (integer, half-up).
  const discountOnTaxable = subtotal > 0 ? divRoundHalfUp(discount * taxableSubtotal, subtotal) : 0;
  const taxBase = taxableSubtotal - discountOnTaxable;
  const tax = divRoundHalfUp(taxBase * appliedRateBps, 10000);
  const total = subtotal - discount + tax;

  if (!Number.isSafeInteger(total)) throw new Error("amount too large");
  return {
    subtotalMinor: subtotal,
    discountMinor: discount,
    taxableMinor: taxExempt ? 0 : taxBase,
    taxMinor: tax,
    totalMinor: total,
    taxRateBps: appliedRateBps,
    exemptMinor: taxExempt ? taxBase : 0,
  };
}

// =====================================================================
//  Tax jurisdictions — turning `tax_jurisdictions` rows into ONE rate.
//
//  US sales tax is ADDITIVE, not compounding: state 6.25% + county 1% +
//  city 1% is charged as 8.25% of the base, not as three successive
//  multiplications. So the correct combination is to sum the basis points
//  of every rule in force and multiply once. That also means there is
//  exactly one rounding step, which is why the result is identical to the
//  flat-rate path for the same effective rate — see tests/money.test.mjs.
//
//  Dates are compared as 'YYYY-MM-DD' strings. That is lexicographically
//  ordered, has no timezone, and never constructs a Date — the same reason
//  the rest of this file never constructs a float.
// =====================================================================

/** Normalise a day to 'YYYY-MM-DD'. Accepts a Date, an ISO string, or nothing (=> today, UTC). */
function normalizeDay(value) {
  if (value == null) return new Date().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const day = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`invalid date: ${value}`);
  return day;
}

/** Accept a `tax_jurisdictions` row (snake_case, straight from PostgREST) or a camelCase object. */
function normalizeJurisdiction(raw) {
  const rateBps = raw.rateBps ?? raw.rate_bps ?? 0;
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 100000)
    throw new Error("jurisdiction rate must be an integer 0..100000 basis points");
  const from = raw.effectiveFrom ?? raw.effective_from ?? null;
  const to = raw.effectiveTo ?? raw.effective_to ?? null;
  return {
    id: raw.id ?? null,
    name: raw.name ?? "",
    rateBps,
    appliesTo: raw.appliesTo ?? raw.applies_to ?? "all",
    active: (raw.active ?? true) !== false,
    effectiveFrom: from ? normalizeDay(from) : null,
    effectiveTo: to ? normalizeDay(to) : null,
  };
}

/**
 * Combine the tax jurisdictions that are in force on `onDate` into one effective rate.
 *
 * A rule is SKIPPED, with a machine-readable reason, when it is inactive, when
 * the day falls outside its effective window, or when it is scoped to something
 * narrower than the whole sale.
 *
 * `applies_to` of 'labor' / 'materials' / 'custom' is reported as
 * `unsupported_scope` and contributes NOTHING. That is deliberate: line items in
 * this product carry a `taxable` boolean and nothing else — no column anywhere
 * classifies a line as labour or materials — so a labour-only rate cannot be
 * applied to the right base. Applying it to everything would overcharge; applying
 * it to nothing without saying so would silently undercharge. It is reported.
 *
 * @param {Array<object>} jurisdictions rows from `tax_jurisdictions`
 * @param {{onDate?: string|Date}} [options]
 * @returns {{effectiveBps:number, applied:Array<object>, skipped:Array<{rule:object,reason:string}>}}
 */
export function resolveTaxJurisdictions(jurisdictions, options = {}) {
  const onDate = normalizeDay(options.onDate);
  const applied = [];
  const skipped = [];
  for (const raw of jurisdictions ?? []) {
    const rule = normalizeJurisdiction(raw);
    if (!rule.active) {
      skipped.push({ rule, reason: "inactive" });
      continue;
    }
    if (rule.effectiveFrom && onDate < rule.effectiveFrom) {
      skipped.push({ rule, reason: "not_yet_effective" });
      continue;
    }
    if (rule.effectiveTo && onDate > rule.effectiveTo) {
      skipped.push({ rule, reason: "expired" });
      continue;
    }
    if (rule.appliesTo !== "all") {
      skipped.push({ rule, reason: "unsupported_scope" });
      continue;
    }
    applied.push(rule);
  }
  const effectiveBps = applied.reduce((sum, rule) => sum + rule.rateBps, 0);
  return { effectiveBps, applied, skipped };
}

/**
 * Does the customer hold an exemption that is valid on `onDate`?
 * Accepts `customer_tax_exemptions` rows. An exemption with no expiry never lapses.
 */
export function isCustomerTaxExempt(exemptions, options = {}) {
  const onDate = normalizeDay(options.onDate);
  return (exemptions ?? []).some((raw) => {
    if ((raw.active ?? true) === false) return false;
    const expires = raw.expiresOn ?? raw.expires_on ?? null;
    return !expires || normalizeDay(expires) >= onDate;
  });
}

/**
 * Parse a percentage a human typed ("8.25", "0.125") into integer basis points.
 *
 * Rates went through `Math.round(Number(value) * 100)`, which is the same float
 * trap the money path was cleaned of: `Math.round(8.365 * 100)` is 836, not 837,
 * and a non-numeric entry became NaN and was written as null. A rate is not
 * money, but it multiplies money, so it gets the same integer treatment.
 */
export function parsePercentToBps(input) {
  const bps = parseAmountToMinor(input);
  if (bps < 0 || bps > 100000) throw new Error(`tax rate out of range: ${input}`);
  return bps;
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
