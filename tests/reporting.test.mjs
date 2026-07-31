import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  collectedMinor,
  materialsCostMinor,
  invoiceRevenueExTaxMinor,
  periodTotals,
  commissionMinor,
  COLLECTED_STATUSES,
} from "../lib/core/reporting.mjs";

const settled = (minor, refunded = 0) => ({ base_amount_minor: minor, refunded_minor: refunded, normalized_status: "settled" });

// ---------------------------------------------------------------------------
// "Revenue collected" must mean money RECEIVED, not money BILLED.
// ---------------------------------------------------------------------------

test("collected counts settled money only", () => {
  const rows = [
    settled(500_00),
    { base_amount_minor: 900_00, normalized_status: "processing" },   // ACH in flight
    { base_amount_minor: 300_00, normalized_status: "failed" },       // declined card
  ];
  assert.equal(collectedMinor(rows), 500_00, "in-flight and declined money is not revenue");
});

test("collected subtracts refunds", () => {
  assert.equal(collectedMinor([settled(500_00, 120_00)]), 380_00);
  assert.equal(collectedMinor([settled(100_00, 250_00)]), 0, "an over-refund must not go negative");
});

test("collected is not a cry-wolf filter", () => {
  // The other direction: if the filter rejected everything, revenue would read
  // zero and the report would be just as wrong.
  assert.equal(collectedMinor([settled(250_00)]), 250_00);
  assert.equal(collectedMinor([{ base_amount_minor: 250_00, normalized_status: "partially_refunded" }]), 250_00);
  assert.deepEqual(COLLECTED_STATUSES, ["settled", "partially_refunded"]);
});

test("a hand-marked-paid invoice with no payment contributes no revenue", () => {
  // This is the core of the old bug: status='paid' was treated as cash.
  assert.equal(collectedMinor([]), 0);
});

// ---------------------------------------------------------------------------
// Margin: both sides must share a basis. Revenue excluded tax; the old code
// compared item-level revenue (no discount, no tax) against a total that had both.
// ---------------------------------------------------------------------------

const items = [
  { qty_milli: 2000, unit_price_minor: 100_00, cost_minor: 40_00, taxable: true }, // 2 x $100, cost $40
  { qty_milli: 1000, unit_price_minor: 50_00, cost_minor: 20_00, taxable: true },  // 1 x $50,  cost $20
];

test("revenue excludes tax, because tax is not income", () => {
  const invoice = { discount_minor: 0, tax_rate_bps: 1000 }; // 10%
  // subtotal 250.00, tax 25.00, total 275.00 -> revenue ex-tax 250.00
  assert.equal(invoiceRevenueExTaxMinor(invoice, items), 250_00);
});

test("a discount reduces revenue AND the margin, on both sides", () => {
  const invoice = { discount_minor: 50_00, tax_rate_bps: 1000 };
  // subtotal 250.00 - 50.00 discount = 200.00; tax on 200.00 = 20.00
  assert.equal(invoiceRevenueExTaxMinor(invoice, items), 200_00);

  const totals = periodTotals({
    payments: [settled(220_00)],
    invoices: [{ id: "i1", ...invoice }],
    itemsByInvoice: { i1: items },
  });
  assert.equal(totals.materialsCostMinor, 100_00);     // 2x40 + 1x20
  assert.equal(totals.grossProfitMinor, 100_00);       // 200.00 revenue - 100.00 cost

  // THE OLD BUG, reproduced: item revenue ignoring the discount would be
  // 250.00, giving a 150.00 "profit" — 50% overstated on this invoice.
  const overstated = 250_00 - 100_00;
  assert.equal(overstated, 150_00);
  assert.ok(totals.grossProfitMinor < overstated, "the fix must report less profit than the old maths");
});

test("period totals net expenses off gross profit", () => {
  const totals = periodTotals({
    payments: [settled(275_00)],
    invoices: [{ id: "i1", discount_minor: 0, tax_rate_bps: 1000 }],
    itemsByInvoice: { i1: items },
    expensesMinor: 60_00,
  });
  assert.equal(totals.collectedMinor, 275_00);
  assert.equal(totals.revenueExTaxMinor, 250_00);
  assert.equal(totals.grossProfitMinor, 150_00);
  assert.equal(totals.netProfitMinor, 90_00);
});

test("materials cost is integer-exact", () => {
  const cost = materialsCostMinor([{ qty_milli: 3333, cost_minor: 19_99 }]);
  assert.ok(Number.isInteger(cost));
  assert.equal(cost, 6663);
});

