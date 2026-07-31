import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// jobs.end_date was nullable with no default, and the dispatch board matches
//   scheduled_date <= :day AND (end_date >= :day OR end_date IS NULL)
// so a job with a null end_date reappears on EVERY future day, for ever. The
// nightly cron created such jobs automatically, so the board degraded on its
// own with nobody doing anything wrong.
// ---------------------------------------------------------------------------

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const readCode = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Reproduce the dispatch board's predicate exactly. */
const showsOnDay = (job, day) =>
  job.scheduled_date <= day && (job.end_date === null || job.end_date >= day);

test("a null end_date makes a job appear on every future day", () => {
  const phantom = { scheduled_date: "2026-01-01", end_date: null };
  for (const day of ["2026-01-02", "2026-06-15", "2027-01-01", "2099-12-31"]) {
    assert.equal(showsOnDay(phantom, day), true, `the old bug: still showing on ${day}`);
  }
});

test("with end_date set, a job appears only on its own days", () => {
  const job = { scheduled_date: "2026-01-01", end_date: "2026-01-01" };
  assert.equal(showsOnDay(job, "2026-01-01"), true, "it must still show on its own day");
  assert.equal(showsOnDay(job, "2026-01-02"), false);
  assert.equal(showsOnDay(job, "2025-12-31"), false);
});

test("a genuine multi-day job still spans its range", () => {
  // The fix must not break legitimate multi-day work.
  const job = { scheduled_date: "2026-03-02", end_date: "2026-03-05" };
  for (const day of ["2026-03-02", "2026-03-03", "2026-03-05"]) {
    assert.equal(showsOnDay(job, day), true, `must span ${day}`);
  }
  assert.equal(showsOnDay(job, "2026-03-06"), false);
});

test("every job-creating path sets end_date", () => {
  const paths = [
    ["app/(app)/schedule/actions.ts", /end_date/],
    ["app/(app)/recurring/actions.ts", /end_date: p\.next_due/],
    ["lib/cron-tasks.ts", /end_date: p\.next_due/],
    ["app/api/booking/[org]/submit/route.ts", /end_date:\s*date/],
  ];
  for (const [file, pattern] of paths) {
    assert.match(readCode(file), pattern, `${file} inserts a job without end_date — it will pollute the dispatch board`);
  }
});

test("the database makes the null case impossible", () => {
  const sql = read("db/025_job_end_date_default.sql").toLowerCase();
  assert.ok(/update public\.jobs\s+set end_date = scheduled_date/.test(sql), "existing phantom rows must be repaired");
  assert.ok(/default_job_end_date/.test(sql), "a row-level default must backstop application code");
  assert.ok(/set not null/.test(sql), "the column must ultimately reject nulls");
  assert.ok(/end_date >= scheduled_date/.test(sql), "an end before the start is also invalid");
});
