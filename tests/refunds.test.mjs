import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateRefundAmount,
  remainingRefundable,
  collectedOnPayment,
  refundableMinor,
  REFUNDABLE_STATUSES,
} from "../lib/core/refunds.mjs";

// ---------------------------------------------------------------------------
// `payments.refunded_minor` was READ in fourteen places and WRITTEN by nothing.
// The can_refund_payments permission was assignable and granted nothing. So an
// overcharge could not be corrected in-product at all.
// ---------------------------------------------------------------------------

const settled = (collected, refunded = 0) => ({
  base_amount_minor: collected,
  refunded_minor: refunded,
  normalized_status: "settled",
});

test("a valid refund is permitted (the guard is not a cry-wolf)", () => {
  // Stated first on purpose: a refund guard that only ever refuses blocks
  // legitimate corrections just as damagingly as one that lets an over-refund
  // through, and it is the failure mode nobody notices until a customer is owed
  // money and the button does not work.
  const r = validateRefundAmount(settled(500_00), 200_00);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.amountMinor, 200_00);
});

test("a full refund of the whole payment is permitted", () => {
  assert.equal(validateRefundAmount(settled(500_00), 500_00).ok, true);
});

test("a refund cannot exceed what remains", () => {
  const r = validateRefundAmount(settled(500_00, 300_00), 300_00);
  assert.equal(r.ok, false);
  assert.match(r.error, /more than remains/);
  assert.match(r.error, /200\.00/, "the message must say how much is actually available");
  // But the exact remainder is fine.
  assert.equal(validateRefundAmount(settled(500_00, 300_00), 200_00).ok, true);
});

test("a fully refunded payment refuses further refunds", () => {
  const r = validateRefundAmount(settled(500_00, 500_00), 1);
  assert.equal(r.ok, false);
  assert.match(r.error, /already been fully refunded/);
});

test("zero, negative and fractional amounts are refused", () => {
  for (const bad of [0, -1, -500_00]) {
    assert.equal(validateRefundAmount(settled(500_00), bad).ok, false, `${bad} must be refused`);
  }
  assert.equal(validateRefundAmount(settled(500_00), 10.5).ok, false, "money is integer minor units");
});

test("malformed amounts are refused rather than becoming NaN", () => {
  for (const bad of ["abc", null, undefined, NaN, Infinity, {}]) {
    const r = validateRefundAmount(settled(500_00), bad);
    assert.equal(r.ok, false, `${String(bad)} must be refused`);
    assert.ok(r.error, "and must explain why");
  }
});

test("a surcharge is not refundable — only the base amount was the customer's", () => {
  // base_amount_minor excludes the Fee Saver surcharge, which went to the
  // processor. Refunding against the gross would return money the business
  // never held.
  const withSurcharge = { base_amount_minor: 500_00, amount_minor: 530_00, refunded_minor: 0, normalized_status: "settled" };
  assert.equal(collectedOnPayment(withSurcharge), 500_00);
  assert.equal(validateRefundAmount(withSurcharge, 530_00).ok, false);
  assert.equal(validateRefundAmount(withSurcharge, 500_00).ok, true);
});

test("legacy rows without base_amount_minor fall back to amount_minor", () => {
  const legacy = { amount_minor: 250_00, refunded_minor: 0, normalized_status: "settled" };
  assert.equal(collectedOnPayment(legacy), 250_00);
  assert.equal(validateRefundAmount(legacy, 250_00).ok, true);
});

test("remaining refundable never goes negative", () => {
  // A hand-edited over-refund in the data must not produce a negative that would
  // silently inflate another payment's total.
  assert.equal(remainingRefundable(settled(100_00, 900_00)), 0);
  assert.equal(remainingRefundable({}), 0);
  assert.equal(remainingRefundable(null), 0);
});

// ---------------------------------------------------------------------------
// Invoice coverage after a refund.
// ---------------------------------------------------------------------------

test("an invoice covered only by refunded money is no longer covered", () => {
  const payments = [settled(500_00, 500_00)];
  assert.equal(refundableMinor(payments), 0, "a fully refunded invoice retains nothing");
});

test("a partial refund leaves the remainder credited", () => {
  assert.equal(refundableMinor([settled(500_00, 150_00)]), 350_00);
});

test("unsettled payments contribute nothing to coverage", () => {
  const inFlight = { base_amount_minor: 500_00, refunded_minor: 0, normalized_status: "processing" };
  assert.equal(refundableMinor([inFlight]), 0);
  assert.deepEqual(REFUNDABLE_STATUSES, ["settled", "partially_refunded"]);
});

// ---------------------------------------------------------------------------
// Structural: the ledger and its guards must exist, and the honest limits of the
// provider half must stay documented.
// ---------------------------------------------------------------------------

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("refunds are an append-only ledger, not a mutable counter", () => {
  const sql = read("db/030_refunds.sql").toLowerCase();
  assert.ok(/create table if not exists public\.payment_refunds/.test(sql));
  assert.ok(/sync_payment_refunded_total/.test(sql),
    "payments.refunded_minor must be derived from the ledger so it cannot drift");
  assert.ok(/guard_refund_amount/.test(sql), "an over-refund must be refused by the database, not only the action");
  assert.ok(!/create policy payment_refunds_delete/.test(sql),
    "deleting a refund would rewrite financial history");
});

test("the money table finally has an audit trail", () => {
  const sql = read("db/030_refunds.sql");
  assert.ok(/trg_payments_audit/.test(sql),
    "payments was the one major table with no before/after record — refunds make that gap worse");
});

test("refunding requires the permission that until now did nothing", () => {
  const sql = read("db/030_refunds.sql");
  assert.ok(/can_refund_payments\(\)/.test(sql));
  const src = read("lib/payments/refunds.ts");
  assert.ok(/assertMayRefund/.test(src), "the action must check it too — RLS is the boundary, not the only gate");
});

test("a provider refund is recorded pending and only completed on confirmation", () => {
  const src = read("lib/payments/refunds.ts");
  const pendingAt = src.indexOf('status: isProvider ? "pending"');
  const callAt = src.indexOf("sendProviderRefund(payment");
  assert.ok(pendingAt > -1 && callAt > -1);
  assert.ok(pendingAt < callAt,
    "the row must exist BEFORE the provider call — the opposite order can credit a refund that never happened");
  assert.ok(/status: "failed"/.test(src), "a refused provider refund must be recorded as failed, not silently dropped");
});

test("the untested provider path says so, in the code", () => {
  // This is the part that cannot be proven here: there are no Helcim sandbox
  // credentials in this environment. The limitation must stay written down where
  // the next person will see it, not only in a commit message.
  const src = read("lib/payments/refunds.ts");
  assert.ok(/NEVER BEEN EXERCISED|never been exercised/i.test(src),
    "the unproven provider call must be labelled as unproven");
});
