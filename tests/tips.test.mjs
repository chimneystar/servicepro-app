import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveTip,
  tipMinorFromPercent,
  sanitizeTipPercents,
  chargeTotalMinor,
  paymentTipParts,
  MAX_TIP_PERCENT,
} from "../lib/core/tips.mjs";
import { creditedMinor, openBalanceMinor } from "../lib/payments/core.mjs";
import { collectedMinor } from "../lib/core/reporting.mjs";
import { validateRefundAmount } from "../lib/core/refunds.mjs";

// ---------------------------------------------------------------------------
// 5.2 — `payment_settings.tips_enabled` and `suggested_tip_percents` were
// stored and editable; `payments.tip_minor` was READ when a receipt rendered
// and written by NOTHING. No customer was ever offered a tip.
// ---------------------------------------------------------------------------

test("a tip is offered and accepted when the business enables tipping", () => {
  // Stated first: a tip control that refuses every tip is exactly as broken as
  // one that charges the wrong amount, and far less likely to be noticed.
  const result = resolveTip({ enabled: true, balanceMinor: 500_00, percent: 20 });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.tipMinor, 100_00);
});

test("a tip is refused when the business has not enabled tipping", () => {
  const result = resolveTip({ enabled: false, balanceMinor: 500_00, percent: 20 });
  assert.equal(result.ok, false);
  assert.match(result.error, /not accepting tips/);
  // But asking for no tip is always fine, enabled or not.
  assert.deepEqual(resolveTip({ enabled: false, balanceMinor: 500_00 }), { ok: true, tipMinor: 0 });
});

test("percentages round half-up with integer arithmetic, never floats", () => {
  // 15% of $33.43 is 5.0145 -> 501 cents. The float route (33.43 * 0.15 * 100)
  // gives 501.44999999999993, which Math.floor would turn into 501 by luck and
  // a different rounding into 502.
  assert.equal(tipMinorFromPercent(33_43, 15), 501);
  assert.equal(tipMinorFromPercent(1_00, 25), 25);
  // Exactly half a cent rounds up, deterministically.
  assert.equal(tipMinorFromPercent(3, 50), 2);
  assert.equal(tipMinorFromPercent(0, 20), 0);
});

test("a typed tip larger than the bill is refused", () => {
  // Far more likely a mis-typed amount than generosity, and the customer cannot
  // undo a captured card charge themselves.
  const tooBig = resolveTip({ enabled: true, balanceMinor: 50_00, customMinor: 500_00 });
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.error, /larger than the amount due/);
  // The whole balance as a tip is allowed — that is a 100% tip, not an error.
  assert.equal(resolveTip({ enabled: true, balanceMinor: 50_00, customMinor: 50_00 }).ok, true);
});

test("malformed tips are refused rather than becoming NaN on the card", () => {
  for (const bad of [NaN, Infinity, "abc", 10.5, -1]) {
    const result = resolveTip({ enabled: true, balanceMinor: 500_00, customMinor: bad });
    assert.equal(result.ok, false, `${String(bad)} must be refused`);
    assert.ok(result.error);
  }
  for (const bad of [101, -5, 12.5, "many"]) {
    assert.equal(
      resolveTip({ enabled: true, balanceMinor: 500_00, percent: bad }).ok,
      false,
      `${String(bad)}% must be refused`,
    );
  }
  assert.equal(MAX_TIP_PERCENT, 100);
});

test("there is nothing to tip on when nothing is owed", () => {
  assert.equal(resolveTip({ enabled: true, balanceMinor: 0, percent: 20 }).ok, false);
});

test("suggested percentages are cleaned before a customer sees them", () => {
  // The column is integer[] with no constraint, so a hand-edited row of junk
  // must not render as a row of broken buttons.
  assert.deepEqual(sanitizeTipPercents([25, 15, 20]), [15, 20, 25]);
  assert.deepEqual(
    sanitizeTipPercents([0, -5, 101, 20, 20]),
    [20],
    "zero, negative, over-100 and duplicates go",
  );
  assert.deepEqual(
    sanitizeTipPercents("15, 18, 20, 22, 25"),
    [15, 18, 20, 22],
    "at most four choices",
  );
  assert.deepEqual(
    sanitizeTipPercents([]),
    [15, 20, 25],
    "an empty list falls back rather than showing nothing",
  );
  assert.deepEqual(sanitizeTipPercents(null), [15, 20, 25]);
});

// ---------------------------------------------------------------------------
// The load-bearing property: a tip is not the business's money.
// ---------------------------------------------------------------------------

test("the charge is balance PLUS tip — a tip never settles the bill", () => {
  assert.equal(chargeTotalMinor(500_00, 100_00), 600_00);
  const parts = paymentTipParts(600_00, 100_00);
  assert.deepEqual(parts, { baseMinor: 500_00, tipMinor: 100_00 });
});

