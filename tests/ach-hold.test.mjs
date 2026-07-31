import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isAchPayment,
  isInFlight,
  settledMinor,
  pendingAchMinor,
  achHoldState,
  depositReleaseDecision,
} from "../lib/core/ach-hold.mjs";

// ---------------------------------------------------------------------------
// 5.4 — payment_settings.ach_hold_until_settled defaulted to true, was rendered
// as a switch labelled "The job remains on hold until the bank confirms
// settlement", the customer payment screen made the same promise in two
// languages, and NOTHING READ IT. The can_override_ach_holds permission was
// assignable on the team screen and granted nothing.
// ---------------------------------------------------------------------------

const ach = (minor, status) => ({ base_amount_minor: minor, refunded_minor: 0, normalized_status: status, method: "ACH" });
const card = (minor, status) => ({ base_amount_minor: minor, refunded_minor: 0, normalized_status: status, method: "Credit card" });

test("an in-flight ACH transfer is recognised", () => {
  assert.equal(isAchPayment(ach(100_00, "processing")), true);
  assert.equal(isAchPayment(card(100_00, "processing")), false);
  assert.equal(isAchPayment({ method: "ach" }), true, "matched case-insensitively for hand-recorded rows");
  assert.equal(isAchPayment({}), false);
  assert.equal(isInFlight(ach(100_00, "processing")), true);
  assert.equal(isInFlight(ach(100_00, "settled")), false);
});

test("the hold holds when it is on, and does not when it is off", () => {
  const payments = [ach(250_00, "processing")];
  assert.deepEqual(achHoldState({ holdEnabled: true, payments }), { held: true, pendingMinor: 250_00, count: 1 });
  // The whole point of the switch: a business may accept the return risk.
  assert.equal(achHoldState({ holdEnabled: false, payments }).held, false);
});

test("nothing is held when nothing is in flight", () => {
  assert.equal(achHoldState({ holdEnabled: true, payments: [ach(250_00, "settled")] }).held, false);
  assert.equal(achHoldState({ holdEnabled: true, payments: [card(250_00, "processing")] }).held, false,
    "a card authorisation is not an ACH transfer");
  assert.equal(achHoldState({ holdEnabled: true, payments: [] }).held, false);
});

test("settled money and in-flight money are counted separately", () => {
  const payments = [ach(100_00, "settled"), ach(150_00, "processing"), card(50_00, "failed")];
  assert.equal(settledMinor(payments), 100_00);
  assert.equal(pendingAchMinor(payments), 150_00);
  // A failed card contributes to neither.
});

test("refunded money is not money still held", () => {
  const refunded = { base_amount_minor: 200_00, refunded_minor: 200_00, normalized_status: "partially_refunded", method: "ACH" };
  assert.equal(settledMinor([refunded]), 0);
});

// ---------------------------------------------------------------------------
// The release decision. Both directions, on every branch.
// ---------------------------------------------------------------------------

test("a settled deposit releases the work", () => {
  const result = depositReleaseDecision({ holdEnabled: true, requiredMinor: 250_00, payments: [ach(250_00, "settled")] });
  assert.equal(result.released, true);
  assert.equal(result.reason, "settled");
});

test("an in-flight ACH deposit does NOT release the work while the hold is on", () => {
  const result = depositReleaseDecision({ holdEnabled: true, requiredMinor: 250_00, payments: [ach(250_00, "processing")] });
  assert.equal(result.released, false);
  assert.equal(result.reason, "awaiting_settlement");
  assert.equal(result.pendingMinor, 250_00);
});

test("the same deposit releases immediately when the hold is switched off", () => {
  const result = depositReleaseDecision({ holdEnabled: false, requiredMinor: 250_00, payments: [ach(250_00, "processing")] });
  assert.equal(result.released, true);
  assert.equal(result.reason, "hold_disabled");
});

