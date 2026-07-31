import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripSqlComments } from "./helpers/sql.mjs";
import {
  entryMinutes, minutesByTechnician, resolvePayRate, labourCostForMinutes,
  jobLabour, jobProfit, labourInvoiceLine,
} from "../lib/core/job-costing.mjs";

// ---------------------------------------------------------------------------
// 6c.2 — clock in/out was collected since migration 009 and reached NO profit
// figure. /reports costs a job from invoice line items only, so every margin
// the owner has ever seen treated the technician's time as free.
// ---------------------------------------------------------------------------

const rates = [
  { profile_id: "tech-a", cost_rate_minor: 4000, effective_from: "2026-01-01" },
  { profile_id: "tech-a", cost_rate_minor: 5000, effective_from: "2026-06-01" },
  { profile_id: "tech-b", cost_rate_minor: 3000, effective_from: "2026-01-01" },
];

test("a closed time entry becomes whole minutes", () => {
  assert.equal(entryMinutes({ started_at: "2026-07-01T09:00:00Z", ended_at: "2026-07-01T11:30:00Z" }), 150);
  assert.equal(entryMinutes({ started_at: "2026-07-01T09:00:00Z", ended_at: "2026-07-01T09:00:59Z" }), 0);
});

test("an OPEN entry contributes nothing, and is counted separately", () => {
  // Proven both ways: an open timer must not silently inflate the cost, and it
  // must not be invisible either — the screen has to say the figure is partial.
  const { byTech, openEntries } = minutesByTechnician([
    { user_id: "tech-a", started_at: "2026-07-01T09:00:00Z", ended_at: "2026-07-01T10:00:00Z" },
    { user_id: "tech-a", started_at: "2026-07-01T13:00:00Z", ended_at: null },
  ]);
  assert.equal(byTech.get("tech-a"), 60);
  assert.equal(openEntries, 1);
});

test("an end before the start is discarded rather than going negative", () => {
  assert.equal(entryMinutes({ started_at: "2026-07-01T11:00:00Z", ended_at: "2026-07-01T09:00:00Z" }), 0);
});

test("pay rates are effective-dated: a June rise does not re-cost a March job", () => {
  assert.equal(resolvePayRate(rates, "tech-a", "2026-03-15"), 4000);
  assert.equal(resolvePayRate(rates, "tech-a", "2026-06-01"), 5000);
  assert.equal(resolvePayRate(rates, "tech-a", "2026-09-30"), 5000);
});

test("a rate that has not started yet is NOT applied", () => {
  assert.equal(resolvePayRate([{ profile_id: "x", cost_rate_minor: 9000, effective_from: "2027-01-01" }], "x", "2026-07-01"), null);
});

test("no rate is NULL, never zero — zero would report the labour as free", () => {
  // This distinction is the whole point: 0 is a priced answer, null is "we do
  // not know", and only one of those may be reported as a margin.
  assert.equal(resolvePayRate(rates, "tech-c", "2026-07-01"), null);
  assert.notEqual(resolvePayRate(rates, "tech-c", "2026-07-01"), 0);
});

test("cost for minutes is integer half-up, never float", () => {
  assert.equal(labourCostForMinutes(60, 4000), 4000);
  assert.equal(labourCostForMinutes(90, 4000), 6000);
  assert.equal(labourCostForMinutes(1, 4000), 67);        // 66.66 -> 67
  assert.equal(labourCostForMinutes(30, 3333), 1667);     // 1666.5 -> 1667, half-UP
  assert.equal(labourCostForMinutes(7, 555), 65);         // 64.75 -> 65
});

test("a whole job's labour: minutes, cost, and who could not be priced", () => {
  const result = jobLabour({
    entries: [
      { user_id: "tech-a", started_at: "2026-07-01T08:00:00Z", ended_at: "2026-07-01T11:00:00Z" }, // 180
      { user_id: "tech-b", started_at: "2026-07-01T08:00:00Z", ended_at: "2026-07-01T09:30:00Z" }, // 90
      { user_id: "tech-z", started_at: "2026-07-01T08:00:00Z", ended_at: "2026-07-01T09:00:00Z" }, // 60, no rate
    ],
    rates, onDate: "2026-07-01",
  });
  assert.equal(result.minutes, 330);
  assert.equal(result.costMinor, 3 * 5000 + Math.round(1.5 * 3000));
  assert.deepEqual(result.unpriced, [{ profileId: "tech-z", minutes: 60 }]);
  assert.equal(result.incomplete, true);
});

test("a fully-priced, fully-closed job reports itself COMPLETE", () => {
  const result = jobLabour({
    entries: [{ user_id: "tech-b", started_at: "2026-07-01T08:00:00Z", ended_at: "2026-07-01T10:00:00Z" }],
    rates, onDate: "2026-07-01",
  });
  assert.equal(result.costMinor, 6000);
  assert.equal(result.incomplete, false);
});