test("a tipped payment leaves the invoice exactly paid, not overpaid", () => {
  // base_amount_minor is what settles the document. If the tip were folded into
  // it, a $500 invoice paid with a $100 tip would read as $100 overpaid and the
  // next invoice would be silently credited.
  const { baseMinor, tipMinor } = paymentTipParts(600_00, 100_00);
  const payment = {
    base_amount_minor: baseMinor,
    tip_minor: tipMinor,
    refunded_minor: 0,
    normalized_status: "settled",
  };
  assert.equal(creditedMinor([payment]), 500_00);
  assert.equal(openBalanceMinor(500_00, [payment]), 0);
});

test("a tip is not revenue and not commissionable", () => {
  const { baseMinor, tipMinor } = paymentTipParts(600_00, 100_00);
  const payment = {
    base_amount_minor: baseMinor,
    tip_minor: tipMinor,
    refunded_minor: 0,
    normalized_status: "settled",
  };
  // collectedMinor drives revenue, margin and the commission report. Tipped
  // money belongs to the person who earned it; counting it as business revenue
  // would inflate margin and misstate the tax position.
  assert.equal(collectedMinor([payment]), 500_00);
});

test("a tip is not refundable as the business's money", () => {
  const { baseMinor, tipMinor } = paymentTipParts(600_00, 100_00);
  const payment = {
    base_amount_minor: baseMinor,
    tip_minor: tipMinor,
    refunded_minor: 0,
    normalized_status: "settled",
  };
  assert.equal(
    validateRefundAmount(payment, 600_00).ok,
    false,
    "the gross including the tip is not refundable",
  );
  assert.equal(
    validateRefundAmount(payment, 500_00).ok,
    true,
    "everything the business actually took is",
  );
});

test("splitting a charge cannot produce a tip bigger than the charge", () => {
  assert.throws(() => paymentTipParts(500_00, 600_00));
  assert.throws(() => chargeTotalMinor(500_00, -1));
  assert.throws(() => chargeTotalMinor(-1, 0));
});

// ---------------------------------------------------------------------------
// Structural: the tip has to survive the whole round trip, or none of the above
// matters. Comments are stripped first so the prose describing the defect
// cannot satisfy a check.
// ---------------------------------------------------------------------------

const read = (p) =>
  readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const readSql = (p) =>
  readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");

test("the comment stripping these guards rely on actually works", () => {
  const stripped = read("lib/core/tips.mjs");
  assert.ok(!/WRITTEN BY\s*NOTHING/i.test(stripped), "block comments must be removed");
  assert.ok(/export function resolveTip/.test(stripped), "code must survive stripping");
  const sql = readSql("db/031_payment_features.sql");
  assert.ok(!/READ WHEN A RECEIPT/i.test(sql), "SQL comments must be removed");
  assert.ok(
    /create or replace function public\.public_tip_options/.test(sql),
    "SQL must survive stripping",
  );
});

test("the tip is carried on the checkout session, not recomputed from a client total", () => {
  const sql = readSql("db/031_payment_features.sql");
  assert.ok(/alter table public\.payment_requests add column if not exists tip_minor/.test(sql));
  assert.ok(
    /tip_minor >= 0 and tip_minor <= amount_minor/.test(sql),
    "the database must refuse a tip larger than the charge it belongs to",
  );

  const server = read("lib/payments/server.ts");
  assert.ok(/resolveTip\(/.test(server), "the server must resolve the tip from the real balance");
  assert.ok(/tip_minor: tipMinor/.test(server), "the tip must be stored on the request");
  assert.ok(/paymentTipParts\(/.test(server), "and split back out when the payment is recorded");
  assert.ok(
    /base_amount_minor: baseMinor/.test(server),
    "base_amount_minor must be the BALANCE, not the gross — every revenue reader sums it",
  );
});

test("the customer sends a tip CHOICE, never a total", () => {
  const component = read("components/CustomerPaymentOptions.tsx");
  assert.ok(/tipPercent:/.test(component) && /tipAmount:/.test(component));
  assert.ok(
    !/chargedMinor,\s*$/m.test(component.split("body: JSON.stringify")[1] ?? ""),
    "the computed total must not be what the server trusts",
  );
  const route = read("app/api/pay/helcim/initialize/route.ts");
  assert.ok(
    /parseAmountToMinor\(/.test(route),
    "a typed tip must be parsed to integer minor units, never Math.round(Number(x) * 100)",
  );
  assert.ok(!/Math\.round\(Number\([^)]*\)\s*\*\s*100\)/.test(route));
});

test("the receipt says what part of the charge was the tip", () => {
  const receipts = read("lib/payments/receipts.ts");
  assert.ok(/tip_minor/.test(receipts));
  assert.ok(
    /Includes a/.test(receipts) && /כולל טיפ/.test(receipts),
    "a total larger than the invoice with no explanation reads as an overcharge",
  );
});
