import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAmountToMinor, parseQtyToMilli, lineSubtotalMinor,
  computeDocument, formatMoney,
  resolveTaxJurisdictions, isCustomerTaxExempt, parsePercentToBps,
} from "../lib/core/money.mjs";

test("parse amounts to minor units (no float error)", () => {
  assert.equal(parseAmountToMinor("100"), 10000);
  assert.equal(parseAmountToMinor("100.00"), 10000);
  assert.equal(parseAmountToMinor("1,234.56"), 123456);
  assert.equal(parseAmountToMinor("$ 99.90"), 9990);
  assert.equal(parseAmountToMinor("0.1"), 10);
  assert.equal(parseAmountToMinor(140), 14000);
  assert.equal(parseAmountToMinor("0.3"), 30); // 0.1+0.2 float trap never occurs
});

test("parse amount rounds 3rd decimal half-up", () => {
  assert.equal(parseAmountToMinor("1.005"), 101);
  assert.equal(parseAmountToMinor("1.004"), 100);
});

test("rejects invalid amounts", () => {
  assert.throws(() => parseAmountToMinor("abc"));
  assert.throws(() => parseAmountToMinor("1.2.3"));
});

test("parse quantities to milliunits", () => {
  assert.equal(parseQtyToMilli("1"), 1000);
  assert.equal(parseQtyToMilli("1.5"), 1500);
  assert.equal(parseQtyToMilli("0.25"), 250);
  assert.equal(parseQtyToMilli("8"), 8000);
});

test("line subtotal: whole quantities ($140.00 × 2 = $280.00)", () => {
  assert.equal(lineSubtotalMinor(2000, 14000), 28000);
});

test("line subtotal: fractional quantity (1.5 hrs × $100.00 = $150.00)", () => {
  assert.equal(lineSubtotalMinor(1500, 10000), 15000);
});

test("line subtotal: rounding half-up", () => {
  assert.equal(lineSubtotalMinor(333, 300), 100);   // 0.333 × $3.00 = $0.999 -> $1.00
  assert.equal(lineSubtotalMinor(3000, 3333), 9999); // 3 × $33.33 = $99.99
});

test("document total: subtotal + 8.25% US sales tax", () => {
  const r = computeDocument({ items: [{ qtyMilli: 2000, unitPriceMinor: 14000 }], taxRateBps: 825 });
  assert.equal(r.subtotalMinor, 28000);
  assert.equal(r.taxMinor, 2310);   // 28000 * 0.0825 = 2310
  assert.equal(r.totalMinor, 30310);
});

test("document total: tax rounds correctly", () => {
  // taxable $99.99 at 8.25% = 824.9175 minor -> 825
  const r = computeDocument({ items: [{ qtyMilli: 3000, unitPriceMinor: 3333 }], taxRateBps: 825 });
  assert.equal(r.subtotalMinor, 9999);
  assert.equal(r.taxMinor, 825);
  assert.equal(r.totalMinor, 10824);
});

test("Israeli VAT 18% still works (same engine)", () => {
  const r = computeDocument({ items: [{ qtyMilli: 2000, unitPriceMinor: 14000 }], taxRateBps: 1800 });
  assert.equal(r.taxMinor, 5040);
  assert.equal(r.totalMinor, 33040);
});

test("no tax (rate 0)", () => {
  const r = computeDocument({ items: [{ qtyMilli: 1000, unitPriceMinor: 5000 }], taxRateBps: 0 });
  assert.equal(r.taxMinor, 0);
  assert.equal(r.totalMinor, 5000);
});

test("discount never makes taxable negative", () => {
  const r = computeDocument({ items: [{ qtyMilli: 1000, unitPriceMinor: 28000 }], discountMinor: 30000, taxRateBps: 825 });
  assert.equal(r.discountMinor, 28000);
  assert.equal(r.taxableMinor, 0);
  assert.equal(r.taxMinor, 0);
  assert.equal(r.totalMinor, 0);
});

