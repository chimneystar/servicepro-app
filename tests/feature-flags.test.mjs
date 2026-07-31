import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KNOWN_FLAGS, evaluateFlag, flagBucket, flagFallback } from "../lib/core/feature-flags.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const on = {
  key: "growth_outreach",
  enabled: true,
  rollout_percent: 100,
  organization_allowlist: [],
  organization_blocklist: [],
};

// ---------------------------------------------------------------------------
// The kill switch, proven in BOTH directions. A flag that could only ever say
// "off" would silently disable the very features it is meant to protect.
// ---------------------------------------------------------------------------

test("an enabled flag at 100% is on for everybody", () => {
  assert.equal(evaluateFlag(on, ORG, false), true);
  assert.equal(evaluateFlag(on, OTHER, false), true);
});

test("disabling the flag turns the feature off for everybody", () => {
  assert.equal(evaluateFlag({ ...on, enabled: false }, ORG, true), false);
  assert.equal(evaluateFlag({ ...on, enabled: false }, OTHER, true), false);
});

test("the kill switch beats an allowlist entry", () => {
  // Operator turns it off at 2am; a pilot entry added months ago must not
  // quietly keep the feature running for that business.
  const flag = { ...on, enabled: false, organization_allowlist: [ORG] };
  assert.equal(evaluateFlag(flag, ORG, true), false);
});

test("a blocklist entry beats everything, including a full rollout", () => {
  const flag = { ...on, organization_blocklist: [ORG], organization_allowlist: [ORG] };
  assert.equal(evaluateFlag(flag, ORG, true), false);
  assert.equal(evaluateFlag(flag, OTHER, true), true, "and only that organisation is affected");
});

test("an allowlisted organisation gets the feature at 0% rollout", () => {
  const flag = { ...on, rollout_percent: 0, organization_allowlist: [ORG] };
  assert.equal(evaluateFlag(flag, ORG, false), true);
  assert.equal(evaluateFlag(flag, OTHER, true), false, "nobody else does");
});

test("0% means nobody and 100% means everybody", () => {
  const orgs = Array.from({ length: 50 }, (_, i) => `org-${i}`);
  assert.equal(
    orgs.some((org) => evaluateFlag({ ...on, rollout_percent: 0 }, org, true)),
    false,
  );
  assert.equal(
    orgs.every((org) => evaluateFlag({ ...on, rollout_percent: 100 }, org, false)),
    true,
  );
});

test("a partial rollout is deterministic and monotonic", () => {
  // Deterministic: the same business must not flicker between page loads.
  for (const org of [ORG, OTHER, "org-7"]) {
    const first = evaluateFlag({ ...on, rollout_percent: 50 }, org, false);
    for (let i = 0; i < 5; i++)
      assert.equal(evaluateFlag({ ...on, rollout_percent: 50 }, org, false), first);
  }
  // Monotonic: widening a rollout can only ever add businesses.
  const orgs = Array.from({ length: 200 }, (_, i) => `org-${i}`);
  const at = (pct) =>
    orgs.filter((org) => evaluateFlag({ ...on, rollout_percent: pct }, org, false));
  const ten = at(10),
    fifty = at(50);
  for (const org of ten)
    assert.ok(fifty.includes(org), "a business inside 10% must stay inside 50%");
  assert.ok(
    ten.length > 0 && ten.length < orgs.length,
    `10% selected ${ten.length}/200 — neither nobody nor everybody`,
  );
  assert.ok(fifty.length > ten.length);
});

test("buckets are stable, in range, and differ between flags", () => {
  assert.equal(flagBucket("a", ORG), flagBucket("a", ORG));
  for (const org of ["", ORG, OTHER, "x".repeat(200)]) {
    const bucket = flagBucket("automation_rules", org);
    assert.ok(
      Number.isInteger(bucket) && bucket >= 0 && bucket < 100,
      `bucket ${bucket} out of range`,
    );
  }
  // Two flags must not roll out to exactly the same slice of customers.
  const orgs = Array.from({ length: 100 }, (_, i) => `org-${i}`);
  const differing = orgs.filter(
    (org) => flagBucket("automation_rules", org) !== flagBucket("growth_outreach", org),
  );
  assert.ok(differing.length > 50, "flags must bucket independently");
});

