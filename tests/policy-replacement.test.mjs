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

/**
 * The command a policy applies to. Omitted means ALL.
 *
 * THIS MATTERS, and its absence used to make this detector wrong. PostgreSQL
 * OR's permissive policies only WITHIN the command being executed: a FOR SELECT
 * policy cannot authorise an UPDATE. A command-blind comparison reports a
 * surviving `jobs_insert` as defeating a new `jobs_update`, which is not a thing
 * that can happen — and a detector that cries wolf is one somebody deletes.
 */
function commandOf(tail) {
  const m = /^\s*(?:as\s+(?:permissive|restrictive)\s+)?for\s+(all|select|insert|update|delete)\b/i.exec(tail);
  return m ? m[1].toLowerCase() : "all";
}

/** Do two policies ever apply to the same statement? */
const commandsIntersect = (a, b) => a === b || a === "all" || b === "all";

/**
 * `create policy <name> on <table> ... for <cmd>`, per file — literal statements
 * AND `format()` loops.
 *
 * The loops are not optional. `db/001_schema.sql` creates `invitations_rw` inside
 * a `foreach tbl in array array['subscriptions','payments','invitations']` loop,
 * so a literal-only scan finds NO prior policy on `invitations` and the
 * assertion for that table passed while comparing an empty set against an empty
 * set. A guard that passes vacuously is the same failure it was written to catch.
 */
