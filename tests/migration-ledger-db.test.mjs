import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  LEDGER_READ_SQL,
  checksumOf,
  classifyFiles,
  planMigrations,
  recordAdoptedSql,
  recordFinishSql,
  recordStartSql,
  sqlQuote,
} from "../lib/core/migrations.mjs";
import { DB_DIR, freshDatabase, migrationFiles } from "./helpers/pg.mjs";

// ---------------------------------------------------------------------------
// THE GUARDS, AGAINST A REAL POSTGRES.
//
// tests/migration-runner.test.mjs proves the same guards as pure functions over
// hand-built fixtures — fast, and they hold. What they cannot prove is that the
// ledger TABLE exists as written, that its constraints reject what they claim
// to reject, that the SQL the runner emits is SQL Postgres accepts, or that
// rows read back out of the database still trip the guards. Fixtures are what I
// believe a ledger row looks like; these are ledger rows.
//
// PGlite is Postgres compiled to WebAssembly, so `enable row level security`
// really enables RLS and `revoke` really revokes. It is NOT Supabase: auth and
// storage are shimmed (tests/helpers/pg.mjs), so this proves our DDL and our
// logic, not Supabase's own behaviour.
//
// Every guard below is still proven BOTH WAYS: silent on a healthy database,
// firing on a planted defect.
// ---------------------------------------------------------------------------

const LEDGER_SQL = readFileSync(path.join(DB_DIR, "migrations-ledger.sql"), "utf8");
const MANIFEST = JSON.parse(readFileSync(path.join(DB_DIR, "migrations.manifest.json"), "utf8"));

/** EVERY .sql file in db/, not just the migrations — classification needs the lot. */
const ALL_SQL = readdirSync(DB_DIR).filter((f) => f.endsWith(".sql")).sort();

/** The real files on disk, with their real checksums. */
function realMigrations() {
  const { migrations } = classifyFiles(migrationFiles(), MANIFEST.nonMigrations ?? {});
  return migrations.map((m) => ({
    ...m,
    checksum: checksumOf(readFileSync(path.join(DB_DIR, m.filename), "utf8")),
  }));
}

const MIGRATIONS = realMigrations();

// One fully-migrated database with the ledger installed, built on first use and
// shared. Each test clears the ledger first, so they cannot leak into each
// other. (A root-level `before` hook is not applied to top-level tests on the
// Node version this project pins, so the setup is memoised instead of hooked —
// a hook that silently never runs would leave every assertion below testing
// nothing.)
let pending = null;
function database() {
  pending ??= (async () => {
    const { db } = await freshDatabase();
    await db.exec(LEDGER_SQL);
    return db;
  })();
  return pending;
}

async function clearLedger() {
  const db = await database();
  await db.exec("delete from public.schema_migrations;");
  return db;
}

/** Read the ledger back through the runner's own query. */
async function readLedger() {
  const db = await database();
  const { rows } = await db.query(LEDGER_READ_SQL);
  return rows[0].ledger ?? [];
}

/** Plan against the real files plus whatever is in the real ledger. */
async function planAgainstDatabase({ files = MIGRATIONS, ...rest } = {}) {
  return planMigrations({
    files,
    allFilenames: ALL_SQL,
    nonMigrations: MANIFEST.nonMigrations,
    ledger: await readLedger(),
    ...rest,
  });
}

const has = (plan, code) => plan.problems.some((p) => p.code === code);

// ===========================================================================
// The ledger table itself
// ===========================================================================

test("db/migrations-ledger.sql applies to a real database, and is idempotent", async () => {
  // The file is applied by the runner before EVERY run, so re-running it must
  // be a no-op rather than an error.
  const db = await database();
  await db.exec(LEDGER_SQL);
  await db.exec(LEDGER_SQL);
  const { rows } = await db.query(
    "select count(*)::int as n from information_schema.tables " +
      "where table_schema = 'public' and table_name = 'schema_migrations'",
  );
  assert.equal(rows[0].n, 1);
});