test("multi-line document sums correctly", () => {
  const r = computeDocument({
    items: [
      { qtyMilli: 8000, unitPriceMinor: 15000 }, // 8 × 150 = 1200.00
      { qtyMilli: 8000, unitPriceMinor: 3500 },  // 8 × 35  =  280.00
    ],
    discountMinor: 10000,
    taxRateBps: 825,
  });
  assert.equal(r.subtotalMinor, 148000);
  assert.equal(r.taxableMinor, 138000);
  assert.equal(r.taxMinor, 11385);   // 138000 * 0.0825 = 11385
  assert.equal(r.totalMinor, 149385);
});

test("large amounts stay exact", () => {
  const r = computeDocument({ items: [{ qtyMilli: 1000, unitPriceMinor: 999999999 }], taxRateBps: 825 });
  assert.equal(r.subtotalMinor, 999999999);
  assert.equal(r.taxMinor, 82500000); // round(999999999*825/10000)=round(82499999.9175)=82500000
  assert.equal(r.totalMinor, 1082499999);
  assert.ok(Number.isSafeInteger(r.totalMinor));
});

test("negative inputs are rejected", () => {
  assert.throws(() => lineSubtotalMinor(-1000, 5000));
  assert.throws(() => computeDocument({ items: [{ qtyMilli: 1000, unitPriceMinor: 5000 }], discountMinor: -1 }));
});

test("format money (USD default, ILS, EUR)", () => {
  assert.equal(formatMoney(30310, { currency: "USD" }), "$303.10");
  assert.equal(formatMoney(5, { currency: "USD" }), "$0.05");
  assert.equal(formatMoney(100000, { currency: "USD" }), "$1,000.00");
  assert.equal(formatMoney(33040, { currency: "ILS" }), "₪330.40");
  assert.equal(formatMoney(-2500, { currency: "USD" }), "-$25.00");
});

test("per-item taxable: only taxable lines are taxed", () => {
  const r = computeDocument({
    items: [
      { qtyMilli: 1000, unitPriceMinor: 10000, taxable: true },  // $100 taxable
      { qtyMilli: 1000, unitPriceMinor: 5000, taxable: false },  // $50 not taxable (e.g. labor)
    ],
    taxRateBps: 1000, // 10%
  });
  assert.equal(r.subtotalMinor, 15000);
  assert.equal(r.taxableMinor, 10000);   // only the $100 line
  assert.equal(r.taxMinor, 1000);        // 10% of $100 = $10
  assert.equal(r.totalMinor, 16000);
});

test("per-item taxable: discount is split proportionally onto taxable base", () => {
  const r = computeDocument({
    items: [
      { qtyMilli: 1000, unitPriceMinor: 10000, taxable: true },  // $100 taxable
      { qtyMilli: 1000, unitPriceMinor: 10000, taxable: false }, // $100 non-taxable
    ],
    discountMinor: 4000, // $40 discount over $200 subtotal
    taxRateBps: 1000,    // 10%
  });
  // taxable share = 100/200 => $20 of the discount hits the taxable base => taxBase $80
  assert.equal(r.subtotalMinor, 20000);
  assert.equal(r.taxableMinor, 8000);
  assert.equal(r.taxMinor, 800);         // 10% of $80
  assert.equal(r.totalMinor, 16800);     // 200 - 40 + 8
});

test("all non-taxable => zero tax", () => {
  const r = computeDocument({
    items: [{ qtyMilli: 1000, unitPriceMinor: 12345, taxable: false }],
    taxRateBps: 825,
  });
  assert.equal(r.taxableMinor, 0);
  assert.equal(r.taxMinor, 0);
  assert.equal(r.totalMinor, 12345);
});

// =====================================================================
//  Tax jurisdictions (ledger 5.16). Everything above this line is the
//  pre-existing suite and is UNMODIFIED — the flat-rate path must behave
//  exactly as it did, and those assertions are what proves it.
// =====================================================================

