// Execute db/ci/*.sql — the adversarial RLS assertions — against a real Postgres.
//
// WHY THIS EXISTS
// ---------------
// db/ci/ contains ~85 assertions that impersonate a technician, an office user,
// an owner, an owner of a DIFFERENT tenant, and anon, and check that the
// database refuses the attack while still permitting the legitimate equivalent.
// They were written against a GitHub Actions job that stood up postgres:16, and
// they had NEVER BEEN EXECUTED — not once, by anyone. They were "verified" by
// reading them.
//
// An unexecuted security assertion is worth approximately nothing. The whole
// security model of this application is Postgres row-level security: the threat
// is not the UI, it is somebody calling PostgREST at /rest/v1/ with the public
// anon key. Whether the policy refuses that query is a property of the running
// database and of nothing else.
//
// PGlite is Postgres compiled to WebAssembly, so the assertions can now run
// locally on every commit instead of waiting for CI that never ran either. This
// module is the runner; tests/rls-assertions.test.mjs is the caller.
//
// WHAT IS DELIBERATELY THE SAME AS run.sh
//   * the SQL executed is db/ci/*.sql verbatim — there is no ported copy that
//     could drift from the file CI runs
//   * db/ci/00_supabase_shim.sql, not the smaller shim in pg.mjs, because only
//     it issues the Supabase `alter default privileges ... to anon`, and without
//     that grant migration 023's revoke-from-anon is a no-op that proves nothing
//   * the assertion-count floor, so a suite that silently stops running cannot
//     go green
//
// WHAT IS DELIBERATELY DIFFERENT
//   run.sh uses psql -v ON_ERROR_STOP=1, so the first failing assertion aborts
//   the file and every later one is never evaluated. Here each assertion runs
//   inside its own SAVEPOINT and a failure is recorded rather than fatal, so one
//   run reports every broken policy instead of the first.
//
//   That has a cost which must not be swept under the carpet: rolling back to
//   the savepoint UNDOES whatever the failing assertion's statement did. If a
//   cross-tenant UPDATE ever succeeds, the assertion that catches it fails, the
//   rollback erases the damage, and the later "tenant B survived every attempt"
//   assertion would then pass — a green tick laundering a real breach. So every
//   result recorded after the first failure in a file is flagged `afterFailure`,
//   and the caller reports those as unreliable rather than as passes.

import { readFileSync } from "node:fs";
import path from "node:path";
import { freshDatabase, DB_DIR } from "./pg.mjs";
import { splitStatements, assertionLabel } from "./sql-statements.mjs";

export const CI_DIR = path.join(DB_DIR, "ci");

/** db/016_isolation_tests.sql is a test, not a migration. */
export const ISOLATION_TEST = "016_isolation_tests.sql";

const read = (p) => readFileSync(p, "utf8");
const firstLine = (e) => String(e?.message ?? e).split("\n")[0];