test("job profit subtracts LABOUR as well as materials — the defect being fixed", () => {
  const withLabour = jobProfit({ revenueMinor: 50000, materialsCostMinor: 8000, labourCostMinor: 12000, expensesMinor: 1000 });
  assert.equal(withLabour.totalCostMinor, 21000);
  assert.equal(withLabour.profitMinor, 29000);
  // The old behaviour, reproduced, so the difference is on the record.
  const labourIgnored = jobProfit({ revenueMinor: 50000, materialsCostMinor: 8000, labourCostMinor: 0, expensesMinor: 1000 });
  assert.equal(labourIgnored.profitMinor, 41000);
  assert.ok(labourIgnored.profitMinor > withLabour.profitMinor);
});

test("margin is null with no revenue, not 0% and not Infinity", () => {
  assert.equal(jobProfit({ revenueMinor: 0, materialsCostMinor: 100, labourCostMinor: 100, expensesMinor: 0 }).marginBps, null);
  assert.equal(jobProfit({ revenueMinor: 10000, materialsCostMinor: 0, labourCostMinor: 2500, expensesMinor: 0 }).marginBps, 7500);
});

test("the labour invoice line is priced at ZERO and carries the cost", () => {
  const line = labourInvoiceLine({ minutes: 150, costMinor: 12345 });
  assert.equal(line.unit_price_minor, 0);   // the customer is not charged twice
  assert.equal(line.qty_milli, 1000);       // qty 1 -> line cost == cost_minor exactly
  assert.equal(line.cost_minor, 12345);
  assert.equal(line.taxable, false);
  assert.match(line.description, /2\.50/);
});

test("no labour cost produces NO line at all", () => {
  assert.equal(labourInvoiceLine({ minutes: 0, costMinor: 0 }), null);
});

// ---------------------------------------------------------------------------
// Structural: the wiring, with comments stripped so a comment cannot satisfy a
// check. Each of these was RED before this change — the strings did not exist.
// ---------------------------------------------------------------------------
const migration = stripSqlComments(readFileSync(new URL("../db/039_scheduling_sales.sql", import.meta.url), "utf8"));
const jobActions = stripSqlComments(readFileSync(new URL("../app/(app)/jobs/[id]/actions.ts", import.meta.url), "utf8"));
const teamActions = stripSqlComments(readFileSync(new URL("../app/(app)/team/actions.ts", import.meta.url), "utf8"));

test("the wage lives in its own table, NOT on profiles", () => {
  assert.match(migration, /create table if not exists public\.technician_pay_rates/);
  // profiles is readable by every member of the org, so a rate column there
  // would hand the payroll to every technician through PostgREST.
  assert.doesNotMatch(migration, /alter table public\.profiles add column if not exists\s+cost_rate/);
});

test("the pay-rate table is OWNER ONLY and closed to anon", () => {
  const policy = /create policy technician_pay_rates_owner[\s\S]*?with check[\s\S]*?;/.exec(migration);
  assert.ok(policy, "technician_pay_rates_owner policy must exist");
  assert.match(policy[0], /current_user_role\(\)\s*=\s*'owner'/);
  assert.doesNotMatch(policy[0], /'office'/);
  assert.match(migration, /revoke all on public\.technician_pay_rates from anon/);
});

test("job_labour_cost refuses a technician and never returns a rate", () => {
  const fn = /create or replace function public\.job_labour_cost[\s\S]*?\$\$;/.exec(migration);
  assert.ok(fn, "job_labour_cost must exist");
  assert.match(fn[0], /current_user_role\(\) not in \('owner','office'\)/);
  assert.match(fn[0], /insufficient_privilege/);
  // The payload names only aggregates.
  assert.match(fn[0], /jsonb_build_object\(\s*'minutes'/);
  assert.doesNotMatch(fn[0], /'cost_rate_minor'/);
  // Open entries are excluded from the cost and counted separately.
  assert.match(fn[0], /e\.ended_at is not null/);
});

test("a technician cannot rewrite the labour cost on their own job", () => {
  const guard = /create or replace function public\.guard_job_field_authority[\s\S]*?\$\$;/.exec(migration);
  assert.ok(guard);
  assert.match(guard[0], /'labour_cost_minor'/);
  assert.match(guard[0], /'labour_minutes'/);
  // Everything migration 023 already protected is still protected.
  for (const field of ["price_minor", "customer_id", "assigned_to", "deleted_at", "organization_id", "job_expenses_minor"]) {
    assert.match(guard[0], new RegExp(field), `023's guard on ${field} must survive`);
  }
});

test("invoicing a job carries the labour cost onto the invoice line", () => {
  assert.match(jobActions, /labourInvoiceLine/);
  assert.match(jobActions, /job_labour_cost/);
  assert.match(jobActions, /labour_cost_minor/);
  // cost_minor is the ONLY channel /reports reads, so it has to be written.
  assert.match(jobActions, /cost_minor:\s*l\.cost_minor/);
});

test("setting a pay rate is owner-guarded and inserts a dated row", () => {
  const fn = /export async function setPayRate[\s\S]*?\n}/.exec(teamActions);
  assert.ok(fn);
  assert.match(fn[0], /guardOwner\(\)/);
  assert.match(fn[0], /effective_from/);
  assert.match(fn[0], /technician_pay_rates/);
});