test("the ledger REJECTS a malformed version, and ACCEPTS a well-formed one", async () => {
  const db = await clearLedger();

  // Fires: identity is a three-digit version, and a row that is not one would
  // never match a file and could never be reconciled.
  await assert.rejects(
    () =>
      db.exec(
        `insert into public.schema_migrations (version, name, filename, checksum) values ` +
          `('42', 'x', 'x.sql', '${"a".repeat(64)}');`,
      ),
    /schema_migrations_version_check|violates check constraint/i,
    "a non-three-digit version must be refused by the database, not just by the runner",
  );

  // Silent: the good case still goes in.
  await db.exec(
    `insert into public.schema_migrations (version, name, filename, checksum) values ` +
      `('042', 'x', 'x.sql', '${"a".repeat(64)}');`,
  );
  const { rows } = await db.query("select count(*)::int as n from public.schema_migrations");
  assert.equal(rows[0].n, 1);
});

test("the ledger REJECTS a checksum that is not a sha256, and an unknown origin", async () => {
  const db = await clearLedger();
  await assert.rejects(
    () =>
      db.exec(
        "insert into public.schema_migrations (version, name, filename, checksum) values " +
          "('001', 'x', 'x.sql', 'not-a-checksum');",
      ),
    /violates check constraint/i,
    "a truncated or absent checksum would silently disable the tamper guard",
  );
  await assert.rejects(
    () =>
      db.exec(
        `insert into public.schema_migrations (version, name, filename, checksum, origin) values ` +
          `('001', 'x', 'x.sql', '${"a".repeat(64)}', 'probably');`,
      ),
    /violates check constraint/i,
  );
  // And the two legitimate origins are both accepted.
  await db.exec(
    `insert into public.schema_migrations (version, name, filename, checksum, origin) values ` +
      `('001', 'x', 'x.sql', '${"a".repeat(64)}', 'applied'), ` +
      `('002', 'x', 'x.sql', '${"b".repeat(64)}', 'adopted');`,
  );
});

test("one version can never have two ledger rows", async () => {
  const db = await clearLedger();
  const row = `('001', 'x', 'x.sql', '${"a".repeat(64)}')`;
  await db.exec(`insert into public.schema_migrations (version, name, filename, checksum) values ${row};`);
  await assert.rejects(
    () => db.exec(`insert into public.schema_migrations (version, name, filename, checksum) values ${row};`),
    /duplicate key|unique/i,
    "the primary key is what makes version the identity",
  );
});

// ===========================================================================
// THE THREAT MODEL IS POSTGREST, NOT THE UI.
//
// Supabase grants new tables to anon and authenticated by default, so an
// unprotected ledger is a map of exactly which security migrations an
// environment is missing, readable with the public anon key.
// ===========================================================================

