import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  planDepositSchedule,
  allocateMilestones,
  milestoneStatusForPayments,
  CALCULATION_TYPES,
  MILESTONE_STATUSES,
} from "../lib/core/schedules.mjs";

// ---------------------------------------------------------------------------
// 5.5 — payment_schedules and payment_milestones have existed since migration
// 017 with composite tenant foreign keys, RLS policies, indexes, an updated_at
// trigger and a milestone_id column on payment_requests, and there are ZERO
// application references to any of it.
//
// This is the MINIMUM COHERENT SLICE, not the whole feature. See
// docs/REMEDIATION-PLAN.md 5.5 for what is deliberately still missing.
// ---------------------------------------------------------------------------

test("a deposit produces a two-step schedule", () => {
  const plan = planDepositSchedule({ totalMinor: 100000, depositMinor: 25000 });
  assert.ok(plan);
  assert.equal(plan.milestones.length, 2);
  assert.equal(plan.milestones[0].calculation_type, "fixed");
  assert.equal(plan.milestones[0].amount_minor, 25000);
  // The final step is 'remaining', not a second fixed amount: editing the
  // estimate total afterwards must not leave the schedule adding up wrong.
  assert.equal(plan.milestones[1].calculation_type, "remaining");
  assert.equal(plan.milestones[1].amount_minor, null);
});

test("no deposit means no schedule at all", () => {
  // A single "pay it all" milestone on every estimate in the business is noise.
  assert.equal(planDepositSchedule({ totalMinor: 100000, depositMinor: 0 }), null);
  assert.equal(planDepositSchedule({ totalMinor: 0, depositMinor: 5000 }), null);
});

test("a deposit covering the whole document has no balance step", () => {
  const plan = planDepositSchedule({ totalMinor: 50000, depositMinor: 50000 });
  assert.equal(plan.milestones.length, 1);
  // And an over-large deposit is clamped rather than producing a negative one.
  const clamped = planDepositSchedule({ totalMinor: 50000, depositMinor: 90000 });
  assert.equal(clamped.milestones.length, 1);
  assert.equal(clamped.milestones[0].amount_minor, 50000);
});

test("milestones add up to the document total, exactly", () => {
  const plan = planDepositSchedule({ totalMinor: 100000, depositMinor: 25000 });
  const { amounts, allocatedMinor, unallocatedMinor } = allocateMilestones(100000, plan.milestones);
  assert.deepEqual(amounts, [25000, 75000]);
  assert.equal(allocatedMinor, 100000);
  assert.equal(unallocatedMinor, 0);
});

test("percentage milestones round half-up and the remainder is placed, not lost", () => {
  const milestones = [
    { calculation_type: "percent", percent_bps: 3333 },
    { calculation_type: "remaining" },
  ];
  const { amounts, allocatedMinor } = allocateMilestones(1001, milestones);
  assert.equal(amounts[0], 334, "33.33% of 1001 = 333.63 -> 334");
  assert.equal(amounts[1], 667);
  assert.equal(allocatedMinor, 1001, "the parts must still sum to the whole");
});

test("several 'remaining' milestones split the remainder with the odd cents placed", () => {
  const milestones = [
    { calculation_type: "fixed", amount_minor: 1 },
    { calculation_type: "remaining" },
    { calculation_type: "remaining" },
  ];
  const { amounts, allocatedMinor } = allocateMilestones(10, milestones);
  assert.deepEqual(amounts, [1, 5, 4]);
  assert.equal(allocatedMinor, 10, "nine cents split two ways must not lose the odd one");
});

test("milestones that claim more than the document are clamped, and the overflow is reported", () => {
  const milestones = [
    { calculation_type: "fixed", amount_minor: 80000 },
    { calculation_type: "fixed", amount_minor: 50000 },
  ];
  const result = allocateMilestones(100000, milestones);
  assert.equal(result.allocatedMinor, 100000, "the customer is never billed more than the document");
  assert.equal(result.overAllocatedMinor, 30000, "and the discrepancy is reported, not swallowed");
  // The deposit the customer already agreed to is the last thing reduced.
  assert.deepEqual(result.amounts, [80000, 20000]);
});

test("a schedule that bills LESS than the document says so", () => {
  const result = allocateMilestones(100000, [{ calculation_type: "fixed", amount_minor: 25000 }]);
  assert.equal(result.allocatedMinor, 25000);
  assert.equal(result.unallocatedMinor, 75000, "a shortfall is a real condition, not something to hide");
});

test("a milestone with no milestones allocates nothing rather than throwing", () => {
  assert.deepEqual(allocateMilestones(100000, []), { amounts: [], allocatedMinor: 0, unallocatedMinor: 100000, overAllocatedMinor: 0 });
  assert.deepEqual(allocateMilestones(100000, null).amounts, []);
});

// ---------------------------------------------------------------------------
// 'processing' — the milestone status the tables always had and nothing used.
// ---------------------------------------------------------------------------

test("money sent but not cleared makes a milestone 'processing', not 'paid'", () => {
  assert.equal(milestoneStatusForPayments({ requiredMinor: 25000, settledMinor: 0, pendingMinor: 25000 }), "processing");
  assert.equal(milestoneStatusForPayments({ requiredMinor: 25000, settledMinor: 25000, pendingMinor: 0 }), "paid");
  assert.equal(milestoneStatusForPayments({ requiredMinor: 25000, settledMinor: 0, pendingMinor: 0 }), "due");
  assert.equal(milestoneStatusForPayments({ requiredMinor: 25000, settledMinor: 10000, pendingMinor: 5000 }), "due",
    "part-paid is still due — not 'nearly paid'");
  assert.equal(milestoneStatusForPayments({ requiredMinor: 0, settledMinor: 0, pendingMinor: 0 }), "waived");
  for (const status of ["processing", "paid", "due", "waived"]) {
    assert.ok(MILESTONE_STATUSES.includes(status), `${status} must be a status the column accepts`);
  }
  assert.deepEqual(CALCULATION_TYPES, ["percent", "fixed", "remaining"]);
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
  const stripped = read("lib/core/schedules.mjs");
  assert.ok(!/ZERO\s*application\s*references/i.test(stripped), "block comments must be removed");
  assert.ok(/export function planDepositSchedule/.test(stripped), "code must survive stripping");
});

test("the two dead tables are finally written and read", () => {
  const src = read("lib/payments/deposits.ts");
  assert.ok(/from\("payment_schedules"\)\.insert/.test(src), "a schedule must actually be created");
  assert.ok(/from\("payment_milestones"\)\.insert/.test(src), "with its milestones");
  assert.ok(/from\("payment_milestones"\)[\s\S]{0,200}\.update/.test(src), "and advanced as money arrives");
});

test("one schedule per document, enforced by the database", () => {
  const sql = readSql("db/031_payment_features.sql");
  assert.ok(/uq_payment_schedules_estimate/.test(sql));
  assert.ok(/uq_payment_schedules_invoice/.test(sql));
  const src = read("lib/payments/deposits.ts");
  assert.ok(/ensureEstimateSchedule/.test(src));
  // Idempotent: a repeat call must return the existing schedule, never a second.
  assert.ok(/raced/.test(src), "a lost race must adopt the winner's schedule, not fail");
});

test("the deposit is applied to the deposit milestone before the balance", () => {
  const src = read("lib/payments/deposits.ts");
  assert.ok(/remainingSettled/.test(src) && /remainingPending/.test(src),
    "applying money out of order would show a paid deposit as unpaid");
});
