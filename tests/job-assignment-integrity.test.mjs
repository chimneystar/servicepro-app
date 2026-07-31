import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { errorCode, isUniqueViolation, isDoubleBookConflict } from "../lib/core/db-errors.mjs";

// ---------------------------------------------------------------------------
// Ledger 4.4 (clockIn race), 4.5 (dispatch reassignment) and 4.11 (crew
// assignments bypass the no-double-book guarantee).
//
// All three are the same shape of mistake: the database knows the answer, and
// the application either raced it, ignored it, or never asked.
// ---------------------------------------------------------------------------

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
// Comments are stripped before scanning, so a comment describing the fix cannot
// stand in for the fix.
const readCode = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const readSql = (p) =>
  read(p)
    .replace(/^\s*--.*$/gm, "")
    .toLowerCase();

// ===========================================================================
// SQLSTATE classification — the shared vocabulary all three fixes rely on.
// ===========================================================================

test("23505 is recognised as a unique violation, and nothing else is", () => {
  assert.equal(isUniqueViolation({ code: "23505", message: "duplicate key" }), true);
  assert.equal(isUniqueViolation("23505"), true);
  for (const other of [
    { code: "23P01" },
    { code: "23503" },
    { code: "42501" },
    { code: "2350" },
    { code: "235050" },
  ]) {
    assert.equal(
      isUniqueViolation(other),
      false,
      `${JSON.stringify(other)} must not read as a duplicate`,
    );
  }
});

test("23P01 is recognised as a double-book conflict, and nothing else is", () => {
  assert.equal(
    isDoubleBookConflict({
      code: "23P01",
      message: "conflicting key value violates exclusion constraint",
    }),
    true,
  );
  for (const other of [{ code: "23505" }, { code: "23p01" }, { code: "P0001" }, { code: "" }]) {
    assert.equal(
      isDoubleBookConflict(other),
      false,
      `${JSON.stringify(other)} must not read as a booking conflict`,
    );
  }
});

test("a missing or malformed error never masquerades as a handled one", () => {
  // The dangerous failure direction: treating an unknown error as "already
  // clocked in" or "already booked" would hide a genuine write failure.
  for (const nothing of [null, undefined, {}, { code: 23505 }, { code: null }, []]) {
    assert.equal(isUniqueViolation(nothing), false);
    assert.equal(isDoubleBookConflict(nothing), false);
    assert.equal(errorCode(nothing) === "23505", false);
  }
});

// ===========================================================================
// 4.4 — clockIn must not read-then-write.
// ===========================================================================

/** The old shape: check for an open entry, then insert. Two callers interleave. */
function racyClockIn(store, userId) {
  const open = store.filter((e) => e.user_id === userId && e.ended_at === null);
  return { willInsert: open.length === 0 };
}

test("THE BUG: two concurrent clock-ins both pass a read-then-write check", () => {
  const store = [];
  const a = racyClockIn(store, "tech-1"); // both read before either writes
  const b = racyClockIn(store, "tech-1");
  assert.equal(a.willInsert && b.willInsert, true, "a double tap opens two timers");
});

test("the unique index is what makes the second clock-in a no-op", () => {
  // Simulating the index the action now leans on: unique on (job_id, user_id)
  // where ended_at is null.
  const store = [];
  const insert = (row) => {
    if (
      store.some((e) => e.job_id === row.job_id && e.user_id === row.user_id && e.ended_at === null)
    ) {
      return { error: { code: "23505" } };
    }
    store.push(row);
    return { error: null };
  };
  const clockIn = (jobId, userId) => {
    const { error } = insert({ job_id: jobId, user_id: userId, ended_at: null });
    if (error && !isUniqueViolation(error)) return { ok: false, error: error.code };
    return { ok: true };
  };
  assert.deepEqual(clockIn("job-1", "tech-1"), { ok: true });
  assert.deepEqual(
    clockIn("job-1", "tech-1"),
    { ok: true },
    "the double tap must succeed silently, not error at the technician",
  );
  assert.equal(
    store.filter((e) => e.ended_at === null).length,
    1,
    "exactly one open timer — the job page must not double-count",
  );
  // A different technician on the same job is a legitimate second timer.
  assert.deepEqual(clockIn("job-1", "tech-2"), { ok: true });
  assert.equal(store.length, 2, "the guard must not block a second person clocking in");
});

