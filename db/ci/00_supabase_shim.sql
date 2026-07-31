-- =====================================================================
--  ServicePro — CI shim for vanilla PostgreSQL 16
--
--  WHY THIS FILE EXISTS
--  --------------------
--  Every security assertion in this repository was, until now, static analysis
--  of SQL text. Reading a policy cannot prove that the policy refuses a query.
--  The only proof is a real database that applies the real migrations and then
--  refuses the real attack.
--
--  The migrations are written for Supabase, which pre-creates a handful of
--  objects that vanilla Postgres does not have. This file creates exactly those
--  objects and nothing else, so that what CI exercises is the production SQL,
--  not a rewritten copy of it.
--
--  WHAT SUPABASE PROVIDES THAT WE MUST RECREATE (found by grepping db/*.sql,
--  not guessed):
--    * roles          anon, authenticated, service_role      (88 `to authenticated`,
--                                                             29 `to anon`,
--                                                             9  `to service_role`)
--    * schema auth    auth.uid()   — 63 references
--                     auth.users   — 13 references (FK target + email lookup)
--    * schema storage storage.objects     — 14 references (RLS policies)
--                     storage.foldername() — 3 references
--    * default grants Supabase grants anon/authenticated all privileges on new
--                     objects in `public`. Migration 023 §8 REVOKES those from
--                     anon; without the default grant that revoke would be a
--                     no-op and CI would prove nothing.
--    * extensions     pgcrypto (gen_random_uuid), btree_gist (no-double-book
--                     exclusion constraint). Both are in postgresql-contrib and
--                     ship with the postgres:16 image.
--
--  Run as a superuser, BEFORE schema.sql.
-- =====================================================================

set client_min_messages = notice;

-- ---------------------------------------------------------------------
-- 1. Extensions. schema.sql creates these too (idempotently); doing it here
--    as well means the shim is self-contained and gen_random_uuid() is
--    available to everything below.
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- 2. The three Supabase roles.
--    NOLOGIN: nothing connects as them; tests reach them with SET ROLE.
--    NOINHERIT mirrors Supabase and keeps privilege reasoning honest.
--    service_role has BYPASSRLS, exactly as on Supabase — several migrations
--    (013 webhook_events, 022 platform tables, 023 subscriptions) rely on
--    "no policy at all => service-role only" being a real statement.
-- ---------------------------------------------------------------------
do $$ begin create role anon          nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role  nologin noinherit bypassrls; exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 3. The `auth` schema.
-- ---------------------------------------------------------------------
create schema if not exists auth;

-- Only the columns the migrations actually touch: `id` (FK target in schema.sql
-- and 022) and `email` (read by accept_invitation in 003 and 023).
create table if not exists auth.users (
  id         uuid primary key default gen_random_uuid(),
  email      text unique,
  created_at timestamptz not null default now()
);

-- auth.uid() must be settable per session so a test can impersonate a user.
-- Backed by a custom GUC, which any role may set:
--     select set_config('request.jwt.claim.sub', '<uuid>', false);
-- The `request.jwt.claims` JSON form is accepted too, because that is what
-- PostgREST actually sets and the two must not disagree.
--
-- STABLE, like the real one: re-evaluated once per statement, so switching
-- identity between statements works and switching mid-statement cannot.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
           nullif(current_setting('request.jwt.claim.sub', true), ''),
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
         )::uuid
$$;

-- ---------------------------------------------------------------------
-- 4. The `storage` schema.
--    Migrations 002 and 023 create RLS policies on storage.objects. They must
--    apply cleanly; the object columns they reference are `bucket_id` and
--    `name`.
-- ---------------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id         text primary key,
  name       text not null,
  public     boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

-- Supabase's storage.foldername() returns the path segments WITHOUT the
-- filename: 'org-uuid/job-uuid/photo.jpg' -> {org-uuid, job-uuid}. Migration
-- 023 relies on element [1] being the organisation id, so the trailing-element
-- trim matters and is reproduced faithfully.
create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare parts text[];
begin
  parts := string_to_array(name, '/');
  if parts is null or array_length(parts, 1) is null or array_length(parts, 1) < 2 then
    return array[]::text[];
  end if;
  return parts[1 : array_length(parts, 1) - 1];
end $$;

insert into storage.buckets (id, name, public) values
  ('job-photos',  'job-photos',  false),
  ('item-photos', 'item-photos', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 5. Grants that Supabase issues out of the box.
-- ---------------------------------------------------------------------
grant usage on schema public  to anon, authenticated, service_role;
grant usage on schema auth    to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;

grant execute on function auth.uid()                to public;
grant execute on function storage.foldername(text)  to public;

grant select, insert, update, delete on storage.objects to anon, authenticated;
grant all    on storage.objects to service_role;
grant select on storage.buckets to anon, authenticated;
grant all    on storage.buckets to service_role;

-- THE IMPORTANT ONE. On Supabase every new table in `public` is granted to
-- anon and authenticated by default privileges. That default is the reason
-- audit finding "anon retains default table grants on 32 pre-017 tables"
-- exists at all, and the reason migration 023 §8 has to revoke it. Recreate
-- the default so the revoke is proved rather than assumed.
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. The `ci` assertion harness.
--
--    Deliberately tiny, deliberately SECURITY INVOKER: ci.attempt() runs the
--    statement as whoever is impersonated, so RLS applies to it exactly as it
--    would to a PostgREST request.
-- ---------------------------------------------------------------------
create schema if not exists ci;
grant usage on schema ci to anon, authenticated, service_role;

-- Fail the whole psql run (ON_ERROR_STOP=1) if the property does not hold.
create or replace function ci.assert(p_ok boolean, p_what text) returns void
language plpgsql as $$
begin
  if p_ok is not true then
    raise exception 'ASSERTION FAILED: %', p_what;
  end if;
  raise notice 'ok   %', p_what;
end $$;

-- Run one statement and report what the database did with it.
--   >= 0  the statement was ALLOWED; the value is the number of rows it changed
--         (0 means an RLS USING clause hid every candidate row — a silent refusal,
--          which is how PostgREST-visible UPDATE/DELETE denials actually present)
--   -1    the statement was REFUSED outright: RLS WITH CHECK, a guard trigger,
--         a tenant FK, or a missing GRANT.
-- Anything else re-raises, so an unrelated breakage can never be mistaken for
-- a successful denial.
create or replace function ci.attempt(p_sql text) returns bigint
language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
exception
  when insufficient_privilege then return -1;   -- 42501 (incl. RLS WITH CHECK)
  when check_violation        then return -1;   -- 23514 (org-guard triggers)
  when foreign_key_violation  then return -1;   -- 23503 (composite tenant FKs)
end $$;

-- Same, but reports WHICH refusal happened. '' means the statement completed.
create or replace function ci.refusal(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return '';
exception when others then
  return sqlstate;
end $$;

grant execute on function ci.assert(boolean, text) to anon, authenticated, service_role;
grant execute on function ci.attempt(text)         to anon, authenticated, service_role;
grant execute on function ci.refusal(text)         to anon, authenticated, service_role;

do $$ begin raise notice 'shim ready: roles, auth, storage, default grants, ci helpers'; end $$;
