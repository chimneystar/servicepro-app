-- =====================================================================
--  ServicePro — Migration 025 (dispatch board integrity)
--  Run once in the Supabase SQL Editor, AFTER 024. Safe to re-run.
--
--  THE BUG: jobs.end_date was added by migration 019 as NULLABLE WITH NO
--  DEFAULT. The dispatch board matches
--      scheduled_date <= :day AND (end_date >= :day OR end_date IS NULL)
--  so any job left with a null end_date reappears on EVERY future day, for ever.
--
--  Manual job creation always set it, so the defect was invisible at first. But
--  three paths did not: the "Generate due" button, the nightly cron, and public
--  online booking. The nightly cron meant the board degraded on its own, with
--  nobody doing anything wrong, and the only way to clear a phantom job was to
--  find and edit it by hand.
--
--  Those three call sites are fixed in the application. This migration makes the
--  class of bug impossible rather than relying on every future insert
--  remembering: backfill, default, and NOT NULL.
-- =====================================================================

-- 1. Repair the rows already polluting the board.
update public.jobs
   set end_date = scheduled_date
 where end_date is null;

-- 2. A job that forgets its end date now gets a sane one instead of a wildcard.
alter table public.jobs alter column end_date set default null;
do $$
begin
  -- Default to the start date at the row level; a trigger is used rather than a
  -- column DEFAULT because the value depends on another column of the same row.
  create or replace function public.default_job_end_date()
  returns trigger language plpgsql set search_path = '' as $body$
  begin
    if new.end_date is null then new.end_date := new.scheduled_date; end if;
    return new;
  end $body$;
exception when others then
  raise notice 'default_job_end_date not created: %', sqlerrm;
end $$;

drop trigger if exists trg_jobs_default_end_date on public.jobs;
create trigger trg_jobs_default_end_date
before insert or update on public.jobs
for each row execute function public.default_job_end_date();

-- 3. Now that nothing can write a null, enforce it.
do $$
begin
  alter table public.jobs alter column end_date set not null;
exception when others then
  raise notice 'end_date NOT NULL not applied (rows may still be null): %', sqlerrm;
end $$;

-- 4. An end date before the start date would also produce a job that never
--    appears. Reject it.
do $$
begin
  alter table public.jobs add constraint jobs_end_date_after_start
    check (end_date >= scheduled_date) not valid;
  -- `not valid` so the constraint applies to new writes without failing the
  -- migration on historical rows; validate separately once they are clean.
exception when duplicate_object then null; end $$;

do $$
begin
  alter table public.jobs validate constraint jobs_end_date_after_start;
exception when others then
  raise notice 'jobs_end_date_after_start left unvalidated — existing rows violate it: %', sqlerrm;
end $$;

-- 5. The dispatch board's own query path.
create index if not exists idx_jobs_org_date_range
  on public.jobs (organization_id, scheduled_date, end_date)
  where deleted_at is null;

-- =====================================================================
-- End migration 025.
-- =====================================================================
