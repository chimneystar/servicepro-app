import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripSqlComments } from "./helpers/sql.mjs";
import {
  normalizeSkillCode,
  normalizeSkillList,
  certificationStatus,
  heldSkillCodes,
  checkSkillMatch,
  matchTechnicians,
  describeSkillGap,
  COMMON_SKILLS,
} from "../lib/core/skills.mjs";

// ---------------------------------------------------------------------------
// 6c.11 — dispatch could not know who is licensed for gas, HVAC or electrical
// work, which in most jurisdictions is a legal condition of doing the job.
// ---------------------------------------------------------------------------

test("skill codes are folded so one certification cannot become three", () => {
  assert.equal(normalizeSkillCode("Gas Safe"), "gas_safe");
  assert.equal(normalizeSkillCode("  gas-safe "), "gas_safe");
  assert.equal(normalizeSkillCode("GAS__SAFE"), "gas_safe");
  assert.equal(normalizeSkillCode("EPA 608"), "epa_608");
});

test("junk is refused rather than stored as an unmatchable code", () => {
  assert.equal(normalizeSkillCode("!"), null);
  assert.equal(normalizeSkillCode(""), null);
  assert.equal(normalizeSkillCode("x"), null); // one character
  assert.equal(normalizeSkillCode("a".repeat(41)), null); // over the DB check
});

test("a list is deduplicated and ordered, whatever it arrives as", () => {
  assert.deepEqual(normalizeSkillList("HVAC, gas , hvac"), ["gas", "hvac"]);
  assert.deepEqual(normalizeSkillList(["Gas", "!!", "gas"]), ["gas"]);
  assert.deepEqual(normalizeSkillList(""), []);
  assert.deepEqual(normalizeSkillList(null), []);
});

test("a certification with no expiry never lapses", () => {
  assert.equal(certificationStatus({ skill_code: "gas" }, "2030-01-01"), "valid");
});

test("an EXPIRED certification is expired, not merely a warning", () => {
  assert.equal(certificationStatus({ expires_on: "2026-06-30" }, "2026-07-01"), "expired");
  assert.equal(certificationStatus({ expires_on: "2026-07-01" }, "2026-07-01"), "expiring");
  assert.equal(certificationStatus({ expires_on: "2027-07-01" }, "2026-07-01"), "valid");
});

test("a certification issued after the job is not yet held", () => {
  assert.equal(certificationStatus({ issued_on: "2026-08-01" }, "2026-07-01"), "future");
});

test("an expired ticket is treated as NOT HELD", () => {
  const skills = [{ skill_code: "gas", expires_on: "2026-06-30" }];
  assert.deepEqual(heldSkillCodes(skills, "2026-07-01"), []);
  assert.deepEqual(heldSkillCodes(skills, "2026-06-01"), ["gas"]);
});

test("no requirement means anybody may take the job", () => {
  // The column default is '{}', so nothing that works today starts failing.
  assert.deepEqual(checkSkillMatch({ required: [], skills: [], onDate: "2026-07-01" }), {
    ok: true,
    missing: [],
    expired: [],
  });
  assert.equal(checkSkillMatch({ required: null, skills: [], onDate: "2026-07-01" }).ok, true);
});

