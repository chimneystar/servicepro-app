-- =====================================================================
--  ServicePro — Migration 006 (rich appointment / job types)
--  Run once in the Supabase SQL Editor, after 005.
--
--  Upgrades job types from a plain text list to real records with a
--  color, default duration, and default price. Existing types from
--  organizations.job_types are copied over automatically.
-- =====================================================================

create table if not exists public.job_types (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  name                text not null,
  color               text not null default '#2563eb',
  duration_min        integer not null default 60 check (duration_min between 0 and 1440),
  default_price_minor bigint  not null default 0 check (default_price_minor >= 0),
  sort                integer not null default 0,
  created_at          timestamptz not null default now()
);
create index if not exists idx_job_types_org on public.job_types(organization_id);

alter table public.job_types enable row level security;

drop policy if exists job_types_select on public.job_types;
create policy job_types_select on public.job_types for select
  using (organization_id = public.current_org_id());

drop policy if exists job_types_write on public.job_types;
create policy job_types_write on public.job_types for all
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))
  with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));

-- Seed from the old text[] list (only if this org has no job_types rows yet)
insert into public.job_types (organization_id, name, sort)
select o.id, jt.name, jt.ord::int
from public.organizations o
cross join lateral unnest(coalesce(o.job_types, array[]::text[])) with ordinality as jt(name, ord)
where not exists (select 1 from public.job_types x where x.organization_id = o.id);

-- =====================================================================
-- End migration 006.
-- =====================================================================