/** The leading keyword of a statement, comments ignored. */
function head(statement) {
  return statement
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Shim + baseline + every migration except the isolation test + fixtures.
 *
 * Returns { db, applied, fixtures } where `fixtures` is the assertion results of
 * 10_fixtures.sql — which is not decoration: it asserts that impersonation
 * really took effect and that RLS is really enforced for the impersonated role.
 * If those fail, every "CANNOT" assertion in the suite is meaningless.
 */
export async function ciDatabase(options = {}) {
  const { db, applied } = await freshDatabase({
    ...options,
    shim: read(path.join(CI_DIR, "00_supabase_shim.sql")),
    skip: [ISOLATION_TEST],
  });
  const fixtures = await runAssertionScript(db, path.join(CI_DIR, "10_fixtures.sql"));
  return { db, applied, fixtures };
}

/**
 * Run one assertion script, one statement at a time.
 *
 * Non-assertion statements are plumbing (BEGIN, SET ROLE, fixture INSERTs). A
 * failure there is not a security finding, it is a broken harness, so it throws
 * rather than being counted as a failed assertion — a suite that quietly
 * recorded "the fixture insert failed" as one red among 85 would be reporting
 * the wrong thing entirely.
 */
export async function runAssertionScript(db, absPath) {
  const statements = splitStatements(read(absPath));
  const file = path.basename(absPath);
  const results = [];
  let inTransaction = false;
  let failed = false;

  for (const statement of statements) {
    const label = assertionLabel(statement.text);

    if (label === null) {
      const kw = head(statement.text);
      try {
        await db.exec(statement.text);
      } catch (error) {
        throw new Error(
          `${file}:${statement.line} — harness statement failed, so the assertions after it never ran:\n` +
            `  ${firstLine(error)}\n  statement: ${statement.text.slice(0, 200)}`,
        );
      }
      if (/^(begin|start\s+transaction)\b/.test(kw)) inTransaction = true;
      else if (/^(commit|end|rollback)\b/.test(kw) && !/^rollback\s+to\b/.test(kw))
        inTransaction = false;
      continue;
    }

    if (inTransaction) await db.exec("savepoint __ci_assert;");
    try {
      await db.exec(statement.text);
      results.push({ file, line: statement.line, label, ok: true, afterFailure: failed });
      if (inTransaction) await db.exec("release savepoint __ci_assert;");
    } catch (error) {
      results.push({
        file,
        line: statement.line,
        label,
        ok: false,
        afterFailure: failed,
        error: firstLine(error).replace(/^ASSERTION FAILED: /, ""),
      });
      failed = true;
      if (inTransaction) await db.exec("rollback to savepoint __ci_assert;");
    }
  }
  return results;
}

/** The three adversarial files, in the order run.sh runs them. */
export const ASSERTION_FILES = [
  "20_privilege_assertions.sql",
  "30_tenant_assertions.sql",
  "40_document_assertions.sql",
];

/** Run all of them against one database and return the flat result list. */
export async function runAllAssertions(db) {
  const results = [];
  for (const file of ASSERTION_FILES) {
    results.push(...(await runAssertionScript(db, path.join(CI_DIR, file))));
  }
  return results;
}

/** Format failures for an assertion message. */
export function describe(results) {
  return results
    .map(
      (r) =>
        `  ${r.ok ? "ok  " : "FAIL"} ${r.file}:${r.line} ${r.label}` +
        (r.ok ? "" : `\n         ${r.error}`),
    )
    .join("\n");
}

/**
 * db/016_isolation_tests.sql — the composite foreign keys and org-guard triggers
 * that stop one tenant's row from referencing another's. It raises on failure.
 */
export async function runIsolationTest(db) {
  await db.exec(read(path.join(DB_DIR, ISOLATION_TEST)));
}

// ---------------------------------------------------------------------------
// Detecting the migration-023 defect class from the CATALOGUE.
//
// PERMISSIVE policies are OR'd. Replacing a table's policy set therefore means
// dropping the old policies, and `drop policy if exists` on a name that was
// never created is a silent no-op: the migration reads as a tightening and
// tightens nothing, because the broad policy it meant to remove is still there,
// still permissive, still OR'd with the narrow replacement.
//
// That is not hypothetical. Migration 023 §4 dropped job_time_entries_select
// and job_time_entries_write; migration 009 had created them as
// time_entries_select and time_entries_write, so both survived and a technician
// could still read and rewrite a colleague's timesheet — with the "fix" applied
// and every static check passing.
// ---------------------------------------------------------------------------

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const bare = (t) =>
  t
    .replace(/^public\./i, "")
    .replace(/"/g, "")
    .toLowerCase();

/** `{ table, name }` for every policy this SQL drops, and every one it creates. */
export function policyStatements(sql) {
  const text = strip(sql);
  const drops = [
    ...text.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?"?([\w-]+)"?\s+on\s+([\w."]+)/gi),
  ].map((m) => ({ name: m[1].toLowerCase(), table: bare(m[2]) }));
  const creates = [...text.matchAll(/create\s+policy\s+"?([\w-]+)"?\s+on\s+([\w."]+)/gi)].map(
    (m) => ({ name: m[1].toLowerCase(), table: bare(m[2]) }),
  );
  return { drops, creates, text };
}

/** Every policy currently installed, as `table.policyname`, plus its command. */
export async function installedPolicies(db) {
  const { rows } = await db.query(
    `select tablename, policyname, cmd from pg_policies where schemaname = 'public'`,
  );
  return new Map(
    rows.map((r) => [`${r.tablename.toLowerCase()}.${r.policyname.toLowerCase()}`, r.cmd]),
  );
}

/**
 * The drops in `sql` that removed nothing, given the policies installed at the
 * moment it runs.
 *
 * Two shapes are excluded, both principled rather than an allow-list:
 *
 *   * a name the same file goes on to CREATE — `drop policy if exists x; create
 *     policy x` is the standard idempotency idiom and its drop is expected to
 *     hit nothing on a first run;
 *   * a policy on a table the same file CREATES, where nothing could pre-exist.
 *
 * What is left is a drop that names a policy nothing ever created on a table
 * that already existed — which is the 023 signature exactly.
 */
export function policyDropsThatRemovedNothing(file, sql, installed) {
  const { drops, creates, text } = policyStatements(sql);
  const created = new Set(creates.map((c) => `${c.table}.${c.name}`));
  const out = [];
  for (const d of drops) {
    const key = `${d.table}.${d.name}`;
    if (installed.has(key)) continue;
    if (created.has(key)) continue;
    out.push({
      file,
      ...d,
      tableCreatedInSameFile: new RegExp(`create\\s+table[^;]*\\b${d.table}\\b`, "i").test(text),
      // The migration demonstrably replaced this table's policy set — at least
      // one of its other drops on the same table hit a real policy — so the
      // unmatched name is belt-and-braces rather than a missed rename.
      siblingDropRemovedSomething: drops.some(
        (o) => o.table === d.table && o.name !== d.name && installed.has(`${o.table}.${o.name}`),
      ),
    });
  }
  return out;
}

// A NOTE ON THE OTHER HALF OF THIS DEFECT CLASS, and why there is no automated
// check for it here.
//
// The scan above finds drops that hit nothing. It cannot find the case where a
// migration installs a narrow policy set on a table and an OLDER, BROADER policy
// simply survives beside it under a name the migration never mentioned.
//
// That scan was written, run against every migration, and deliberately not
// shipped. It reports 8 survivors, and all 8 are legitimate: profiles_owner_write
// beside profiles_self_update, technician_locations_manage (owner/office) beside
// technician_locations_self (own rows), technician_consent_own beside
// technician_location_consents_self, and the drop-then-recreate of a policy under
// its own name. Deciding which of those is a hole requires comparing two
// arbitrary SQL predicates for strength, which cannot be done reliably — so the
// check could only ship with an allow-list, and a check that must be silenced to
// stay green is the exact failure mode this file exists to prevent.
//
// What replaced it is behavioural and lives in db/ci/30_tenant_assertions.sql:
// the tables that scan flagged now have real adversarial assertions run against
// real rows, which answer the question the predicates could not.
