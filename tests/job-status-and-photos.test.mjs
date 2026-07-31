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
    assert.equal(canTransition("cancelled", target), false, `cancelled -> ${target} must be refused`);
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
    assert.ok(!/from\("jobs"\)\.update\(\{ status \}\)/.test(src),
      `${file} writes an arbitrary status straight to the column`);
  }
});

test("the guard checks membership, the status set, and the transition", () => {
  const src = readCode("lib/job-status.ts");
  assert.ok(/JOB_STATUSES\.includes\(target\)/.test(src), "an arbitrary string must be refused");
  assert.ok(/canTransition\(/.test(src), "the transition must be legal for the CURRENT status");
  assert.ok(/role === "tech"[\s\S]{0,120}assigned_to/.test(src),
    "a technician must only move a job assigned to them");
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
  assert.ok(/eq\("customer_visible", true\)/.test(src),
    "the customer-facing report must filter on the flag — otherwise the flag means nothing");
});

test("the flag can actually be changed", () => {
  const actions = readCode("app/(app)/jobs/[id]/actions.ts");
  assert.ok(/export async function setPhotoCustomerVisible/.test(actions));
  assert.ok(/organization_id !== profile\.organization_id/.test(actions),
    "the photo must belong to the caller's organisation");

  const ui = readCode("components/JobPhotos.tsx");
  assert.ok(/setPhotoCustomerVisible\(/.test(ui), "the UI must expose it, or it is still a stub");
  assert.ok(/aria-label=/.test(ui), "the control needs an accessible name — it is an icon-only button");
});

test("a failed toggle is surfaced, not swallowed", () => {
  const ui = readCode("components/JobPhotos.tsx");
  assert.ok(/if \(!result\.ok\) setError/.test(ui),
    "a silently-failed toggle leaves a private photo on the customer's document");
});
