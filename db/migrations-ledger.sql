-- =====================================================================
--  ServicePro — the migration ledger.
--
--  WHAT WAS MISSING
--  ----------------
--  41 numbered SQL files, applied by hand by a person pasting them into the
--  Supabase SQL editor in filename order, and NOTHING anywhere in the database
--  recording which of them had run. The consequences were not theoretical:
--
--    * Nobody could say which migrations a given environment had actually had
--      applied. Production is known to be running DDL from an unmerged branch
--      (102 base tables) while `main` describes 97.
--    * A file that died halfway — cancelled statement, closed tab, dropped
--      connection — left no trace at all.
--    * `db/MIGRATIONS.md` was the only record, it was maintained by hand, and
--      it had silently stopped at `017_`: five migrations and ~1,370 lines of
--      DDL missing from a disaster-recovery runbook. Following it rebuilt a
--      database the application cannot run against.
--
--  This table is the replacement for that document as the AUTHORITY. The
--  document is now generated; this table is what is true.
--
--  Applied idempotently by `npm run db:migrate` before every run, so a database
--  that predates the ledger can still be brought under it. It is deliberately
--  NOT a numbered migration: it must be able to run before migration 001, and
--  it can never itself be "pending".
--
--  Run once in the Supabase SQL Editor if you are adopting by hand; otherwise
--  the runner does it for you. Safe to re-run.
-- =====================================================================

create table if not exists public.schema_migrations (
  -- IDENTITY. The three-digit filename prefix, and nothing else.
  --
  -- Not the filename: `db/schema.sql` was renamed to `db/001_schema.sql` in
  -- this change, and a filename-keyed ledger would have called that a brand new
  -- migration and tried to re-run the entire baseline against a live database.
  -- Not the checksum: the checksum is what we CHECK, so it cannot also be what
  -- we look the row up by — a tampered file would simply become a new identity
  -- and re-run silently, which is the exact failure this table exists to stop.
  --
  -- The slug after the number is informational and may change; the number may
  -- not. See db/MIGRATIONS.md, "Migration identity".
  version         text primary key
                  check (version ~ '^[0-9]{3}$'),

  -- Informational: the slug and the filename AS APPLIED. The runner reports a
  -- mismatch against the file on disk as a rename and refuses to continue
  -- unless run with --accept-renames, so a file swap cannot be silent.
  name            text        not null,
  filename        text        not null,

  -- SHA-256 of the file's content with CRLF normalised to LF and any BOM
  -- stripped. Normalisation is required, not tidiness: this repository is
  -- developed on Windows with core.autocrlf=true and built on Linux in CI, so
  -- the same commit produces different bytes in the two trees. A raw-byte
  -- checksum would report tampering on every checkout that crossed a platform.
  checksum        text        not null
                  check (checksum ~ '^[0-9a-f]{64}$'),

  -- started_at is written BEFORE the file runs; finished_at only after it
  -- commits. A row with a null finished_at is therefore a migration that
  -- started and never reported back, and the runner refuses to do anything
  -- further until a human resolves it. That is the whole point: a partial
  -- application must leave a mark.
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,

  -- Who applied it: the database user, plus whatever the operator identified
  -- themselves as (MIGRATION_APPLIED_BY, defaulting to the OS user).
  applied_by      text        not null default current_user,

  -- 'applied'  — this runner executed the file against this database.
  -- 'adopted'  — the DDL was already present when the ledger was introduced
  --              (or applied by hand), and the row was recorded WITHOUT
  --              executing anything. See `npm run db:migrate -- adopt`.
  origin          text        not null default 'applied'
                  check (origin in ('applied', 'adopted')),

  -- Free-text note; `adopt` records why the row was taken on trust.
  note            text
);

comment on table public.schema_migrations is
  'The authoritative record of which migrations have been applied to THIS database. '
  'Written by scripts/db-migrate.mjs. db/MIGRATIONS.md is generated documentation; '
  'this table is the truth.';

create index if not exists schema_migrations_unfinished_idx
  on public.schema_migrations (version)
  where finished_at is null;

-- ---------------------------------------------------------------------
--  Lock it down.
--
--  THE THREAT MODEL IS POSTGREST, NOT THE UI. Supabase grants the anon and
--  authenticated roles table privileges by default, so a new table is reachable
--  at /rest/v1/schema_migrations with the public anon key unless it is
--  explicitly revoked. This table is a map of exactly which security migrations
--  an environment has and has not applied — a reconnaissance gift.
--
--  RLS with NO policies denies every row to every non-superuser role (the
--  service role bypasses RLS, which is how the runner writes to it). The
--  revokes are belt-and-braces: they make the refusal a permission error at the
--  table level rather than an empty result set.
-- ---------------------------------------------------------------------
alter table public.schema_migrations enable row level security;
alter table public.schema_migrations force row level security;

revoke all on public.schema_migrations from anon, authenticated;

do $$
begin
  -- These roles only exist on a real Supabase/CI database; a plain Postgres
  -- used for local experimentation should not fail here.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on public.schema_migrations to service_role;
  end if;
exception
  when undefined_object then null;
end $$;
