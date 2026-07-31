import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addMonthsISO, nextDueAfter, recurringJobKey, RECURRING_JOB_SOURCE } from "../lib/core/recurring.mjs";

// ---------------------------------------------------------------------------
// Ledger 4.2 — recurring plan catch-up.
//
// Both generators rolled next_due forward by exactly ONE interval however
// overdue the plan was. A plan two years past due was still past due after
// generation, so every press of "Generate due" (and every nightly cron run)
// minted another back-dated job for the same plan, for ever.
// ---------------------------------------------------------------------------

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
// Strip comments before scanning: a comment describing the bug must not be able
// to satisfy a check about the code that fixes it.
const readCode = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The old behaviour, kept here so the regression can be demonstrated. */
const oneIntervalOnly = (nextDue, interval) => addMonthsISO(nextDue, interval);

// --- the maths -------------------------------------------------------------

test("addMonthsISO walks months and years without drifting", () => {
  assert.equal(addMonthsISO("2026-01-15", 1), "2026-02-15");
  assert.equal(addMonthsISO("2026-01-15", 12), "2027-01-15");
  assert.equal(addMonthsISO("2026-11-30", 3), "2027-02-28");
  assert.equal(addMonthsISO("2026-06-01", 0), "2026-06-01");
  assert.equal(addMonthsISO("2026-03-31", -1), "2026-02-28", "stepping backwards must clamp too");
});