function policiesCreatedIn(sql) {
  const out = [...sql.matchAll(/create\s+policy\s+([a-z0-9_]+)\s+on\s+([a-z0-9_."]+)([\s\S]{0,80})/gi)]
    .map((m) => ({ policy: m[1].toLowerCase(), table: clean(m[2]), cmd: commandOf(m[3]) }));
  out.push(...dynamicPolicies(sql, /create\s+policy\s+%1\$s_([a-z0-9_]+)\s+on\s+public\.%1\$I([\s\S]{0,60})/i));
  return out;
}

/** `drop policy if exists <name> on <table>`, per file — literal AND loops. */
function policiesDroppedIn(sql) {
  const out = [...sql.matchAll(/drop\s+policy\s+if\s+exists\s+([a-z0-9_]+)\s+on\s+([a-z0-9_."]+)/gi)]
    .map((m) => ({ policy: m[1].toLowerCase(), table: clean(m[2]), cmd: "all" }));
  out.push(...dynamicPolicies(sql, /drop\s+policy\s+if\s+exists\s+%1\$s_([a-z0-9_]+)\s+on\s+public\.%1\$I([\s\S]{0,4})/i));
  return out;
}

/** Expand `format('... %1$s_<suffix> ... %1$I ...', tbl)` inside a DO loop. */
function dynamicPolicies(sql, template) {
  const found = [];
  for (const block of sql.matchAll(/\bdo\s*\$\$([\s\S]*?)\$\$/gi)) {
    const body = block[1];
    const m = template.exec(body);
    if (!m) continue;
    const suffix = m[1].toLowerCase();
    const cmd = commandOf(m[2] ?? "");
    for (const arr of body.matchAll(/array\s*\[([\s\S]*?)\]/gi)) {
      for (const lit of arr[1].matchAll(/'([a-z0-9_]+)'/gi)) {
        found.push({ policy: `${lit[1].toLowerCase()}_${suffix}`, table: lit[1].toLowerCase(), cmd });
      }
    }
  }
  return found;
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

/**
 * Survivors that are deliberately kept, each with the reason.
 *
 * An exception with a reason, not a deleted assertion: everything NOT listed
 * here is still checked, so a future migration that leaves a different policy
 * standing still fires.
 */
const KEPT = [
  {
    file: "023_authorization_hardening.sql",
    table: "profiles",
    policy: "profiles_owner_write",
    why:
      "FOR ALL, so it does intersect 023's new FOR UPDATE policy — but both its USING and its " +
      "WITH CHECK require public.current_user_role() = 'owner' (db/001_schema.sql:485-487). A " +
      "technician or office user fails it outright and can only reach profiles_self_update, whose " +
      "WITH CHECK pins role/active/commission_pct. An owner passing through it CAN change roles, " +
      "which is exactly 023's intent — its own privilege trigger short-circuits for owners " +
      "(023:55) and protect_last_owner still applies.",
  },
];

test("a migration that replaces a table's policies drops the ones that exist", () => {
  const problems = [];

  for (const { file, table } of REPLACEMENTS) {
    const index = files.indexOf(file);
    assert.notEqual(index, -1, `${file} is missing`);

    // Everything created on this table by an EARLIER migration.
    //
    // "Earlier" is filename order, which is only the same as APPLICATION order
    // because the baseline was renamed schema.sql -> 001_schema.sql. While it
    // was called schema.sql it sorted AFTER 041_, so every policy the baseline
    // creates was treated as newer than every migration and this loop never saw
    // a single one of them.
    const prior = new Map();
    for (const earlier of files.slice(0, index)) {
      for (const p of policiesCreatedIn(read(earlier))) {
        if (p.table === table) prior.set(p.policy, p);
      }
    }

    const here = policiesCreatedIn(read(file)).filter((p) => p.table === table);
    const droppedHere = new Set(
      policiesDroppedIn(read(file)).filter((d) => d.table === table).map((d) => d.policy),
    );

    for (const [name, survivor] of prior) {
      if (droppedHere.has(name)) continue;
      // Only a policy that can apply to the SAME command as one this migration
      // creates can defeat it. A surviving FOR SELECT policy cannot widen a new
      // FOR UPDATE one.
      const clashes = here.filter((p) => commandsIntersect(p.cmd, survivor.cmd));
      if (!clashes.length) continue;
      if (KEPT.some((k) => k.file === file && k.table === table && k.policy === name)) continue;

      problems.push(
        `${file} tightens ${table} but never drops the pre-existing policy "${name}" ` +
          `(for ${survivor.cmd}) — it survives and is OR'd with ${clashes.map((c) => `"${c.policy}" (for ${c.cmd})`).join(", ")}, ` +
          `so nothing is actually restricted`,
      );
    }
  }

  assert.deepEqual(problems, [], `\n  ${problems.join("\n  ")}\n`);
});

test("the detector is not passing vacuously — it really sees the baseline's policies", () => {
  // The `invitations` row above compared an empty set against an empty set for
  // the life of this file, because `invitations_rw` is created by a format()
  // loop in db/001_schema.sql that the literal-only scan could not see. A guard
  // that passes because it looked at nothing is the failure it exists to catch.
  const baseline = policiesCreatedIn(read("001_schema.sql"));

  const invitations = baseline.filter((p) => p.table === "invitations");
  assert.ok(
    invitations.some((p) => p.policy === "invitations_rw" && p.cmd === "all"),
    "the loop-created invitations_rw must be visible, or the invitations assertion proves nothing",
  );
  assert.ok(
    policiesDroppedIn(read("023_authorization_hardening.sql")).some((d) => d.policy === "invitations_rw"),
    "023 must drop it — and this test is what makes that a real check",
  );

  for (const { table } of REPLACEMENTS) {
    assert.ok(
      baseline.concat(files.slice(0, files.indexOf("023_authorization_hardening.sql")).flatMap((f) => policiesCreatedIn(read(f))))
        .some((p) => p.table === table),
      `no prior policy found on ${table} — the assertion for it would be vacuous`,
    );
  }
});

test("commandOf and commandsIntersect model PostgreSQL's actual OR-ing rules", () => {
  // Both ways, on the distinction the detector now turns on.
  assert.equal(commandOf(" for select using (true)"), "select");
  assert.equal(commandOf(" for all using (true)"), "all");
  assert.equal(commandOf(" to authenticated using (true)"), "all", "an omitted FOR means ALL");
  assert.equal(commandOf(" as restrictive for update using (true)"), "update");

  assert.equal(commandsIntersect("select", "update"), false, "a SELECT policy cannot authorise an UPDATE");
  assert.equal(commandsIntersect("insert", "update"), false);
  assert.equal(commandsIntersect("update", "update"), true);
  assert.equal(commandsIntersect("all", "update"), true, "FOR ALL applies to every command");
  assert.equal(commandsIntersect("select", "all"), true);
});

test("PLANTED DEFECT: a surviving same-command policy is still caught", () => {
  // The detector was made command-aware to stop four false positives. Prove it
  // did not become blind in the process: the real regression class must still
  // fire.
  const earlier = "create policy time_entries_write on public.job_time_entries for all using (true);";
  const later = "create policy job_time_entries_write on public.job_time_entries for all using (false);";

  const prior = policiesCreatedIn(earlier).find((p) => p.table === "job_time_entries");
  const created = policiesCreatedIn(later).find((p) => p.table === "job_time_entries");
  const dropped = policiesDroppedIn(later).map((d) => d.policy);

  assert.equal(commandsIntersect(prior.cmd, created.cmd), true, "both are FOR ALL — they are OR'd");
  assert.ok(!dropped.includes(prior.policy), "the old policy survives, which is the defect");

  // ...and the mirror image: a surviving policy on a different command is not.
  const selectOnly = policiesCreatedIn(
    "create policy jobs_select on public.jobs for select using (true);",
  ).find((p) => p.table === "jobs");
  const updateOnly = policiesCreatedIn(
    "create policy jobs_update on public.jobs for update using (true);",
  ).find((p) => p.table === "jobs");
  assert.equal(commandsIntersect(selectOnly.cmd, updateOnly.cmd), false);
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