test("flat rate is untouched: the new options are absent by default", () => {
  const r = computeDocument({ items: [{ qtyMilli: 2000, unitPriceMinor: 14000 }], taxRateBps: 825 });
  assert.equal(r.taxRateBps, 825);   // the rate actually applied is now reported
  assert.equal(r.exemptMinor, 0);
  assert.equal(r.taxMinor, 2310);
  assert.equal(r.totalMinor, 30310);
});

test("jurisdictions combine ADDITIVELY into one rate", () => {
  const rules = [
    { name: "Texas", rate_bps: 625, applies_to: "all", active: true, effective_from: "2020-01-01", effective_to: null },
    { name: "Travis County", rate_bps: 100, applies_to: "all", active: true, effective_from: "2020-01-01", effective_to: null },
    { name: "Austin", rate_bps: 100, applies_to: "all", active: true, effective_from: "2020-01-01", effective_to: null },
  ];
  const { effectiveBps, applied, skipped } = resolveTaxJurisdictions(rules, { onDate: "2026-07-31" });
  assert.equal(effectiveBps, 825);
  assert.equal(applied.length, 3);
  assert.equal(skipped.length, 0);
});

test("a resolved rate produces EXACTLY the flat-rate figures — no drift", () => {
  // 6.25 + 1.00 + 1.00 == 8.25. If the engine ever rounded per rule instead of
  // once over the combined rate, these two would diverge by a cent on some bases.
  const rules = [
    { rate_bps: 625, applies_to: "all", effective_from: "2020-01-01" },
    { rate_bps: 100, applies_to: "all", effective_from: "2020-01-01" },
    { rate_bps: 100, applies_to: "all", effective_from: "2020-01-01" },
  ];
  const bps = resolveTaxJurisdictions(rules, { onDate: "2026-07-31" }).effectiveBps;
  for (let cents = 1; cents <= 20000; cents += 1) {
    const flat = computeDocument({ items: [{ qtyMilli: 1000, unitPriceMinor: cents }], taxRateBps: 825 });
    const viaRules = computeDocument({ items: [{ qtyMilli: 1000, unitPriceMinor: cents }], taxRateBps: bps });
    assert.equal(viaRules.taxMinor, flat.taxMinor);
    assert.equal(viaRules.totalMinor, flat.totalMinor);
  }
});

test("a rule that is not yet effective must NOT be charged", () => {
  const rules = [
    { name: "State", rate_bps: 625, applies_to: "all", effective_from: "2020-01-01" },
    { name: "New city rate", rate_bps: 200, applies_to: "all", effective_from: "2026-10-01" },
  ];
  const before = resolveTaxJurisdictions(rules, { onDate: "2026-07-31" });
  assert.equal(before.effectiveBps, 625);
  assert.equal(before.skipped[0].reason, "not_yet_effective");
  // ...and on the day it starts, it is.
  assert.equal(resolveTaxJurisdictions(rules, { onDate: "2026-10-01" }).effectiveBps, 825);
});

test("an expired rule must NOT be charged; its last day still is", () => {
  const rules = [{ name: "Old district", rate_bps: 50, applies_to: "all", effective_from: "2020-01-01", effective_to: "2026-06-30" }];
  assert.equal(resolveTaxJurisdictions(rules, { onDate: "2026-06-30" }).effectiveBps, 50);
  const after = resolveTaxJurisdictions(rules, { onDate: "2026-07-01" });
  assert.equal(after.effectiveBps, 0);
  assert.equal(after.skipped[0].reason, "expired");
});

test("an inactive rule is skipped and says so", () => {
  const out = resolveTaxJurisdictions([{ rate_bps: 900, applies_to: "all", active: false, effective_from: "2020-01-01" }], { onDate: "2026-07-31" });
  assert.equal(out.effectiveBps, 0);
  assert.equal(out.skipped[0].reason, "inactive");
});

