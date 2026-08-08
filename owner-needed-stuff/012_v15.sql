-- =====================================================================
--  ServicePro — Migration 012 (v15: custom statuses, tags, commission)
--  Run once in the Supabase SQL Editor, AFTER 011. Safe to re-run.
--
--  Adds:
--    1. job_statuses  — customizable pipeline statuses per business
--    2. jobs.stage / stage_changed_at / tags / job_expenses_minor
--    3. profiles.commission_pct — for the technician payroll report
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Customizable job statuses
-- ---------------------------------------------------------------------
create table if not exists public.job_statuses (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  color            text not null default '#2563eb',
  sort             integer not null default 0,
  is_done          boolean not null default false,
  is_cancelled     boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists idx_job_statuses_org on public.job_statuses(organization_id, sort);

alter table public.job_statuses enable row level security;
drop policy if exists job_statuses_select on public.job_statuses;
create policy job_statuses_select on public.job_statuses for select
  using (organization_id = public.current_org_id());
drop policy if exists job_statuses_write on public.job_statuses;
create policy job_statuses_write on public.job_statuses for all
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))
  with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));

-- Seed a sensible default pipeline for every org that has none yet.
insert into public.job_statuses (organization_id, name, color, sort, is_done, is_cancelled)
select o.id, d.name, d.color, d.sort, d.is_done, d.is_cancelled
from public.organizations o
cross join (values
  ('Submitted',            '#2563eb', 10, false, false),
  ('Scheduled',            '#0891b2', 20, false, false),
  ('In Progress',          '#d97706', 30, false, false),
  ('Waiting on parts',     '#7c3aed', 40, false, false),
  ('Waiting to schedule',  '#db2777', 50, false, false),
  ('Done pending approval','#0ea5e9', 60, false, false),
  ('Done',                 '#15803d', 70, true,  false),
  ('Cancelled',            '#dc2626', 80, false, true)
) as d(name, color, sort, is_done, is_cancelled)
where not exists (select 1 from public.job_statuses x where x.organization_id = o.id);

-- ---------------------------------------------------------------------
-- 2. Jobs: rich pipeline stage + tags + per-job cost
-- ---------------------------------------------------------------------
alter table public.jobs add column if not exists stage             text not null default 'Scheduled';
alter table public.jobs add column if not exists stage_changed_at  timestamptz not null default now();
alter table public.jobs add column if not exists tags              text[] not null default '{}';
alter table public.jobs add column if not exists job_expenses_minor bigint not null default 0 check (job_expenses_minor >= 0);
create index if not exists idx_jobs_stage on public.jobs(organization_id, stage);
create index if not exists idx_jobs_tags  on public.jobs using gin (tags);

-- Backfill stage from the legacy enum status (one-time).
update public.jobs set stage = case status
  when 'scheduled'  then 'Scheduled'
  when 'in_progress' then 'In Progress'
  when 'done'       then 'Done'
  when 'cancelled'  then 'Cancelled'
  else 'Scheduled' end
where stage = 'Scheduled' and status is distinct from 'scheduled';

-- ---------------------------------------------------------------------
-- 3. Technician commission percentage
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists commission_pct integer not null default 0 check (commission_pct between 0 and 100);

-- =====================================================================
-- End migration 012 (v15).
-- =====================================================================
