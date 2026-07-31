import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canTransition, JOB_STATUSES } from "../lib/core/scheduling.mjs";

const readCode = (p) =>
  readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// ---------------------------------------------------------------------------
// STATUS TRANSITIONS (ledger 5.15)
//
// lib/core/scheduling.mjs has defined and tested the legal transitions since
// early in the project — `done` and `cancelled` are terminal — and NO
// APPLICATION CODE EVER CALLED IT. The rules existed, were correct, were covered
// by passing tests, and governed nothing.
//
// Meanwhile setJobStatus and updateJobStatus accepted an arbitrary string and
// checked only that the caller was signed in. Neither is referenced by any
// component: dead in the UI, live on the network.
// ---------------------------------------------------------------------------

test("a completed job cannot be reopened", () => {
  for (const target of JOB_STATUSES) {
    assert.equal(canTransition("done", target), false, `done -> ${target} must be refused`);
    assert.equal(
      canTransition("cancelled", target),
      false,
      `cancelled -> ${target} must be refused`,
    );
  }
});

test("legitimate progress is still allowed (not a cry-wolf)", () => {
  assert.equal(canTransition("scheduled", "in_progress"), true);
  assert.equal(canTransition("in_progress", "done"), true);
  assert.equal(canTransition("scheduled", "cancelled"), true);
  assert.equal(canTransition("in_progress", "cancelled"), true);
  assert.equal(canTransition("scheduled", "scheduled"), true, "a reschedule keeps the status");
});

test("an unknown status is refused in both directions", () => {
  assert.equal(canTransition("scheduled", "finished"), false);
  assert.equal(canTransition("archived", "done"), false);
  assert.equal(canTransition("", ""), false);
});

test("both status actions route through the guard", () => {
  for (const file of ["app/(app)/schedule/actions.ts", "app/(app)/jobs/[id]/actions.ts"]) {
    const src = readCode(file);
    assert.ok(/changeJobStatus\(/.test(src), `${file} must use the guarded path`);
    assert.ok(
      !/from\("jobs"\)\.update\(\{ status \}\)/.test(src),
      `${file} writes an arbitrary status straight to the column`,
    );
  }
});

test("the guard checks membership, the status set, and the transition", () => {
  const src = readCode("lib/job-status.ts");
  assert.ok(/JOB_STATUSES\.includes\(target\)/.test(src), "an arbitrary string must be refused");
  assert.ok(/canTransition\(/.test(src), "the transition must be legal for the CURRENT status");
  assert.ok(
    /role === "tech"[\s\S]{0,120}assigned_to/.test(src),
    "a technician must only move a job assigned to them",
  );
});

// ---------------------------------------------------------------------------
// CUSTOMER-VISIBLE PHOTOS (ledger 5.14)
//
// job_photos.customer_visible has existed since migration 019 with a default of
// true. It was selected on the job page and passed into the component — and
// nothing read it and nothing could change it. The job report is the artifact
// PRINTED AND HANDED TO THE CUSTOMER, and it showed every photo, including
// internal evidence shots.
// ---------------------------------------------------------------------------

test("the customer report only shows photos marked visible", () => {
  const src = readCode("app/(app)/jobs/[id]/report/page.tsx");
  assert.ok(
    /eq\("customer_visible", true\)/.test(src),
    "the customer-facing report must filter on the flag — otherwise the flag means nothing",
  );
});

test("the flag can actually be changed", () => {
  const actions = readCode("app/(app)/jobs/[id]/actions.ts");
  assert.ok(/export async function setPhotoCustomerVisible/.test(actions));
  assert.ok(
    /organization_id !== profile\.organization_id/.test(actions),
    "the photo must belong to the caller's organisation",
  );

  const ui = readCode("components/JobPhotos.tsx");
  assert.ok(/setPhotoCustomerVisible\(/.test(ui), "the UI must expose it, or it is still a stub");
  assert.ok(
    /aria-label=/.test(ui),
    "the control needs an accessible name — it is an icon-only button",
  );
});

test("a failed toggle is surfaced, not swallowed", () => {
  const ui = readCode("components/JobPhotos.tsx");
  // `\s*` after the condition: ledger 6.4 moved `setError(...)` onto its own
  // line. What is guarded is unchanged and is still exact — the failure branch
  // of the toggle must call setError. A `!result.ok` that did anything else,
  // or nothing, still fails.
  assert.ok(
    /if\s*\(!result\.ok\)\s*setError\(/.test(ui),
    "a silently-failed toggle leaves a private photo on the customer's document",
  );
});

// ---------------------------------------------------------------------------
// The guard has to cover the LIVE paths, not only the two dead endpoints.
//
// Found by a parallel agent reviewing its own out-of-scope surroundings: I had
// routed setJobStatus and updateJobStatus (neither referenced by any component)
// through the guard, and left setJobStage — which IS what the stage dropdown
// calls — writing a derived status straight to the column. Moving a completed
// job back to an earlier stage silently reopened it.
//
// Securing the unused door and leaving the used one open is worse than not
// having built the guard, because the ledger then claims the rule is enforced.
// ---------------------------------------------------------------------------

test("the live stage-change path enforces the transition rules", () => {
  const src = readCode("app/(app)/jobs/[id]/actions.ts");
  const fn = src.slice(src.indexOf("export async function setJobStage"));
  assert.ok(
    /canTransition\(/.test(fn.slice(0, 2000)),
    "setJobStage derives the enum status from the stage — it must check the transition is legal",
  );
  assert.ok(
    /assigned_to !== profile\.id/.test(fn.slice(0, 2000)),
    "a technician must only move a job assigned to them",
  );
});

test("clocking in cannot restart a finished job", () => {
  const src = readCode("app/(app)/jobs/[id]/actions.ts");
  const fn = src.slice(src.indexOf("export async function clockIn"));
  assert.ok(
    /\.in\("status", \["scheduled", "in_progress"\]\)/.test(fn.slice(0, 1200)),
    "`is(started_at, null)` alone would restart a job completed without ever being clocked",
  );
});

test("the offline path refuses events that can never apply", () => {
  const src = readCode("app/api/sync/job-status/route.ts");
  assert.ok(
    /\.in\("status", allowedFrom\)/.test(src),
    "a queued start for a job completed while offline must not reopen it",
  );
  assert.ok(
    /updated\.length === 0[\s\S]{0,200}rejected\.push/.test(src),
    "an event that can never apply must be REJECTED so the client drops it, not retried for ever",
  );
});