test("missing and malformed fields degrade to zero, never NaN", () => {
  assert.equal(collectedMinor(null), 0);
  assert.equal(materialsCostMinor(null), 0);
  assert.equal(collectedMinor([{ base_amount_minor: "oops", normalized_status: "settled" }]), 0);
  const totals = periodTotals({ payments: null, invoices: null, itemsByInvoice: null });
  for (const value of Object.values(totals)) assert.ok(Number.isFinite(value));
});

// ---------------------------------------------------------------------------
// Commission must be paid on collected money, not quoted work.
// ---------------------------------------------------------------------------

test("commission is a percentage of money actually collected", () => {
  assert.equal(commissionMinor(1000_00, 10), 100_00);
  assert.equal(commissionMinor(0, 10), 0, "nothing collected means nothing owed");
});

test("commission rounds half-up in integer minor units", () => {
  assert.equal(commissionMinor(333, 15), 50);   // 49.95 -> 50
  assert.equal(commissionMinor(1, 50), 1);      // 0.5 -> 1
  assert.ok(Number.isInteger(commissionMinor(12345, 7)));
});

test("commission percentage is clamped and malformed input is safe", () => {
  assert.equal(commissionMinor(1000_00, 500), 1000_00, "over 100% is clamped");
  assert.equal(commissionMinor(1000_00, -5), 0);
  assert.equal(commissionMinor(1000_00, "abc"), 0);
  assert.equal(commissionMinor(-500, 10), 0, "a negative base cannot create a payout");
});

// ---------------------------------------------------------------------------
// Structural: the report screens must use this module, not inline arithmetic.
// ---------------------------------------------------------------------------

const readCode = (p) =>
  readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

test("report screens derive revenue from payments, not invoice totals", () => {
  for (const file of ["app/(app)/reports/page.tsx", "app/(app)/reports/commission/page.tsx"]) {
    const src = readCode(file);
    assert.ok(/from "@\/lib\/core\/reporting\.mjs"/.test(src), `${file} must use the shared, tested reporting module`);
    assert.ok(!/invs\.reduce\(\(s, i\) => s \+ i\.total_minor, 0\)/.test(src),
      `${file} must not equate billed totals with collected revenue`);
  }
});

test("commission no longer pays on quoted price", () => {
  const src = readCode("app/(app)/reports/commission/page.tsx");
  assert.ok(!/revenue \+= j\.price_minor/.test(src),
    "paying commission on jobs.price_minor pays for work that was never collected");
});

// ---------------------------------------------------------------------------
// A HOLE IN THIS FILE, found by a parallel agent's digest test rather than by
// this one.
//
// Every periodTotals case above passed ONLY settled payments, so replacing
// `collectedMinor(payments)` with a naive sum — dropping both the status filter
// and the refund netting — produced identical numbers and this suite stayed
// green. The unit tests for collectedMinor were thorough; what was never tested
// was that periodTotals actually USES it.
//
// Testing a helper in isolation proves the helper. It does not prove the caller
// still calls it. That is the same shape as the scheduling rules that were
// correct, tested, and invoked by nothing.
// ---------------------------------------------------------------------------

test("periodTotals nets refunds and excludes unsettled money, not just collectedMinor", () => {
  const mixed = [
    settled(500_00),                                                            // real money
    { base_amount_minor: 900_00, refunded_minor: 0, normalized_status: "processing" }, // ACH in flight
    { base_amount_minor: 300_00, refunded_minor: 0, normalized_status: "failed" },     // declined card
    settled(200_00, 150_00),                                                    // refunded down to 50.00
  ];
  const totals = periodTotals({ payments: mixed, invoices: [], itemsByInvoice: {} });

  assert.equal(totals.collectedMinor, 550_00, "500.00 settled + 50.00 left after the refund");

  // The mutation this exists to catch: a naive sum over the same rows.
  const naive = mixed.reduce((s, p) => s + p.base_amount_minor, 0);
  assert.equal(naive, 1900_00);
  assert.notEqual(totals.collectedMinor, naive,
    "if these are ever equal, periodTotals has stopped filtering and netting");
});

test("periodTotals reports zero when nothing settled, however many payments exist", () => {
  const none = [
    { base_amount_minor: 400_00, refunded_minor: 0, normalized_status: "processing" },
    { base_amount_minor: 600_00, refunded_minor: 0, normalized_status: "failed" },
  ];
  const totals = periodTotals({ payments: none, invoices: [], itemsByInvoice: {} });
  assert.equal(totals.collectedMinor, 0, "a busy but unsettled period collected nothing");
});