test("addMonthsISO clamps to the end of a short month instead of overflowing", () => {
  // Date#setMonth turns 31 Jan + 1 month into 3 March, so a monthly plan slid
  // two or three days later every single cycle.
  assert.equal(addMonthsISO("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsISO("2024-01-31", 1), "2024-02-29", "leap year");
  assert.equal(addMonthsISO("2026-01-31", 3), "2026-04-30");
  const naive = new Date("2026-01-31T00:00:00Z");
  naive.setUTCMonth(naive.getUTCMonth() + 1);
  assert.equal(naive.toISOString().slice(0, 10), "2026-03-03", "this is what the old helper did");
});

test("addMonthsISO refuses input that is not a date", () => {
  for (const bad of ["", "2026-1-1", "31/01/2026", null, undefined, 20260131]) {
    assert.throws(() => addMonthsISO(bad, 1), TypeError, `${JSON.stringify(bad)} must be rejected`);
  }
  assert.throws(() => addMonthsISO("2026-01-31", "soon"), TypeError);
});

// --- the bug, both ways ----------------------------------------------------

test("THE BUG: one interval leaves a two-year-overdue plan still due", () => {
  const today = "2026-07-31";
  const rolled = oneIntervalOnly("2024-06-01", 12);
  assert.ok(rolled <= today, "the old roll-forward lands in the past — the plan generates again immediately");
});

test("nextDueAfter catches a plan up past today in one go", () => {
  const today = "2026-07-31";
  // Occurrences: 2024-06-01, 2025-06-01, 2026-06-01, 2027-06-01.
  assert.equal(nextDueAfter("2024-06-01", 12, today), "2027-06-01");
  // Monthly, four years behind — the pathological case for a loop.
  assert.equal(nextDueAfter("2022-03-15", 1, today), "2026-08-15");
  // Quarterly, on the cadence the plan actually keeps.
  assert.equal(nextDueAfter("2025-01-10", 3, today), "2026-10-10");
});

test("the caught-up date is always strictly in the future, whatever the interval", () => {
  const today = "2026-07-31";
  for (const start of ["1999-12-31", "2020-02-29", "2024-01-31", "2026-07-30", "2026-07-31"]) {
    for (const interval of [1, 2, 3, 6, 12, 24, 60]) {
      const out = nextDueAfter(start, interval, today);
      assert.ok(out > today, `${start} every ${interval}mo produced ${out}, which is still due`);
    }
  }
});

test("the caught-up date stays ON the plan's cadence — it is not just 'tomorrow'", () => {
  const today = "2026-07-31";
  // Annual plan due on the 1st of June must remain a 1st-of-June plan.
  assert.equal(nextDueAfter("2019-06-01", 12, today).slice(5), "06-01");
  // A monthly plan anchored on the 31st keeps the 31st where one exists.
  assert.equal(nextDueAfter("2020-01-31", 1, today), "2026-08-31");
});

test("a plan that is NOT yet due is left completely alone", () => {
  // The other half of the proof: catch-up must never push a healthy plan
  // forward, which would silently skip its next visit.
  const today = "2026-07-31";
  for (const future of ["2026-08-01", "2026-12-25", "2030-01-01"]) {
    assert.equal(nextDueAfter(future, 12, today), future);
  }
});

test("a plan due exactly today generates today and then moves on", () => {
  assert.equal(nextDueAfter("2026-07-31", 1, "2026-07-31"), "2026-08-31");
});

test("a nonsense interval cannot hang or stall the generator", () => {
  const today = "2026-07-31";
  for (const bad of [0, -12, null, undefined, NaN, "x"]) {
    const out = nextDueAfter("2020-01-01", bad, today);
    assert.ok(out > today, `interval ${JSON.stringify(bad)} produced ${out}`);
  }
});

// --- idempotency -----------------------------------------------------------

test("the occurrence key is stable for the same plan and date, distinct otherwise", () => {
  const plan = "9f1c0e2a-0000-4000-8000-000000000001";
  assert.equal(recurringJobKey(plan, "2026-06-01"), recurringJobKey(plan, "2026-06-01"));
  assert.notEqual(recurringJobKey(plan, "2026-06-01"), recurringJobKey(plan, "2027-06-01"));
  assert.notEqual(recurringJobKey(plan, "2026-06-01"), recurringJobKey("other-plan", "2026-06-01"));
  assert.throws(() => recurringJobKey("", "2026-06-01"), TypeError);
  assert.throws(() => recurringJobKey(plan, "June 1st"), TypeError);
});

test("a second generation of the same occurrence collides at the database", () => {
  // uq_jobs_external_source is unique on (organization_id, external_source,
  // external_id), so identical keys are the mechanism that makes a double click
  // a no-op rather than a duplicate job.
  const sql = read("db/019_operations_growth.sql");
  assert.match(sql, /create unique index if not exists uq_jobs_external_source on public\.jobs\(organization_id, external_source, external_id\)/);
  const seen = new Set();
  const plan = { id: "plan-1", next_due: "2024-06-01" };
  let inserted = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = `${RECURRING_JOB_SOURCE}:${recurringJobKey(plan.id, plan.next_due)}`;
    if (seen.has(key)) continue; // the 23505 the action now swallows
    seen.add(key); inserted++;
  }
  assert.equal(inserted, 1, "five runs of the same occurrence must yield exactly one job");
});

// --- both generators, structurally -----------------------------------------

for (const file of ["app/(app)/recurring/actions.ts", "lib/cron-tasks.ts"]) {
  test(`${file} catches plans up instead of stepping one interval`, () => {
    const code = readCode(file);
    assert.match(code, /nextDueAfter\(\s*dueDate,\s*p\.interval_months,\s*today\s*\)/, "must roll forward past today");
    assert.doesNotMatch(code, /function addMonths\b/, "the one-interval helper must be gone, not shadowed");
    assert.doesNotMatch(code, /setMonth/, "no local month maths — it drifts and it does not catch up");
  });

  test(`${file} gives every generated occurrence a unique database identity`, () => {
    const code = readCode(file);
    assert.match(code, /external_source:\s*RECURRING_JOB_SOURCE/, "the job must be tagged so duplicates collide");
    assert.match(code, /external_id:\s*recurringJobKey\(p\.id,\s*dueDate\)/, "plan + occurrence is the identity");
    assert.match(code, /isUniqueViolation\(error\)/, "a 23505 means 'already generated', not a failure");
  });
}