test("an authorised override releases in-flight money, on the record", () => {
  const result = depositReleaseDecision({ holdEnabled: true, requiredMinor: 250_00, payments: [ach(250_00, "processing")], overridden: true });
  assert.equal(result.released, true);
  assert.equal(result.reason, "overridden");
});

test("an override cannot release work nobody has paid for", () => {
  // There is nothing to override when no money was ever sent.
  const result = depositReleaseDecision({ holdEnabled: true, requiredMinor: 250_00, payments: [], overridden: true });
  assert.equal(result.released, false);
  assert.equal(result.reason, "deposit_unpaid");
});

test("a part-paid deposit does not release", () => {
  const result = depositReleaseDecision({ holdEnabled: false, requiredMinor: 250_00, payments: [ach(100_00, "processing")] });
  assert.equal(result.released, false);
  assert.equal(result.reason, "deposit_unpaid");
});

test("work with no deposit required is never held", () => {
  const result = depositReleaseDecision({ holdEnabled: true, requiredMinor: 0, payments: [] });
  assert.equal(result.released, true);
  assert.equal(result.reason, "no_deposit_required");
});

test("a card payment settles the deposit without ever involving the hold", () => {
  const result = depositReleaseDecision({ holdEnabled: true, requiredMinor: 250_00, payments: [card(250_00, "settled")] });
  assert.equal(result.released, true);
});

// ---------------------------------------------------------------------------
// Structural. Comments stripped first.
// ---------------------------------------------------------------------------

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");
const readSql = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/--[^\n]*/g, " ");

test("the comment stripping these guards rely on actually works", () => {
  const stripped = read("lib/payments/deposits.ts");
  assert.ok(!/granted nothing/i.test(stripped), "block comments must be removed");
  assert.ok(/export async function achHoldEnabled/.test(stripped), "code must survive stripping");
});

test("the setting is actually read, and the permission actually gates something", () => {
  const src = read("lib/payments/deposits.ts");
  assert.ok(/ach_hold_until_settled/.test(src), "the toggle must be read by something");
  assert.ok(/depositReleaseDecision\(/.test(src));
  assert.ok(/can_override_ach_holds/.test(src), "the permission must gate the override");

  const actions = read("app/(app)/settings/payments/actions.ts");
  assert.ok(/export async function releaseAchHold/.test(actions), "there must be a way to release a hold");
  assert.ok(/mayOverrideAchHold\(/.test(actions), "and it must be permission-checked server-side");
  assert.ok(/action: "ach_hold_released"/.test(actions), "an early release is a financial decision with an author");
  assert.ok(/milestone\.status !== "processing"/.test(actions),
    "only money already sent may be released early");
});

test("a held deposit is visible to the person who can release it", () => {
  const page = read("app/(app)/settings/payments/page.tsx");
  assert.ok(/heldDeposits\(/.test(page));
  assert.ok(/releaseAchHold/.test(page), "a hold nobody can see is a hold nobody can clear");
});

test("the hold is released by the job that learns a transfer cleared", () => {
  const server = read("lib/payments/server.ts");
  // reconcileHelcimTransaction is what the daily cron and the provider webhook
  // call. If the release is not wired there, a cleared ACH holds forever.
  const reconcileAt = server.indexOf("export async function reconcileHelcimTransaction");
  const releaseAt = server.indexOf("applyPaymentToDeposits", reconcileAt);
  assert.ok(reconcileAt > -1 && releaseAt > reconcileAt,
    "reconciliation must release deposit-gated work");
  assert.ok(/estimate_id/.test(server.slice(reconcileAt, reconcileAt + 900)),
    "and must read the estimate the deposit belongs to");
});

test("releasing a hold is recorded on the milestone, not just in memory", () => {
  const sql = readSql("db/031_payment_features.sql");
  assert.ok(/add column if not exists released_by/.test(sql));
  assert.ok(/add column if not exists released_at/.test(sql));
  assert.ok(/add column if not exists release_reason/.test(sql));
});
