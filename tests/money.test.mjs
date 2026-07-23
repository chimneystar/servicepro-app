import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAmountToMinor, parseQtyToMilli, lineSubtotalMinor,
  computeDocument, formatMoney,
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
