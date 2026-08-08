import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  ciDatabase,
  runAssertionScript,
  runIsolationTest,
  describe,
  ASSERTION_FILES,
  CI_DIR,
  policyDropsThatRemovedNothing,
  installedPolicies,
} from "./helpers/rls-harness.mjs";

// ---------------------------------------------------------------------------
// db/ci/ — ~90 adversarial security assertions, EXECUTED.
//
// The entire security model of this application is Postgres row-level security.
// The threat is not the user interface: an attacker ignores the app and calls
// Supabase's PostgREST endpoint /rest/v1/ directly with the public anon key. The
// only thing between a competitor and every customer record is whether the
// policy refuses the query.
//
// db/ci/ was written to prove exactly that, against a GitHub Actions job
// standing up postgres:16 — and NOT ONE OF ITS ASSERTIONS HAD EVER RUN. There
// was no Postgres, no Docker and no psql on the authoring machine, so they were
// "verified" by reading them. This file is where they finally execute, on every
// commit, under `npm run verify`.
//
// The first real run found three of them failing. See
// db/ci/20_privilege_assertions.sql for what that meant: they were pointed at
// public.accept_invitation(), which migration 034 had deliberately reduced to a
// stub, while the function that actually grants organisation membership —
// accept_invitation(text) — had never been asserted against at all.
//
// WHAT THIS DOES NOT PROVE. PGlite is Postgres, not Supabase. auth.uid(),
// auth.users and storage.objects are shims (db/ci/00_supabase_shim.sql), so
// nothing here proves that Supabase's own GoTrue issues the claims these
// policies read, nor that Supabase Storage enforces the storage.objects
// policies. Those still need a real project — docs/E2E-REQUIREMENTS.md.
// ---------------------------------------------------------------------------

// db/ci/run.sh enforces the same floor for the same reason: a suite that
// silently stopped running would otherwise go green while proving nothing.
// Raise both together whenever assertions are added.
const MIN_ASSERTIONS = 110;

test("db/016_isolation_tests.sql passes against a real database", async () => {
  // Cross-tenant composite foreign keys and the org-guard triggers. It raises
  // on failure. Nothing had ever executed it either; it was a file the owner
  // was told to paste into the Supabase SQL editor.
  const { db } = await ciDatabase();
  await runIsolationTest(db);
});

test("every assertion in db/ci/ executes, and passes", async () => {
  const { db, fixtures } = await ciDatabase();

  // The fixtures are not decoration. They assert that impersonation really took
  // effect and that RLS is really enforced for the impersonated role. If those
  // fail, every "CANNOT" assertion below is meaningless theatre.
  assert.equal(
    fixtures.filter((r) => !r.ok).length,
    0,
    `the fixtures could not establish a trustworthy starting state, so nothing below means anything:\n${describe(fixtures)}`,
  );

  const results = [...fixtures];
  for (const file of ASSERTION_FILES) {
    results.push(...(await runAssertionScript(db, path.join(CI_DIR, file))));
  }

  const failed = results.filter((r) => !r.ok);
  const laundered = results.filter((r) => r.ok && r.afterFailure);
  assert.deepEqual(
    failed.map((r) => `${r.file}:${r.line} ${r.label}`),
    [],
    `RLS assertions FAILED against a real Postgres:\n${describe(failed)}\n` +
      (laundered.length
        ? `\n  ${laundered.length} later assertion(s) reported ok, but ran after a failure was rolled ` +
          `back and cannot be trusted until the failures above are fixed.`
        : ""),
  );

  assert.ok(
    results.length >= MIN_ASSERTIONS,
    `only ${results.length} assertions ran, expected at least ${MIN_ASSERTIONS} — assertions were skipped`,
  );
});

// ---------------------------------------------------------------------------
// The defect class that hid in migration 023 for the whole life of the branch.
//
// PERMISSIVE policies are OR'd: a narrow policy sitting beside a broad one
// restricts nothing. So replacing a policy set means DROPPING the old one — and
// `drop policy if exists` on a name that does not exist is a silent no-op that
// leaves the original in force. Migration 023 §4 dropped
// job_time_entries_select/_write/_rw; migration 009 had created them as
// time_entries_select and time_entries_write. The old org-only pair survived and
// kept granting exactly what the new pair was written to deny.
//
// tests/policy-replacement.test.mjs guards this by reading the SQL text.
// Reading the text is how the bug survived. This asks the CATALOGUE, at the
// exact point in the sequence each drop runs.
// ---------------------------------------------------------------------------
test("no migration drops a policy that does not exist", async () => {
  const findings = [];
  const { db } = await ciDatabase({
    beforeEach: async (file, sql, database) => {
      findings.push(...policyDropsThatRemovedNothing(file, sql, await installedPolicies(database)));
    },
  });
  assert.ok(db, "the migrations did not apply, so nothing was scanned");

  // Two exclusions, both principled rather than an allow-list:
  //   * the table is created by the same file, so nothing could pre-exist;
  //   * another drop on the same table in the same file DID hit a real policy,
  //     so the file demonstrably replaced that table's policy set and the
  //     unmatched name is belt-and-braces (this is db/023 §4's extra
  //     `job_time_entries_rw`, added on purpose by ledger 1.18).
  // Both are proved to still leave the real defect visible in
  // tests/rls-assertions-can-fail.test.mjs.
  const real = findings.filter((f) => !f.tableCreatedInSameFile && !f.siblingDropRemovedSomething);

  assert.deepEqual(
    real.map((f) => `${f.file}: drop policy ${f.name} on ${f.table}`),
    [],
    "these drop a policy name nothing ever created, so they removed NOTHING and any broader policy " +
      "that was supposed to be replaced is still in force and still OR'd with the new one:\n  " +
      real.map((f) => `${f.file}: drop policy ${f.name} on ${f.table}`).join("\n  "),
  );
});

test("every policy on a tenant table constrains the tenant", async () => {
  const { db } = await ciDatabase();
  const { rows } = await db.query(`
    select p.tablename, p.policyname, p.cmd,
           coalesce(p.qual, '')::text as qual, coalesce(p.with_check, '')::text as with_check
    from pg_policies p
    where p.schemaname = 'public'
      and p.permissive = 'PERMISSIVE'
      and exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = p.tablename
          and c.column_name = 'organization_id')
    order by p.tablename, p.policyname
  `);

  const scoped = (expr) => /organization_id|current_org_id/i.test(expr);
  const offenders = rows.filter((r) => {
    const parts = [r.qual, r.with_check].filter((e) => e !== "");
    if (parts.length === 0) return true;
    // `id = auth.uid()` / `profile_id = auth.uid()` is STRICTER than tenant
    // scoping — a single row, of a single person — so it is not an escape.
    return !parts.every((e) => scoped(e) || /\bfalse\b/.test(e) || /auth\.uid\(\)/.test(e));
  });

  assert.deepEqual(
    offenders.map((r) => `${r.tablename}.${r.policyname}`),
    [],
    "these policies sit on a table that HAS an organization_id and never mention it, so they are " +
      "OR'd with the correct policies and hand the row to any authenticated user of any business:\n  " +
      offenders
        .map(
          (r) =>
            `${r.tablename}.${r.policyname} [${r.cmd}]\n      using: ${r.qual}\n      check: ${r.with_check}`,
        )
        .join("\n  "),
  );
});