test("labor/materials-scoped rules are reported as unsupported, never silently applied", () => {
  const rules = [
    { name: "State", rate_bps: 625, applies_to: "all", effective_from: "2020-01-01" },
    { name: "Labour surcharge", rate_bps: 200, applies_to: "labor", effective_from: "2020-01-01" },
    { name: "Materials levy", rate_bps: 150, applies_to: "materials", effective_from: "2020-01-01" },
    { name: "Bespoke", rate_bps: 75, applies_to: "custom", effective_from: "2020-01-01" },
  ];
  const out = resolveTaxJurisdictions(rules, { onDate: "2026-07-31" });
  assert.equal(out.effectiveBps, 625);                       // NOT 1050
  assert.equal(out.skipped.length, 3);
  assert.deepEqual(out.skipped.map((s) => s.reason), ["unsupported_scope", "unsupported_scope", "unsupported_scope"]);
});

test("no rules at all resolves to zero, not to a guess", () => {
  assert.equal(resolveTaxJurisdictions([], { onDate: "2026-07-31" }).effectiveBps, 0);
  assert.equal(resolveTaxJurisdictions(null, { onDate: "2026-07-31" }).effectiveBps, 0);
});

test("a jurisdiction with a non-integer rate is rejected, not rounded", () => {
  assert.throws(() => resolveTaxJurisdictions([{ rate_bps: 8.25, applies_to: "all" }], { onDate: "2026-07-31" }));
  assert.throws(() => resolveTaxJurisdictions([{ rate_bps: 100001, applies_to: "all" }], { onDate: "2026-07-31" }));
});

test("customer exemption: a valid certificate means no tax, and the base is still reported", () => {
  const taxed = computeDocument({ items: [{ qtyMilli: 1000, unitPriceMinor: 50000 }], taxRateBps: 825 });
  assert.equal(taxed.taxMinor, 4125);
  const exempt = computeDocument({ items: [{ qtyMilli: 1000, unitPriceMinor: 50000 }], taxRateBps: 825, taxExempt: true });
  assert.equal(exempt.taxMinor, 0);
  assert.equal(exempt.taxRateBps, 0);
  assert.equal(exempt.taxableMinor, 0);
  assert.equal(exempt.exemptMinor, 50000);      // exempt sales are reportable, not lost
  assert.equal(exempt.totalMinor, 50000);
  assert.equal(exempt.subtotalMinor, taxed.subtotalMinor);
});

test("exemption respects the discount split, so exempt sales are reported net", () => {
  const r = computeDocument({
    items: [
      { qtyMilli: 1000, unitPriceMinor: 10000, taxable: true },
      { qtyMilli: 1000, unitPriceMinor: 10000, taxable: false },
    ],
    discountMinor: 4000, taxRateBps: 1000, taxExempt: true,
  });
  assert.equal(r.exemptMinor, 8000);   // the same base the non-exempt run would have taxed
  assert.equal(r.taxMinor, 0);
  assert.equal(r.totalMinor, 16000);   // 200 - 40, no tax
});

test("exemption validity is checked against the document date", () => {
  const exemptions = [{ active: true, expires_on: "2026-07-31" }];
  assert.equal(isCustomerTaxExempt(exemptions, { onDate: "2026-07-31" }), true);   // the last day counts
  assert.equal(isCustomerTaxExempt(exemptions, { onDate: "2026-08-01" }), false);  // lapsed
  assert.equal(isCustomerTaxExempt([{ active: true, expires_on: null }], { onDate: "2099-01-01" }), true);
  assert.equal(isCustomerTaxExempt([{ active: false, expires_on: null }], { onDate: "2026-07-31" }), false);
  assert.equal(isCustomerTaxExempt([], { onDate: "2026-07-31" }), false);
  assert.equal(isCustomerTaxExempt(null, { onDate: "2026-07-31" }), false);
});

test("percentages become basis points by integer maths, not by float rounding", () => {
  assert.equal(parsePercentToBps("8.25"), 825);
  assert.equal(parsePercentToBps("0.125"), 13);      // half-up on the 3rd decimal
  assert.equal(parsePercentToBps("8.365"), 837);     // Math.round(8.365*100) gives 836 — the float trap
  assert.equal(parsePercentToBps(0), 0);
  assert.throws(() => parsePercentToBps("abc"));
  assert.throws(() => parsePercentToBps("1001"));    // over 1000%
});
