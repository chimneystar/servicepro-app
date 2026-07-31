import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { stripSqlComments } from "./helpers/sql.mjs";

// ---------------------------------------------------------------------------
// THE BUG THIS EXISTS FOR
//
// PostgreSQL RLS policies are PERMISSIVE by default and are OR'd together. So
// adding a narrower policy beside a broader one restricts NOTHING — access is
// granted if ANY policy allows it.
//
// Migration 023 tightened job_time_entries so a technician could only see their
// own timesheet. It dropped `job_time_entries_select` / `_write` / `_rw` — but
// the policies actually created by migration 009 are named `time_entries_select`
// and `time_entries_write`. Those survived, kept granting org-wide access, and
// were OR'd with the new narrow pair. The migration LOOKED like it fixed the
// finding and changed nothing at all.
//
// A "drop policy if exists" that names something which was never created is
// silent — no error, no warning. Nothing else in the toolchain catches it.
// ---------------------------------------------------------------------------

const DB = new URL("../db/", import.meta.url);
const files = readdirSync(DB).filter((f) => f.endsWith(".sql") && f !== "GO-LIVE.sql").sort();
const read = (f) => stripSqlComments(readFileSync(new URL(f, DB), "utf8"));

const clean = (name) => name.toLowerCase().replace(/^public\./, "").replace(/"/g, "");

/** Literal `create policy <name> on <table>` occurrences, per file. */
function policiesCreatedIn(sql) {
  return [...sql.matchAll(/create\s+policy\s+([a-z0-9_]+)\s+on\s+([a-z0-9_."]+)/gi)]
    .map((m) => ({ policy: m[1].toLowerCase(), table: clean(m[2]) }));
}

/** Literal `drop policy if exists <name> on <table>` occurrences, per file. */
function policiesDroppedIn(sql) {
  return [...sql.matchAll(/drop\s+policy\s+if\s+exists\s+([a-z0-9_]+)\s+on\s+([a-z0-9_."]+)/gi)]
    .map((m) => ({ policy: m[1].toLowerCase(), table: clean(m[2]) }));
}

/**
 * Tables whose policy set a later migration REPLACES rather than extends.
 *
 * Kept as an explicit list because coexisting policies are sometimes correct:
 * migration 023 deliberately adds a narrow `technician_locations_self` alongside
 * the org-wide read so a technician keeps seeing their own history. A blanket
 * rule would flag that as a defect. What must never happen is a migration
 * believing it has REPLACED a policy set when the old, broader one survives.
 */
const REPLACEMENTS = [
  { file: "023_authorization_hardening.sql", table: "job_time_entries" },
  { file: "023_authorization_hardening.sql", table: "profiles" },
  { file: "023_authorization_hardening.sql", table: "jobs" },
  { file: "023_authorization_hardening.sql", table: "invitations" },
];

test("a migration that replaces a table's policies drops the ones that exist", () => {
  const problems = [];

  for (const { file, table } of REPLACEMENTS) {
    const index = files.indexOf(file);
    assert.notEqual(index, -1, `${file} is missing`);

    // Everything created on this table by an EARLIER migration.
    const priorNames = new Set();
    for (const earlier of files.slice(0, index)) {
      for (const { policy, table: t } of policiesCreatedIn(read(earlier))) {
        if (t === table) priorNames.add(policy);
      }
    }

    const droppedHere = new Set(policiesDroppedIn(read(file)).filter((d) => d.table === table).map((d) => d.policy));
    for (const name of priorNames) {
      if (!droppedHere.has(name)) {
        problems.push(`${file} tightens ${table} but never drops the pre-existing policy "${name}" — it survives and is OR'd with the new one, so nothing is actually restricted`);
      }
    }
  }

  assert.deepEqual(problems, [], `\n  ${problems.join("\n  ")}\n`);
});

test("the detector catches the exact regression it was written for", () => {
  // Both-ways proof: fed the ORIGINAL broken state, it must report a problem.
  const before = `drop policy if exists job_time_entries_select on public.job_time_entries;
                  create policy job_time_entries_select on public.job_time_entries for select using (true);`;
  const earlier = `create policy time_entries_select on public.job_time_entries for select using (true);`;

  const prior = policiesCreatedIn(earlier).filter((p) => p.table === "job_time_entries").map((p) => p.policy);
  const dropped = policiesDroppedIn(before).filter((d) => d.table === "job_time_entries").map((d) => d.policy);

  assert.ok(prior.includes("time_entries_select"));
  assert.ok(!dropped.includes("time_entries_select"),
    "the broken migration did not drop the real policy — which is precisely the bug");
});

test("every literal drop names a policy that is actually created somewhere", () => {
  // A drop naming a policy that never existed is a no-op, and usually means the
  // author guessed the name. Dynamic loops (`create policy %I`) and deliberate
  // removals with no replacement are the legitimate exceptions.
  const createdAnywhere = new Set();
  const dynamicTables = new Set();
  for (const file of files) {
    const sql = read(file);
    for (const { policy, table } of policiesCreatedIn(sql)) createdAnywhere.add(`${policy}|${table}`);
    // Loops build names like `%1$s_rw`, so record the table as dynamically managed.
    for (const block of sql.matchAll(/\bdo\s*\$\$([\s\S]*?)\$\$/gi)) {
      if (!/create\s+policy/i.test(block[1])) continue;
      for (const lit of block[1].matchAll(/'([a-z0-9_]+)'/gi)) dynamicTables.add(lit[1].toLowerCase());
    }
  }

  // Deliberate removals: a policy intentionally dropped and not replaced.
  const INTENTIONAL_REMOVALS = new Set([
    "manual_payments_update|manual_payment_submissions", // 017 removes client updates on purpose
  ]);

  const orphans = [];
  for (const file of files) {
    for (const { policy, table } of policiesDroppedIn(read(file))) {
      const key = `${policy}|${table}`;
      if (createdAnywhere.has(key)) continue;
      if (dynamicTables.has(table)) continue;      // created by a loop
      if (INTENTIONAL_REMOVALS.has(key)) continue;
      if (file.startsWith("023") && policy.endsWith("_rw")) continue; // defensive re-run drops
      orphans.push(`${file}: drop policy ${policy} on ${table} — no such policy is ever created`);
    }
  }

  assert.deepEqual(orphans, [], `\n  ${orphans.join("\n  ")}\n`);
});
