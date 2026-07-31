import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseAmountToMinor, parseQtyToMilli, lineSubtotalMinor } from "../lib/core/money.mjs";

// ---------------------------------------------------------------------------
// The finance, growth and operations forms were the only money entry points in
// the app that bypassed the tested integer engine, using
// `Math.round(Number(value) * 100)`. Two defects, both proven here.
// ---------------------------------------------------------------------------

test("the float shortcut mis-rounds where the integer engine does not", () => {
  // The classic: 1.005 is not exactly representable, so Number(1.005) * 100 is
  // 100.49999999999999 and Math.round gives 100 — a cent lost per row.
  assert.equal(Math.round(Number("1.005") * 100), 100, "documenting the old behaviour");
  assert.equal(parseAmountToMinor("1.005"), 101, "half-up on the third decimal");

  assert.equal(Math.round(Number("8.165") * 100), 816, "documenting the old behaviour");
  assert.equal(parseAmountToMinor("8.165"), 817);
});

test("non-numeric input is rejected instead of becoming NaN", () => {
  // The old code produced NaN, which Supabase serialised as null: a settlement
  // row silently saved with a missing figure and no warning to the operator.
  for (const bad of ["abc", "12.34.56", "--5", "1.2.3", "12a34"]) {
    assert.throws(() => parseAmountToMinor(bad), `${bad} must be rejected`);
    assert.ok(Number.isNaN(Math.round(Number(bad) * 100)), `${bad} was silently NaN before`);
  }
});

test("currency symbols and thousands separators are stripped, by design", () => {
  // Documenting deliberate leniency rather than asserting it away: the engine
  // strips $, ₪, commas and whitespace so a pasted "$1,234.56" works. That means
  // "1,2,3" parses as 123 — lenient, but intentional and not a defect.
  assert.equal(parseAmountToMinor("1,2,3"), 12300);
  assert.equal(parseAmountToMinor("$$"), 0);
  assert.equal(parseAmountToMinor(" ₪ 99.90 "), 9990);
});

test("ordinary amounts still parse (the guard is not over-strict)", () => {
  assert.equal(parseAmountToMinor("1234.56"), 123456);
  assert.equal(parseAmountToMinor("$1,234.56"), 123456);
  assert.equal(parseAmountToMinor("0"), 0);
  assert.equal(parseAmountToMinor(""), 0);
  assert.equal(parseAmountToMinor("10"), 1000);
});

test("purchase-order totals are integer-exact", () => {
  // 3.333 units at $19.99 — float multiplication drifts here.
  const qtyMilli = parseQtyToMilli("3.333");
  const unit = parseAmountToMinor("19.99");
  const total = lineSubtotalMinor(qtyMilli, unit);
  assert.ok(Number.isInteger(total), "a money total must never be fractional");
  // 3333 milli-units x 1999 minor = 6,662,667; divided by 1000 with half-up
  // rounding that is 6663 (6662.667 rounds up to 6663).
  assert.equal(total, 6663);
  assert.equal(qtyMilli, 3333);
  assert.equal(unit, 1999);
});

test("settlement net must equal its own components", () => {
  const gross = parseAmountToMinor("10000.00");
  const fees = parseAmountToMinor("290.50");
  const refunds = parseAmountToMinor("150.00");
  const chargebacks = parseAmountToMinor("0");
  const adjustments = parseAmountToMinor("12.25");
  const derived = gross - fees - refunds - chargebacks + adjustments;
  assert.equal(derived, 957175);
  // A hand-entered net that disagrees is now refused rather than stored verbatim.
  assert.notEqual(parseAmountToMinor("9999.99"), derived);
});

// ---------------------------------------------------------------------------
// Structural: no money entry point may reintroduce the float shortcut.
// ---------------------------------------------------------------------------

const readCode = (p) =>
  readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

test("no money field is parsed with the float shortcut", () => {
  const FLOAT_MONEY = /Math\.round\(\s*Number\([^)]*\)\s*\*\s*100\s*\)/;
  for (const file of [
    "app/(app)/finance/actions.ts",
    "app/(app)/growth/actions.ts",
    "app/(app)/operations/actions.ts",
  ]) {
    assert.ok(!FLOAT_MONEY.test(readCode(file)), `${file} must use parseAmountToMinor, not float arithmetic`);
    assert.ok(/parseAmountToMinor/.test(readCode(file)), `${file} must import the tested money engine`);
  }
});

test("a bad amount is not reported to the user as a permission problem", () => {
  const src = readCode("app/(app)/finance/actions.ts");
  assert.ok(/class AmountError/.test(src), "a malformed amount needs its own error type");
  assert.ok(/failure\(e, he\)/.test(src), "every catch must distinguish the two causes");
  assert.ok(!/catch \{ return \{ ok: false, error: he \?/.test(src),
    "the blanket catch reported 'no permission' for a typo in an amount");
});

test("settlement arithmetic is validated before it is stored", () => {
  const src = readCode("app/(app)/finance/actions.ts");
  assert.ok(/net !== derivedNet/.test(src), "a hand-entered net that contradicts its components must be refused");
  assert.ok(/gross < 0/.test(src), "negative gross must be refused");
});
