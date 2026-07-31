import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { freshDatabase, migrationFiles, isolationTestSql, DB_DIR } from "./helpers/pg.mjs";

// ---------------------------------------------------------------------------
// Can the database be built from scratch?
//
// Before this file the answer was unknown, and it was NO. The 41 migrations had
// only ever been applied by hand, one at a time, to a database that already had
// the previous ones — so an ordering error inside a single file was invisible.
//
// db/030_refunds.sql contained two, and the second was hidden behind the first:
//
//   1. It added a composite foreign key referencing payments(id, organization_id)
//      and added the unique constraint that makes that legal AFTERWARDS. A
//      composite FK requires the unique key to already exist, so the statement
//      aborted the migration.
//
//   2. Behind it: `create policy ... using (public.can_refund_payments())` was
//      written BEFORE `create function public.can_refund_payments()`. Postgres
//      resolves the expression at CREATE POLICY time.
//
// Either would have failed in the owner's SQL editor. Both were invisible to
// every static check in this repo, because both files are perfectly valid SQL —
// they are only wrong in ORDER, and order is a property you can observe solely
// by running them.
//
// This is Postgres itself (PGlite = Postgres compiled to WASM), not a parser and
// not a linter. It is NOT Supabase: auth and storage are shimmed. See
// tests/helpers/pg.mjs.
// ---------------------------------------------------------------------------

test("every migration applies to a clean database, in order", async () => {
  // freshDatabase throws naming the first file that fails.
  const { applied } = await freshDatabase();
  assert.equal(applied.length, migrationFiles().length,
    "every migration in db/ must apply to an empty database");
});

test("db/016_isolation_tests.sql passes against the fully migrated schema", async () => {
  // 016 is a TEST, not a migration — which is why the numbering has no 016 and
  // why the manifest declares it. It used to be swept into the apply sequence by
  // a `^\d{3}_` glob and executed as if it were DDL; that happened to work, but
  // it meant the sequence and the proof were the same list, and nothing checked
  // that it still passed once the later migrations had added their constraints.
  //
  // It raises `ISOLATION FAIL: ...` on any cross-tenant leak and cleans up after
  // itself, so running it here is the proof, not a smoke test.
  const { db } = await freshDatabase();
  await db.exec(isolationTestSql());

  // A test that silently did nothing must not be mistaken for one that passed.
  const { rows } = await db.query(
    "select count(*)::int as leftovers from public.organizations where name like '__ISO_TEST_%'",
  );
  assert.equal(rows[0].leftovers, 0, "016 must clean up its own fixtures, which it only does on success");
});

test("the result is the schema the application expects", async () => {
  const { db } = await freshDatabase();
  const { rows } = await db.query(`
    select
      (select count(*)::int from pg_tables where schemaname = 'public') as tables,
      (select count(*)::int from pg_tables where schemaname = 'public' and rowsecurity) as rls_enabled,
      (select count(*)::int from pg_policies where schemaname = 'public') as policies
  `);
  const { tables, rls_enabled, policies } = rows[0];

  // A floor, not an equality: new migrations should be able to add tables
  // without editing this test. What must never happen is the count going
  // BACKWARDS, or a table appearing without RLS.
  assert.ok(tables >= 120, `expected the full schema, got ${tables} tables`);
  assert.ok(policies >= 200, `expected the full policy set, got ${policies} policies`);
  assert.equal(rls_enabled, tables,
    `${tables - rls_enabled} table(s) in public have no row-level security — with PostgREST, that is a public table`);
});

test("a table that denies everyone does so deliberately, not by omission", async () => {
  // RLS enabled with ZERO policies denies every request. That is a legitimate
  // pattern for platform bookkeeping reached only through the service-role key
  // (secret_key_rotations is exactly this, and says so), and it is also what an
  // accidentally unfinished table looks like. The two are indistinguishable
  // from the policy catalogue alone.
  //
  // What separates them is the GRANT. A table meant to be service-role-only
  // also revokes its privileges from authenticated and anon. A table someone
  // forgot to write policies for still carries the grants that were supposed to
  // make it usable — so the feature is silently broken rather than protected,
  // and it fails at runtime, in production, with an empty result rather than an
  // error.
  const { db } = await freshDatabase();
  const { rows } = await db.query(`
    select t.tablename,
           has_table_privilege('authenticated', 'public.' || quote_ident(t.tablename), 'select') as auth_select,
           has_table_privilege('anon',          'public.' || quote_ident(t.tablename), 'select') as anon_select
    from pg_tables t
    where t.schemaname = 'public'
      and t.rowsecurity
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = t.tablename
      )
    order by t.tablename
  `);
  const accidental = rows.filter((r) => r.auth_select || r.anon_select).map((r) => r.tablename);
  assert.deepEqual(accidental, [],
    "these tables have RLS on, no policy, and still grant access — so every read returns empty " +
    `instead of failing, and the feature using them is quietly dead:\n  ${accidental.join("\n  ")}`);
});

// ---------------------------------------------------------------------------
// The specific defect class, guarded directly.
//
// The tests above would catch a repeat, but only by failing with whatever error
// Postgres happens to raise. These name the two rules, so a future migration
// that breaks them says WHY.
// ---------------------------------------------------------------------------

// Comments are stripped first, and the replacement keeps the byte offsets
// stable so the positions reported below still point at real code.
//
// Without this, the header comment in 030_refunds.sql — which explains the
// can_refund_payments permission in prose — was itself reported as a defect.
// A detector that fires on a comment ABOUT the bug is the same failure this
// whole exercise is about, one level up.
const readMigration = (f) =>
  readFileSync(path.join(DB_DIR, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/--[^\n]*/g, (m) => " ".repeat(m.length));

test("a composite foreign key is never added before the unique key it needs", async () => {
  const offenders = [];
  for (const file of migrationFiles()) {
    const sql = readMigration(file);
    const fk = sql.search(/references\s+public\.(\w+)\s*\(\s*id\s*,\s*organization_id\s*\)/i);
    if (fk < 0) continue;
    const unique = sql.search(/unique\s*\(\s*id\s*,\s*organization_id\s*\)/i);
    // Not in this file at all is fine — an earlier migration supplies it, and
    // the apply test above proves that end to end.
    if (unique >= 0 && unique > fk) offenders.push(file);
  }
  assert.deepEqual(offenders, [],
    `these add a composite FK before the unique key it references, which aborts the migration:\n  ${offenders.join("\n  ")}`);
});

test("a policy never calls a function its own migration defines later", async () => {
  const offenders = [];
  for (const file of migrationFiles()) {
    const sql = readMigration(file);
    for (const created of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(/gi)) {
      const name = created[1];
      const definedAt = created.index;
      // The earliest policy in this file that calls it.
      for (const policy of sql.matchAll(/create\s+policy[\s\S]*?;/gi)) {
        if (policy.index > definedAt) continue;
        if (new RegExp(`public\\.${name}\\s*\\(`, "i").test(policy[0])) {
          offenders.push(`${file}: policy at ${policy.index} calls public.${name}() defined at ${definedAt}`);
          break;
        }
      }
    }
  }
  assert.deepEqual(offenders, [],
    `a policy expression is resolved when the policy is created, so the function must already exist:\n  ${offenders.join("\n  ")}`);
});