test("a missing row uses the caller's explicit default, never a silent off", () => {
  // This is the defect in the other direction: a feature that used to work must
  // not be disabled just because nobody has created its flag row yet.
  assert.equal(evaluateFlag(null, ORG, true), true);
  assert.equal(evaluateFlag(undefined, ORG, true), true);
  assert.equal(evaluateFlag(null, ORG, false), false);
  assert.throws(() => evaluateFlag(null, ORG), /explicit boolean fallback/);
  assert.throws(() => evaluateFlag(on, ORG, "yes"), /explicit boolean fallback/);
});

test("a malformed row cannot accidentally enable a feature", () => {
  assert.equal(
    evaluateFlag({ enabled: "true", rollout_percent: 100 }, ORG, false),
    false,
    "enabled must be a real boolean",
  );
  assert.equal(evaluateFlag({ enabled: true, rollout_percent: "lots" }, ORG, false), false);
  assert.equal(
    evaluateFlag({ enabled: true, rollout_percent: 50 }, "", false),
    false,
    "no organisation to bucket",
  );
  assert.equal(
    evaluateFlag({ enabled: true, rollout_percent: 100, organization_blocklist: null }, ORG, false),
    true,
  );
});

test("only flags this codebase actually reads are declared known", () => {
  assert.deepEqual(Object.keys(KNOWN_FLAGS).sort(), ["automation_rules", "growth_outreach"]);
  assert.equal(flagFallback("automation_rules"), true);
  assert.equal(flagFallback("growth_outreach"), true);
  assert.throws(() => flagFallback("privacy_center"), /unknown feature flag/);
});

// ---------------------------------------------------------------------------
// Structural guards — comments stripped, since these files explain the defect
// they close in prose.
// ---------------------------------------------------------------------------

const read = (p) =>
  readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const readRaw = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("comment stripping works before anything is asserted on it", () => {
  const stripped = read("lib/feature-flags.ts");
  assert.ok(!/read by nothing at all/.test(stripped), "block comments must be removed");
  assert.ok(/featureFlagEvaluator/.test(stripped), "code must survive stripping");
});

test("feature_flags now has a real reader, and the cron is it", () => {
  const reader = read("lib/feature-flags.ts");
  assert.ok(/from\("feature_flags"\)/.test(reader), "something must actually SELECT the table");
  assert.ok(/evaluateFlag\(/.test(reader), "the decision must come from the tested pure function");
  const cron = read("lib/cron-tasks.ts");
  assert.ok(/featureFlagEvaluator\("automation_rules"\)/.test(cron));
  assert.ok(/featureFlagEvaluator\("growth_outreach"\)/.test(cron));
  assert.ok(/enabledFor\(/.test(cron), "the flag must gate the work, not merely be read");
});

test("flags are read with the service-role client, because RLS forbids any other", () => {
  // Migration 022 revokes feature_flags from anon AND authenticated and adds a
  // deny-all policy, so a user-scoped client would always read nothing — which
  // would look exactly like "flag off" for every business.
  const migration = readRaw("db/022_operations_privacy_team_admin.sql");
  assert.ok(/revoke all on public\.%I from anon, authenticated/.test(migration));
  assert.ok(/feature_flags/.test(migration));
  const reader = read("lib/feature-flags.ts");
  assert.ok(/createAdminClient\(\)/.test(reader));
});

test("the two flags that gate code are seeded enabled, not off", () => {
  // A flag that shipped disabled would recreate the exact defect being fixed:
  // a feature that exists and never runs.
  const sql = readRaw("db/032_automation_execution.sql");
  assert.ok(/insert into public\.feature_flags/.test(sql));
  assert.ok(/\('automation_rules',[^;]*?,true,100\)/.test(sql));
  assert.ok(/\('growth_outreach',[^;]*?,true,100\)/.test(sql));
  assert.ok(
    /on conflict \(key\) do nothing/.test(sql),
    "re-running must not reset an operator's choice",
  );
});