test("a gas job is refused to somebody with no gas ticket", () => {
  const result = checkSkillMatch({
    required: ["gas"],
    skills: [{ skill_code: "hvac" }],
    onDate: "2026-07-01",
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["gas"]);
  assert.deepEqual(result.expired, []);
});

test("a LAPSED ticket is reported as expired and still refuses", () => {
  const result = checkSkillMatch({
    required: ["gas"],
    skills: [{ skill_code: "gas", expires_on: "2026-01-01" }],
    onDate: "2026-07-01",
  });
  assert.equal(result.ok, false, "an expired licence is as illegal as none");
  assert.deepEqual(result.expired, ["gas"]);
  assert.deepEqual(result.missing, []);
});

test("a certified technician is accepted — proven the other way", () => {
  const result = checkSkillMatch({
    required: ["gas", "HVAC"],
    skills: [{ skill_code: "gas", expires_on: "2027-01-01" }, { skill_code: "hvac" }],
    onDate: "2026-07-01",
  });
  assert.deepEqual(result, { ok: true, missing: [], expired: [] });
});

test("matching splits a team into qualified and unqualified with reasons", () => {
  const { qualified, unqualified } = matchTechnicians({
    required: ["gas"],
    technicians: [
      { id: "a", name: "Ada", skills: [{ skill_code: "gas" }] },
      { id: "b", name: "Ben", skills: [] },
      { id: "c", name: "Cal", skills: [{ skill_code: "gas", expires_on: "2020-01-01" }] },
    ],
    onDate: "2026-07-01",
  });
  assert.deepEqual(
    qualified.map((row) => row.id),
    ["a"],
  );
  assert.deepEqual(
    unqualified.map((row) => row.id),
    ["b", "c"],
  );
  assert.deepEqual(unqualified[1].expired, ["gas"]);
});

test("the refusal names the certification and what to do", () => {
  const missing = describeSkillGap(
    checkSkillMatch({ required: ["gas"], skills: [], onDate: "2026-07-01" }),
    { name: "Ben" },
  );
  assert.match(missing, /Ben/);
  assert.match(missing, /gas/);
  const lapsed = describeSkillGap(
    checkSkillMatch({
      required: ["gas"],
      skills: [{ skill_code: "gas", expires_on: "2020-01-01" }],
      onDate: "2026-07-01",
    }),
    { name: "Cal" },
  );
  assert.match(lapsed, /EXPIRED/);
  assert.equal(describeSkillGap({ ok: true }), null);
});

test("every suggested skill code survives its own normaliser", () => {
  for (const skill of COMMON_SKILLS) assert.equal(normalizeSkillCode(skill.code), skill.code);
});

// ---------------------------------------------------------------------------
// Structural. Comments stripped first.
// ---------------------------------------------------------------------------
const migration = stripSqlComments(
  readFileSync(new URL("../db/039_scheduling_sales.sql", import.meta.url), "utf8"),
);
const guard = stripSqlComments(
  readFileSync(new URL("../app/(app)/dispatch/assignment-guard.ts", import.meta.url), "utf8"),
);
const dispatchActions = stripSqlComments(
  readFileSync(new URL("../app/(app)/dispatch/actions.ts", import.meta.url), "utf8"),
);
const scheduleActions = stripSqlComments(
  readFileSync(new URL("../app/(app)/schedule/actions.ts", import.meta.url), "utf8"),
);

test("skills are a table with a machine key the database also constrains", () => {
  assert.match(migration, /create table if not exists public\.technician_skills/);
  assert.match(
    migration,
    /skill_code\s+text not null check \(skill_code ~ '\^\[a-z0-9_\]\{2,40\}\$'\)/,
  );
  assert.match(migration, /unique \(organization_id, profile_id, skill_code\)/);
  assert.match(migration, /revoke all on public\.technician_skills from anon/);
});

test("a licence number is management information, not org-wide reading", () => {
  const policy = /create policy technician_skills_select[\s\S]*?;/.exec(migration);
  assert.ok(policy);
  assert.match(
    policy[0],
    /current_user_role\(\) in \('owner','office'\) or profile_id = auth\.uid\(\)/,
  );
});

test("jobs carry their requirement, defaulting to no restriction", () => {
  assert.match(
    migration,
    /alter table public\.jobs add column if not exists required_skills text\[\] not null default '\{\}'/,
  );
});

test("BOTH assignment paths run the certification check", () => {
  assert.match(guard, /checkSkillMatch/);
  assert.match(dispatchActions, /assertAssignableToJob/);
  // Lead and crew: 028 had to close exactly this gap for double-booking.
  const move = /export async function moveDispatchJob[\s\S]*?\n}/.exec(dispatchActions);
  const add = /export async function addJobTechnician[\s\S]*?\n}/.exec(dispatchActions);
  assert.match(move[0], /assertAssignableToJob/);
  assert.match(add[0], /assertAssignableToJob/);
  assert.match(scheduleActions, /assertAssignable\(/);
});
