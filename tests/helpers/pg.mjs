// A real Postgres, with no Docker and no Supabase CLI.
//
// WHY THIS EXISTS
// ---------------
// Until this file, not one of the 41 migrations in db/ had ever been executed —
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

export const DB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db");

/**
 * The migrations, in the order they must actually be applied.
 *
 * `schema.sql` is the BASELINE and has to run first — but it sorts LAST, so
 * "apply the files in filename order" is wrong for the single most important
 * file in the directory. That is not a detail of this harness; it is ledger item
 * 3.1 ("rename the baseline 001_"), and it is why this function is the one
 * definition of the order rather than a `.sort()` at each call site.
 *
 * `GO-LIVE.sql` is a production checklist, not a migration, and is excluded.
 */
export function migrationFiles() {
  const numbered = readdirSync(DB_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
  return ["schema.sql", ...numbered];
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
 */
export async function freshDatabase({ upTo = null } = {}) {
  const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
  await db.exec("create extension if not exists pgcrypto;");
  await db.exec("create extension if not exists btree_gist;");
  await db.exec(SUPABASE_SHIM);

  const applied = [];
  for (const file of migrationFiles()) {
    const sql = readFileSync(path.join(DB_DIR, file), "utf8");
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
  await db.exec(`select set_config('request.jwt.claim.sub', ${userId === null ? "''" : `'${userId}'`}, false);`);
  await db.exec(`select set_config('request.jwt.claim.role', 'authenticated', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`select set_config('request.jwt.claim.sub', '', false);`);
  }
}