test("clockIn relies on the constraint instead of a pre-read", () => {
  const code = readCode("app/(app)/jobs/[id]/actions.ts");
  const body = code.slice(
    code.indexOf("export async function clockIn"),
    code.indexOf("export async function clockOut"),
  );
  assert.ok(body.length > 0, "clockIn must still exist");
  assert.doesNotMatch(
    body,
    /from\("job_time_entries"\)\s*\n?\s*\.select/,
    "the read-then-write race must be gone",
  );
  assert.match(body, /isUniqueViolation\(error\)/, "23505 must be handled as 'already clocked in'");
  assert.match(
    body,
    /if \(error && !isUniqueViolation\(error\)\) return \{ ok: false/,
    "every OTHER error must still surface",
  );
});

test("the open-entry uniqueness actually exists in the schema", () => {
  const sql = readSql("db/023_authorization_hardening.sql");
  assert.match(
    sql,
    /create unique index if not exists uq_job_time_entries_one_open\s+on public\.job_time_entries \(job_id, user_id\)\s+where ended_at is null/,
  );
});

// ===========================================================================
// 4.5 — dispatch reassignment.
// ===========================================================================

/** The board's own rule for which chips it draws as extra crew on a card. */
const extraCrew = (assignments, job) =>
  assignments
    .filter((row) => row.job_id === job.id && row.profile_id && row.profile_id !== job.assigned_to)
    .map((row) => row.profile_id);

test("THE BUG: the previous lead is left behind and renders as extra crew", () => {
  const job = { id: "job-1", assigned_to: "tech-a" };
  const assignments = [{ job_id: "job-1", profile_id: "tech-a", is_lead: true }];
  // Old move(): upsert the new lead, remove nothing.
  job.assigned_to = "tech-b";
  assignments.push({ job_id: "job-1", profile_id: "tech-b", is_lead: true });
  assert.deepEqual(
    extraCrew(assignments, job),
    ["tech-a"],
    "tech-a still shows on a job they no longer have",
  );
});

/** The fixed move: retire stale lead rows, then claim the new one. */
function moveAssignments(assignments, jobId, profileId) {
  const kept = assignments.filter(
    (row) => !(row.job_id === jobId && row.is_lead && row.profile_id !== profileId),
  );
  if (!profileId) return kept;
  const existing = kept.find((row) => row.job_id === jobId && row.profile_id === profileId);
  if (existing) return kept.map((row) => (row === existing ? { ...row, is_lead: true } : row));
  return [...kept, { job_id: jobId, profile_id: profileId, is_lead: true }];
}

test("reassigning retires the outgoing lead's row", () => {
  const assignments = moveAssignments(
    [{ job_id: "job-1", profile_id: "tech-a", is_lead: true }],
    "job-1",
    "tech-b",
  );
  assert.deepEqual(extraCrew(assignments, { id: "job-1", assigned_to: "tech-b" }), []);
});

test("moving a job to Unassigned removes the lead row too", () => {
  // The case that removed nothing at all: profileId === null took an early exit.
  const assignments = moveAssignments(
    [{ job_id: "job-1", profile_id: "tech-a", is_lead: true }],
    "job-1",
    null,
  );
  assert.deepEqual(assignments, [], "an unassigned job must have no lead assignment left");
});

test("genuine extra crew and other jobs survive a reassignment", () => {
  // The false-positive half: over-deleting would quietly strip the second and
  // third technicians off a two-person job.
  const before = [
    { job_id: "job-1", profile_id: "tech-a", is_lead: true },
    { job_id: "job-1", profile_id: "tech-c", is_lead: false },
    { job_id: "job-2", profile_id: "tech-a", is_lead: true },
  ];
  const after = moveAssignments(before, "job-1", "tech-b");
  assert.deepEqual(
    extraCrew(after, { id: "job-1", assigned_to: "tech-b" }),
    ["tech-c"],
    "crew must be untouched",
  );
  assert.ok(
    after.some((r) => r.job_id === "job-2" && r.profile_id === "tech-a" && r.is_lead),
    "another job's lead must be untouched",
  );
});

test("promoting an existing crew member to lead does not duplicate their row", () => {
  const after = moveAssignments(
    [
      { job_id: "job-1", profile_id: "tech-a", is_lead: true },
      { job_id: "job-1", profile_id: "tech-b", is_lead: false },
    ],
    "job-1",
    "tech-b",
  );
  assert.equal(after.filter((r) => r.job_id === "job-1" && r.profile_id === "tech-b").length, 1);
  assert.equal(after.find((r) => r.profile_id === "tech-b").is_lead, true);
});

test("moveDispatchJob clears the stale lead in both the reassign and unassign paths", () => {
  const code = readCode("app/(app)/dispatch/actions.ts");
  const body = code.slice(
    code.indexOf("export async function moveDispatchJob"),
    code.indexOf("export async function addJobTechnician"),
  );
  // `\s*` between tokens: ledger 6.4 broke these chains across lines. Each
  // regex still names the same table, the same method and the same arguments,
  // so dropping the delete, widening it past `is_lead`, or skipping the
  // unassign path all still fail.
  assert.match(
    body,
    /from\("job_assignments"\)\s*\.delete\(\)/,
    "the outgoing lead's row must be deleted",
  );
  assert.match(
    body,
    /\.eq\(\s*"is_lead",\s*true,?\s*\)/,
    "only lead rows may be retired — crew must survive",
  );
  assert.match(
    body,
    /profileId\s*\?\s*stale\.neq\(\s*"profile_id",\s*profileId,?\s*\)\s*:\s*stale/,
    "the unassign path must delete too, not skip",
  );
});

test("a double-book is reported as a double-book, not as 'something went wrong'", () => {
  const code = readCode("app/(app)/dispatch/actions.ts");
  assert.match(
    code,
    /isDoubleBookConflict\(error\)\) return \{ ok: false, error: t\(locale, "sched\.conflict"\)/,
  );
  assert.match(
    code,
    /export type DispatchResult = \{ ok: boolean; error\?: string \}/,
    "the action must be able to carry a reason",
  );
  const board = readCode("components/DispatchBoard.tsx");
  assert.match(
    board,
    /setNotice\(result\.error \|\| failed\)/,
    "the board must show the reason it was given",
  );
  assert.equal(
    (board.match(/setNotice\(result\.error \|\| failed\)/g) ?? []).length,
    3,
    "move, add and remove must all report",
  );
});

test("the conflict message exists in both languages", () => {
  const i18n = read("lib/i18n.ts");
  assert.equal((i18n.match(/"sched\.conflict":/g) ?? []).length, 2, "English and Hebrew");
});

// ===========================================================================
// 4.11 — crew assignments must respect the no-double-book guarantee.
// ===========================================================================

const overlaps = (a, b) => a.date === b.date && a.start < b.end && b.start < a.end;

test("THE BUG: only jobs.assigned_to is covered by an exclusion constraint", () => {
  const schema = readSql("db/schema.sql");
  const constraint = schema.slice(schema.indexOf("jobs_no_double_book"));
  assert.match(
    constraint,
    /assigned_to with =/,
    "the original guard is keyed on assigned_to alone",
  );
  // job_assignments carries no times of its own, so no exclusion constraint on
  // that table could ever have covered it.
  const growth = readSql("db/019_operations_growth.sql");
  const table = growth.slice(
    growth.indexOf("create table if not exists public.job_assignments"),
    growth.indexOf("create table if not exists public.service_areas"),
  );
  for (const timeColumn of ["start_time", "end_time", "scheduled_date", "slot"]) {
    assert.doesNotMatch(
      table,
      new RegExp(timeColumn),
      `job_assignments has no ${timeColumn} — the overlap lives on the job`,
    );
  }
});

test("the crew predicate catches overlaps the lead-only constraint misses", () => {
  // Reproducing migration 028's predicate against the same fixture.
  const jobs = [
    {
      id: "j1",
      date: "2026-08-03",
      start: "09:00",
      end: "11:00",
      assigned_to: "lead-1",
      status: "scheduled",
      deleted_at: null,
    },
    {
      id: "j2",
      date: "2026-08-03",
      start: "10:00",
      end: "12:00",
      assigned_to: "lead-2",
      status: "scheduled",
      deleted_at: null,
    },
    {
      id: "j3",
      date: "2026-08-03",
      start: "13:00",
      end: "14:00",
      assigned_to: "lead-2",
      status: "scheduled",
      deleted_at: null,
    },
    {
      id: "j4",
      date: "2026-08-04",
      start: "10:00",
      end: "12:00",
      assigned_to: "lead-2",
      status: "scheduled",
      deleted_at: null,
    },
    {
      id: "j5",
      date: "2026-08-03",
      start: "10:00",
      end: "12:00",
      assigned_to: "lead-3",
      status: "cancelled",
      deleted_at: null,
    },
    {
      id: "j6",
      date: "2026-08-03",
      start: "10:30",
      end: "11:30",
      assigned_to: null,
      status: "scheduled",
      deleted_at: "2026-07-01",
    },
  ];
  const crew = [{ job_id: "j2", profile_id: "tech-x", status: "assigned" }];
  const doubleBooked = (jobId, profileId) => {
    const job = jobs.find((j) => j.id === jobId);
    if (!job || job.status === "cancelled" || job.deleted_at) return false;
    return jobs.some(
      (other) =>
        other.id !== jobId &&
        !other.deleted_at &&
        other.status !== "cancelled" &&
        overlaps(other, job) &&
        (other.assigned_to === profileId ||
          crew.some(
            (a) => a.job_id === other.id && a.profile_id === profileId && a.status !== "declined",
          )),
    );
  };
  // FIRES: tech-x is crew on j2 (10-12); putting them on j1 (9-11) overlaps.
  assert.equal(
    doubleBooked("j1", "tech-x"),
    true,
    "the guard must refuse an overlapping crew assignment",
  );
  // FIRES: the reverse direction — the lead of an overlapping job as crew.
  assert.equal(
    doubleBooked("j1", "lead-2"),
    true,
    "crew must also collide with that person's own lead jobs",
  );
  // SILENT: adjacent slot, different day, cancelled job, deleted job, free tech.
  assert.equal(doubleBooked("j3", "tech-x"), false, "13:00 does not overlap 10:00-12:00");
  assert.equal(doubleBooked("j4", "tech-x"), false, "the next day is not a conflict");
  assert.equal(doubleBooked("j1", "lead-3"), false, "a cancelled job does not hold a technician");
  assert.equal(doubleBooked("j1", "free-tech"), false, "an unbooked technician must be assignable");
  assert.equal(
    doubleBooked("j5", "tech-x"),
    false,
    "assigning onto a cancelled job is not checked",
  );
});

test("migration 028 enforces the same rule at the database", () => {
  const sql = readSql("db/028_crew_double_book.sql");
  assert.match(
    sql,
    /create or replace function public\.crew_double_booked/,
    "the predicate must exist",
  );
  assert.match(
    sql,
    /public\.job_assignments/,
    "it must look at crew rows, not only jobs.assigned_to",
  );
  assert.match(
    sql,
    /other\.slot && v_slot/,
    "overlap must be range overlap, matching jobs_no_double_book",
  );
  assert.match(sql, /errcode = '23p01'/, "it must raise the same SQLSTATE the app already maps");
  // Both directions: adding crew, and rescheduling a job that already has crew.
  assert.match(
    sql,
    /create trigger trg_job_assignments_no_double_book\s+before insert or update[\s\S]{0,120}on public\.job_assignments/,
  );
  assert.match(
    sql,
    /create trigger trg_jobs_crew_no_double_book\s+after update[\s\S]{0,120}on public\.jobs/,
  );
  // It must not fire on things that are not commitments.
  assert.match(sql, /assignment_status <> 'declined'/, "a declined assignment is not a booking");
  assert.match(sql, /status <> 'cancelled'/, "a cancelled job does not hold a technician");
});

test("migration 028 is re-runnable and destroys nothing", () => {
  const sql = readSql("db/028_crew_double_book.sql");
  assert.match(sql, /create index if not exists/, "indexes must be conditional");
  assert.equal(
    (sql.match(/create or replace function/g) ?? []).length,
    3,
    "functions must be replaceable",
  );
  for (const destructive of [
    /drop table/,
    /drop column/,
    /drop constraint/,
    /drop function/,
    /delete from/,
    /truncate/,
  ]) {
    assert.doesNotMatch(
      sql,
      destructive,
      `${destructive} must not appear in a hardening migration`,
    );
  }
  // Historical overlaps are surveyed and reported, never enforced retroactively.
  assert.match(sql, /raise notice 'migration 028: % existing crew assignment/);
});
