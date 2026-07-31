// A real Postgres, with no Docker and no Supabase CLI.
//
// WHY THIS EXISTS
// ---------------
// Until this file, not one of the migrations in db/ had ever been executed —
// by anyone. They were applied by hand, one at a time, by pasting them into the
// Supabase SQL editor, and the only evidence any of them worked was that
// production had not visibly broken. There was no way to build the schema from
// scratch and no way to find out whether you still could.
//
// PGlite is Postgres itself compiled to WebAssembly, so this is not a simulation
// or a linter: `create policy` really creates a policy, a foreign key really
// requires a unique key on the referenced columns, and a function really has to
// exist before the policy that calls it. The first run of this harness found two
// defects in db/030_refunds.sql, the second hidden behind the first, either of
// which would have aborted the migration in production.
//
// WHAT IT DOES NOT PROVE. This is Postgres, not Supabase. `auth.uid()`,
// `auth.users` and `storage.objects` are shimmed below, so this proves our DDL
// and our policy LOGIC, not that Supabase's own auth and storage behave as we
// assume. Anything depending on Supabase's implementation still needs a real
// project. See docs/E2E-REQUIREMENTS.md.

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyFiles, planMigrations } from "../../lib/core/migrations.mjs";

export const DB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db");

/**
 * The migrations, in the order they must actually be applied.
 *
 * `schema.sql` used to be the BASELINE that had to run first while sorting
 * LAST, so "apply the files in filename order" was wrong for the single most
 * important file in the directory — and this function existed to special-case
 * it. Ledger item 3.1 fixed that at the source: the baseline is now
 * `db/001_schema.sql`, so filename order and application order are the same
 * thing, and the special case is gone.
 *
 * The order is no longer defined here at all. It comes from the migration
 * runner's own classifier (`lib/core/migrations.mjs` + `db/migrations.manifest.json`),
 * so this harness, `npm run db:migrate`, `npm run db:docs` and `db/ci/run.sh`
 * cannot drift apart about what a migration is. Two of the three used to keep
 * their own copy of the rules, and duplicated rules are how `016` ends up being
 * applied as a migration in one place and skipped in another.
 *
 * `016_isolation_tests.sql` is a TEST, not a migration (see
 * `isolationTestSql()`), and `GO-LIVE.sql` is a deprecated bundle. Both are
 * declared in the manifest and excluded here.
 */
export function migrationFiles() {
  const manifest = JSON.parse(readFileSync(path.join(DB_DIR, "migrations.manifest.json"), "utf8"));
  const filenames = readdirSync(DB_DIR).filter((f) => f.endsWith(".sql"));

  // planMigrations, NOT classifyFiles.
  //
  // classifyFiles decides only what IS a migration. The gap check lives in
  // planMigrations, so calling the former alone meant `npm run verify` — the
  // thing that runs on every commit — would not notice a migration file
  // disappearing from the middle of the sequence. Deleting db/025_*.sql left the
  // whole suite green, while `npm run db:migrate` correctly refused.
  //
  // That is this project's signature defect wearing another hat: a guard that is
  // correct, tested, and simply not invoked on the path that matters. The ledger
  // is empty here because a checkout has no database — this asks only "is db/
  // itself coherent", which is exactly the question a test run can answer.
  const { problems } = planMigrations({
    files: filenames.map((filename) => ({ filename, checksum: null })),
    ledger: [],
    nonMigrations: manifest.nonMigrations ?? {},
    allFilenames: filenames,
  });
  if (problems.length) {
    throw new Error(
      `db/ is not a coherent migration sequence, so there is no order to apply:\n  ` +
        problems.map((p) => `${p.code}: ${p.message}`).join("\n  "),
    );
  }
  const { migrations } = classifyFiles(filenames, manifest.nonMigrations ?? {});
  return migrations.map((m) => m.filename);
}

/**
 * `db/016_isolation_tests.sql` — a test, which is why there is no migration 016.
 *
 * It is deliberately NOT in `migrationFiles()`. It used to be swept up by the
 * `^\d{3}_` glob and applied as if it were a migration, which happened to work
 * (it cleans up after itself) but meant the sequence and the proof were the same
 * list. `tests/migrations-apply.test.mjs` runs it explicitly against a freshly
 * built database instead, so it is executed as what it is.
 */
export function isolationTestSql() {
  return readFileSync(path.join(DB_DIR, "016_isolation_tests.sql"), "utf8");
}

/** The Supabase-provided surface the migrations rely on. */
const SUPABASE_SHIM = `
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- auth.uid() reads a GUC so a test can "become" a user with set_config(), which
-- is exactly how PostgREST presents a request. This is what makes it possible to
-- test an RLS policy as an attacker rather than as the owner.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;
create or replace function auth.email() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.email', true), '')
$$;

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  created_at timestamptz default now(),
  metadata jsonb
);
create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $$ select string_to_array(name, '/') $$;

do $$ begin create role anon;           exception when duplicate_object then null; end $$;
do $$ begin create role authenticated;  exception when duplicate_object then null; end $$;
do $$ begin create role service_role;   exception when duplicate_object then null; end $$;
`;

/**
 * Build the schema from scratch and return the live database.
 *
 * Throws on the FIRST migration that fails, naming it. A migration that cannot
 * be applied to an empty database is broken whether or not production happens to
 * have survived it.
 *
 * `shim` replaces the minimal Supabase surface above. The RLS assertion runner
 * passes db/ci/00_supabase_shim.sql instead, because proving that migration 023
 * revokes anon's access requires anon to have HAD access — which only the
 * Supabase-style `alter default privileges` in that file sets up. With the
 * minimal shim, the revoke would be a no-op and the assertions would prove
 * nothing.
 *
 * `skip` omits named files. db/016_isolation_tests.sql is a TEST, not a
 * migration, and the assertion runner executes it separately so that a failure
 * there reports as a failed isolation test rather than as a broken migration.
 */
export async function freshDatabase({ upTo = null, shim = SUPABASE_SHIM, skip = [], beforeEach = null } = {}) {
  const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
  await db.exec("create extension if not exists pgcrypto;");
  await db.exec("create extension if not exists btree_gist;");
  await db.exec(shim);

  const applied = [];
  for (const file of migrationFiles()) {
    if (skip.includes(file)) continue;
    const sql = readFileSync(path.join(DB_DIR, file), "utf8");
    if (beforeEach) await beforeEach(file, sql, db);
    try {
      await db.exec(sql);
      applied.push(file);
    } catch (error) {
      throw new Error(
        `migration ${file} failed to apply to a clean database:\n  ${String(error.message).split("\n")[0]}\n` +
          `  (applied before it: ${applied.length ? applied.join(", ") : "none"})`,
      );
    }
    if (upTo && file === upTo) break;
  }
  return { db, applied };
}

/** Run `fn` as a given authenticated user, the way PostgREST would. */
export async function asUser(db, userId, fn) {
  await db.exec(
    `select set_config('request.jwt.claim.sub', ${userId === null ? "''" : `'${userId}'`}, false);`,
  );
  await db.exec(`select set_config('request.jwt.claim.role', 'authenticated', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`select set_config('request.jwt.claim.sub', '', false);`);
  }
}