test("anon and authenticated cannot read the ledger — proven by querying as them", async () => {
  const db = await clearLedger();
  await db.exec(
    `insert into public.schema_migrations (version, name, filename, checksum) values ` +
      `('001', 'schema', '001_schema.sql', '${"a".repeat(64)}');`,
  );

  // Silent direction: the owner/service connection CAN read it, or the test
  // below would pass against a table that simply does not work.
  const asOwner = await db.query("select count(*)::int as n from public.schema_migrations");
  assert.equal(asOwner.rows[0].n, 1, "the runner's own connection must be able to read the ledger");

  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role};`);
    await assert.rejects(
      () => db.query("select * from public.schema_migrations"),
      /permission denied/i,
      `${role} must be refused at the table level, not merely returned an empty set`,
    );
    await db.exec("reset role;");
  }

  const { rows } = await db.query(`
    select has_table_privilege('anon',          'public.schema_migrations', 'select') as anon_select,
           has_table_privilege('authenticated', 'public.schema_migrations', 'select') as auth_select,
           relrowsecurity as rls,
           relforcerowsecurity as forced
      from pg_class where oid = 'public.schema_migrations'::regclass
  `);
  assert.equal(rows[0].anon_select, false);
  assert.equal(rows[0].auth_select, false);
  assert.equal(rows[0].rls, true);
  assert.equal(rows[0].forced, true);
});

// ===========================================================================
// The runner's own SQL, executed.
// ===========================================================================

test("recordAdoptedSql / recordStartSql / recordFinishSql are SQL Postgres accepts", async () => {
  const db = await clearLedger();

  await db.exec(recordAdoptedSql(MIGRATIONS.slice(0, 3), "tester", "adopted in a test"));
  let ledger = await readLedger();
  assert.equal(ledger.length, 3);
  assert.ok(ledger.every((r) => r.origin === "adopted" && r.finished_at !== null));

  await db.exec(recordStartSql(MIGRATIONS[3], "tester"));
  ledger = await readLedger();
  const started = ledger.find((r) => r.version === MIGRATIONS[3].version);
  assert.equal(started.origin, "applied");
  assert.equal(started.finished_at, null, "a started migration is unfinished until it reports back");

  await db.exec(recordFinishSql(MIGRATIONS[3].version));
  ledger = await readLedger();
  assert.notEqual(ledger.find((r) => r.version === MIGRATIONS[3].version).finished_at, null);
});

test("a filename containing a quote cannot break out of the runner's SQL", async () => {
  const db = await clearLedger();
  const nasty = {
    version: "099",
    slug: "o_brien",
    filename: `099_o'brien'); drop table public.schema_migrations; --.sql`,
    checksum: "a".repeat(64),
  };
  await db.exec(recordStartSql(nasty, "tester"));
  const ledger = await readLedger();
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].filename, nasty.filename, "the value must round-trip verbatim");
  assert.equal(sqlQuote("a'b"), "'a''b'");
  // The table is still there, which is the actual claim.
  await db.query("select 1 from public.schema_migrations limit 1");
});

// ===========================================================================
// GUARD: adopting an existing database.
//
// THE CENTRAL CLAIM OF THIS CHANGE. Production already carries all of this DDL
// and has no ledger. Adopting must make the runner consider everything applied
// — including the baseline that was just RENAMED from schema.sql to
// 001_schema.sql — so that not one line of DDL is re-run against a live
// database.
// ===========================================================================

test("after adopt, a real fully-migrated database has NOTHING pending and no problems", async () => {
  const db = await clearLedger();
  await db.exec(recordAdoptedSql(MIGRATIONS, "tester", "existing production database"));

  const plan = await planAgainstDatabase();
  assert.deepEqual(
    plan.problems.map((p) => `${p.code}: ${p.message}`),
    [],
    "a correctly adopted database must be completely clean",
  );
  assert.deepEqual(plan.pending, [], "NOT ONE migration may be re-applied to an adopted database");
  assert.equal(plan.applied.length, MIGRATIONS.length);
  assert.equal(plan.ok, true);
});

test("the renamed baseline is not re-run: a ledger written as schema.sql still matches 001_schema.sql", async () => {
  const db = await clearLedger();
  // Exactly what an operator who adopted BEFORE this branch would have: the
  // baseline recorded under its old filename, same content, same version.
  const baseline = MIGRATIONS[0];
  assert.equal(baseline.filename, "001_schema.sql");
  await db.exec(
    "insert into public.schema_migrations (version, name, filename, checksum, started_at, finished_at, origin) values " +
      `(${sqlQuote(baseline.version)}, 'schema', 'schema.sql', ${sqlQuote(baseline.checksum)}, now(), now(), 'adopted');`,
  );

  const plan = await planAgainstDatabase({ acceptRenames: true });
  assert.ok(
    !plan.pending.some((p) => p.version === "001"),
    "the baseline must NOT become pending again because the file was renamed",
  );

  // ...and without --accept-renames the rename is reported rather than ignored.
  const strict = await planAgainstDatabase();
  assert.equal(has(strict, "renamed_migration"), true, "a rename must never be silent");
  assert.ok(!strict.pending.some((p) => p.version === "001"), "it refuses; it does not re-run");
});

// ===========================================================================
// GUARD: a migration file edited after it was applied.
// ===========================================================================

test("checksum_mismatch FIRES against a real ledger when a real migration file is tampered with", async () => {
  const db = await clearLedger();
  await db.exec(recordAdoptedSql(MIGRATIONS, "tester", "existing production database"));

  // Silent direction first, so the failure below means something.
  assert.equal(has(await planAgainstDatabase(), "checksum_mismatch"), false);

  // Plant the defect: someone "just tweaks" an applied migration.
  const target = MIGRATIONS.find((m) => m.version === "023");
  const original = readFileSync(path.join(DB_DIR, target.filename), "utf8");
  const tampered = `${original}\n-- a harmless-looking edit to an applied migration\n`;
  const files = MIGRATIONS.map((m) =>
    m.version === "023" ? { ...m, checksum: checksumOf(tampered) } : m,
  );

  const plan = await planAgainstDatabase({ files });
  assert.equal(has(plan, "checksum_mismatch"), true, "editing an applied migration must be caught");
  assert.equal(plan.ok, false);
  assert.equal(plan.problems.find((p) => p.code === "checksum_mismatch").version, "023");
});

test("checksum_mismatch stays SILENT for the same file with Windows line endings", async () => {
  const db = await clearLedger();
  await db.exec(recordAdoptedSql(MIGRATIONS, "tester", "adopted on Linux CI"));

  // The same commit checked out on Windows with core.autocrlf=true. Different
  // bytes, identical SQL. If this fired, the runner would report tampering on
  // every migration on every developer machine and would simply be turned off.
  const files = MIGRATIONS.map((m) => {
    const text = readFileSync(path.join(DB_DIR, m.filename), "utf8");
    const crlf = text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
    return { ...m, checksum: checksumOf(crlf) };
  });

  const plan = await planAgainstDatabase({ files });
  assert.deepEqual(
    plan.problems.filter((p) => p.code === "checksum_mismatch"),
    [],
    "a CRLF checkout must not be mistaken for tampering",
  );
});

// ===========================================================================
// GUARD: a run that died halfway.
// ===========================================================================

test("partially_applied FIRES on a real half-written ledger row, and clears when it finishes", async () => {
  const db = await clearLedger();
  await db.exec(recordAdoptedSql(MIGRATIONS.slice(0, -1), "tester", "up to 040"));

  const last = MIGRATIONS[MIGRATIONS.length - 1];
  // The runner commits the start row on its own, THEN runs the file. This is
  // the state a dropped connection or a cancelled statement leaves behind.
  await db.exec(recordStartSql(last, "tester"));

  const stuck = await planAgainstDatabase();
  assert.equal(has(stuck, "partially_applied"), true, "a half-applied migration must stop everything");
  assert.equal(stuck.ok, false);
  assert.equal(stuck.problems.find((p) => p.code === "partially_applied").version, last.version);

  // Silent direction: once it reports back, the database is clean again.
  await db.exec(recordFinishSql(last.version));
  const healed = await planAgainstDatabase();
  assert.deepEqual(healed.problems, []);
  assert.equal(healed.ok, true);
});

// ===========================================================================
// GUARD: an environment migrated from a different branch.
//
// This is the live production situation: the database is running DDL from the
// unmerged branch feature/live-communications-payments while main describes a
// different schema.
// ===========================================================================

test("applied_file_missing FIRES when the real ledger names a migration this checkout lacks", async () => {
  const db = await clearLedger();
  await db.exec(recordAdoptedSql(MIGRATIONS, "tester", "existing production database"));
  await db.exec(
    "insert into public.schema_migrations (version, name, filename, checksum, started_at, finished_at, origin) values " +
      `('099', 'live_communications_payments', '099_live_communications_payments.sql', '${"f".repeat(64)}', now(), now(), 'applied');`,
  );

  const plan = await planAgainstDatabase();
  assert.equal(has(plan, "applied_file_missing"), true, "deploying over a different history must be caught");
  assert.equal(plan.ok, false);
});

// ===========================================================================
// GUARD: a migration merged behind the high-water mark.
// ===========================================================================

test("out_of_order FIRES when a real ledger skips a version that later ones have applied", async () => {
  const db = await clearLedger();
  await db.exec(recordAdoptedSql(MIGRATIONS, "tester", "existing production database"));
  // 035 was never actually applied — it merged after 041 had already run.
  await db.exec("delete from public.schema_migrations where version = '035';");

  const plan = await planAgainstDatabase();
  assert.equal(has(plan, "out_of_order"), true);
  const problem = plan.problems.find((p) => p.code === "out_of_order");
  assert.equal(problem.version, "035");
  assert.equal(plan.ok, false);
});

test("out_of_order is SILENT when the ledger simply stops partway through", async () => {
  // An environment that is genuinely behind — adopted through 030 — has 031..041
  // pending, all ABOVE the high-water mark. That is normal, not a defect.
  const db = await clearLedger();
  const through030 = MIGRATIONS.filter((m) => m.version <= "030");
  await db.exec(recordAdoptedSql(through030, "tester", "a staging database that is behind"));

  const plan = await planAgainstDatabase();
  assert.deepEqual(plan.problems, [], "being behind is not an error");
  assert.equal(plan.pending.length, MIGRATIONS.length - through030.length);
  assert.equal(plan.pending[0].version, "031");
});

// ===========================================================================
// An empty database.
// ===========================================================================

test("a database with the ledger installed but empty has every migration pending, in order", async () => {
  const db = await clearLedger();
  const plan = await planAgainstDatabase();
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(
    plan.pending.map((p) => p.filename),
    MIGRATIONS.map((m) => m.filename),
  );
  assert.equal(plan.pending[0].filename, "001_schema.sql", "the baseline must be applied first");
});
