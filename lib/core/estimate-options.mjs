// =====================================================================
//  estimate-options.mjs — good / better / best.
//
//  WHY THIS EXISTS (remediation plan 6c.4)
//  ---------------------------------------
//  Presenting three priced options is the single biggest close-rate lever in
//  this product category, and the app could only ever produce one flat price.
//
//  THE MODEL, AND THE TWO THINGS IT MUST NOT BREAK.
//  An option is a named bundle of line items belonging to ONE estimate. When
//  the customer chooses, the option's lines are COPIED INTO `estimate_items`
//  and the estimate's total is recomputed. The estimate's id and public token
//  do not move.
//
//    1. DEPOSITS. `db/024_deposit_credit.sql` credits a paid deposit through
//       `invoices.estimate_id` -> `payments.estimate_id`. Because the estimate
//       row is the same row before and after a choice, that chain is untouched;
//       a deposit paid against the estimate still credits the invoice.
//    2. CONVERSION. `convertEstimateToInvoice` reads `estimate_items`, so the
//       CHOSEN option is what converts, with no new branch and no second
//       document path to keep in step.
//
//  Tests: tests/estimate-options.test.mjs
// =====================================================================

import { computeDocument } from "./money.mjs";

/** Ordered cheapest-first. The order is the sales story, so it is fixed. */
export const OPTION_TIERS = ["good", "better", "best"];

export const TIER_LABELS = {
  good: { en: "Good", he: "בסיסי" },
  better: { en: "Better", he: "מומלץ" },
  best: { en: "Best", he: "מקסימלי" },
};

const finite = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function isTier(value) {
  return OPTION_TIERS.includes(String(value ?? ""));
}

/** Sort key so 'good' is always first however the rows arrive from PostgREST. */
export function tierRank(tier) {
  const index = OPTION_TIERS.indexOf(String(tier ?? ""));
  return index === -1 ? OPTION_TIERS.length : index;
}

export function sortOptions(options) {
  return [...(options ?? [])].sort((a, b) => {
    const rank = tierRank(a?.tier) - tierRank(b?.tier);
    return rank !== 0 ? rank : finite(a?.sort) - finite(b?.sort);
  });
}

/**
 * What one option costs the customer, through the SAME engine every other
 * document uses. The option must not have its own arithmetic: two totals
 * computed two ways is how a customer is shown one price and billed another.
 */
export function optionTotals(
  option,
  { discountMinor = 0, taxRateBps = 0, taxExempt = false } = {},
) {
  return computeDocument({
    items: (option?.items ?? []).map((item) => ({
      qtyMilli: finite(item?.qty_milli ?? item?.qtyMilli),
      unitPriceMinor: finite(item?.unit_price_minor ?? item?.unitPriceMinor),
      taxable: (item?.taxable ?? true) !== false,
    })),
    discountMinor: finite(discountMinor),
    taxRateBps: finite(taxRateBps),
    taxExempt: taxExempt === true,
  });
}

/**
 * The deposit for a chosen option.
 *
 * An option that states its own deposit wins. An option that does not keeps
 * whatever the estimate already asked for — which may be the organisation
 * default that migration 031 applies at insert (ledger 5.6) — so choosing an
 * option cannot silently cancel a deposit the business configured.
 *
 * Always clamped to the option's total: a cheaper option must never leave a
 * deposit larger than the job, which would ask the customer for money the
 * invoice could never absorb and would break the 024 credit.
 */
export function optionDepositMinor({ optionDeposit, estimateDeposit, totalMinor }) {
  const total = Math.max(0, finite(totalMinor));
  const requested =
    finite(optionDeposit) > 0 ? finite(optionDeposit) : Math.max(0, finite(estimateDeposit));
  return Math.min(Math.max(0, requested), total);
}

/**
 * May this estimate still be re-priced by choosing an option?
 *
 * A SIGNED estimate may not. `approve_document` was hardened in migration 023
 * §6 so a signed document cannot be re-signed and its evidence destroyed;
 * silently swapping the priced lines underneath an existing signature would
 * defeat that guard just as completely, so it is refused with a reason.
 */
export function canSelectOption(estimate) {
  if (!estimate) return { ok: false, error: "not_found" };
  if (estimate.deleted_at) return { ok: false, error: "not_found" };
  if (estimate.signed_at) return { ok: false, error: "already_signed" };
  return { ok: true };
}

/**
 * Validate a selection end to end. Proven in both directions: a known option on
 * an open estimate is accepted, and every other combination names its reason.
 */
export function validateSelection({ estimate, options, optionId }) {
  const gate = canSelectOption(estimate);
  if (!gate.ok) return gate;
  const option = (options ?? []).find((row) => row?.id === optionId);
  if (!option) return { ok: false, error: "unknown_option" };
  return { ok: true, option };
}

/**
 * Is this estimate ready to convert?
 *
 * An estimate that OFFERS options and has none chosen must not convert: the
 * `estimate_items` at that moment are whatever was last written, so converting
 * would invoice a price the customer never picked. This is the guard that makes
 * "the chosen option is what converts" true rather than merely likely.
 */
export function conversionReadiness({ optionCount, selectedOptionId }) {
  if (finite(optionCount) <= 0) return { ok: true, reason: "no_options" };
  if (!selectedOptionId) return { ok: false, reason: "option_not_chosen" };
  return { ok: true, reason: "option_chosen" };
}

/** Tier labels for a chooser, in the customer's language. */
export function tierLabel(tier, locale = "en") {
  const entry = TIER_LABELS[String(tier ?? "")];
  if (!entry) return String(tier ?? "");
  return locale === "he" ? entry.he : entry.en;
}

/**
 * Summarise the options for a chooser: totals through the document engine, the
 * recommended one flagged, and the difference from the cheapest so the customer
 * sees the upgrade rather than three unrelated numbers.
 */
export function describeOptions(options, documentContext = {}) {
  const sorted = sortOptions(options);
  const rows = sorted.map((option) => {
    const totals = optionTotals(option, documentContext);
    return {
      id: option?.id,
      tier: option?.tier,
      title: option?.title || "",
      description: option?.description ?? null,
      recommended: option?.recommended === true,
      totalMinor: totals.totalMinor,
      subtotalMinor: totals.subtotalMinor,
      taxMinor: totals.taxMinor,
      depositMinor: optionDepositMinor({
        optionDeposit: option?.deposit_minor,
        estimateDeposit: documentContext.estimateDeposit,
        totalMinor: totals.totalMinor,
      }),
      itemCount: (option?.items ?? []).length,
    };
  });
  const cheapest = rows.length ? Math.min(...rows.map((row) => row.totalMinor)) : 0;
  return rows.map((row) => ({ ...row, upgradeMinor: row.totalMinor - cheapest }));
}
