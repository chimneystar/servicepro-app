import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "app/(app)/jobs/[id]/actions.ts";

// Comments cannot satisfy a structural check — a detector that fires on prose
// ABOUT the bug has already been written twice on this branch.
const source = readFileSync(path.join(ROOT, FILE), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));

// ---------------------------------------------------------------------------
// Authenticating is not authorising.
//
// Nine write actions in this file called `await requireProfile()` and DISCARDED
// the result. That proves somebody is signed in and establishes nothing about
// whether they may touch this job. Any technician in the organisation could
// toggle another technician's checklist, mark someone else's job as arrived,
// retag it, rewrite its expenses, or delete its tasks and equipment.
//
// Row-level security does not help here, and it is worth being precise about
// why: RLS scopes these rows to the ORGANISATION, and both technicians are in
// it. The check RLS performs is the one that passes.
//
// The rule was not invented to fix this — `setJobStage` already enforced it,
// and these actions simply never got it. That is the recurring shape on this
// branch: a guard that exists, is correct, and is not applied on every path.
// ---------------------------------------------------------------------------

/** Job-scoped writes: a technician may only act on a job assigned to them. */
const JOB_SCOPED_WRITES = [
  "updateJobAddress",
  "toggleJobTask",
  "deleteJobTask",
  "toggleChecklistItem",
  "deleteChecklistItem",
  "deleteEquipment",
  "markArrived",
  "setJobTags",
  "setJobExpenses",
];

/** The body of an exported action, from its signature to the next one. */
function bodyOf(name) {
  const start = source.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} not found in ${FILE} — was it renamed?`);
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

test("every job-scoped write checks that the job belongs to the technician", () => {
  const ungated = JOB_SCOPED_WRITES.filter((name) => !/assertJobAccess\(/.test(bodyOf(name)));
  assert.deepEqual(
    ungated,
    [],
    "these actions authenticate but do not authorise — a technician can act on another " +
      "technician's job:\n  " +
      ungated.join("\n  "),
  );
});

test("none of them discards the profile it just fetched", () => {
  // `await requireProfile();` with no binding is the exact shape of the defect:
  // it reads as a guard and authorises nothing.
  const discarding = JOB_SCOPED_WRITES.filter((name) =>
    /^\s*await requireProfile\(\);\s*$/m.test(bodyOf(name)),
  );
  assert.deepEqual(
    discarding,
    [],
    `these still call requireProfile() without using the result:\n  ${discarding.join("\n  ")}`,
  );
});

test("the check refuses, rather than silently doing nothing", () => {
  // A guard that returns ok:true on refusal is worse than none — the caller
  // reports success and the user believes the change was saved.
  for (const name of JOB_SCOPED_WRITES) {
    const body = bodyOf(name);
    assert.match(
      body,
      /const denied = await assertJobAccess\([^)]*\);\s*if \(denied\) return denied;/,
      `${name} must return the refusal, not ignore it`,
    );
  }
});

test("the helper only restricts technicians, and reads assignment from the database", () => {
  const helper = source.slice(source.indexOf("async function assertJobAccess"));
  const body = helper.slice(0, helper.indexOf("\nexport async function "));

  // Owner and office must pass untouched — this fix must not remove a capability
  // from anyone who legitimately had it.
  assert.match(body, /profile\.role !== "tech"/, "owner and office must be unaffected");
  assert.match(body, /return null/, "and must return without a refusal");

  // Assignment comes from the row, not from anything the caller supplied.
  assert.match(body, /\.from\("jobs"\)/);
  assert.match(body, /assigned_to/);
  assert.match(body, /\.eq\("id", jobId\)/);

  // A missing job is a refusal, not a pass. Otherwise deleting a job would
  // silently widen access to its children.
  assert.match(body, /if \(!job\) return \{ ok: false/, "a missing job must refuse");
});

test("setJobStage — the action that already had the rule — still has it", () => {
  // The precedent this fix follows. If it ever loses the check, the nine above
  // are following a rule that no longer exists anywhere.
  const body = bodyOf("setJobStage");
  assert.match(body, /profile\.role === "tech"/);
  assert.match(body, /assigned_to !== profile\.id/);
});
