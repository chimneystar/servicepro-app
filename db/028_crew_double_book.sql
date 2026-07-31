-- =====================================================================
--  ServicePro — Migration 028 (crew assignments obey the no-double-book rule)
--  Run once in the Supabase SQL Editor, AFTER 027. Safe to re-run.
--
--  THE BUG: "the database physically cannot double-book a technician" is the
--  product's headline scheduling guarantee, and it is enforced by exactly one
--  constraint — `jobs_no_double_book` (db/schema.sql) — which covers exactly one
--  column: jobs.assigned_to.
--
--  But there are three assignment models in this schema, and the dispatch board
--  writes two of them. Every technician added through "+ Add technician" lands
--  in `job_assignments`, which no constraint looks at. So the guarantee held for
--  the lead and silently did not hold for anybody else on the job: a crew member
--  could be booked onto four overlapping jobs and nothing anywhere objected.
--
--  `job_assignments` has no times of its own — the overlap lives on the job —
--  so this cannot be an exclusion constraint on that table. It is a trigger that
--  applies the same predicate as `jobs_no_double_book`, raising the SAME
--  SQLSTATE (23P01, exclusion_violation) so application code that already maps
--  that code to "already booked" keeps working unchanged.
--
--  Nothing is dropped, no row is rewritten, and historical overlaps are
--  reported rather than enforced retroactively: the trigger fires on new writes
--  only, so existing crew rows stay exactly as they are.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The predicate, shared by both directions.
--
--    True when p_profile_id is already committed to some OTHER live job whose
--    slot overlaps p_job_id's slot — whether committed as the lead
--    (jobs.assigned_to) or as crew (job_assignments).
--
--    `slot` is a generated tsrange of (scheduled_date + start_time,
--    scheduled_date + end_time), so an overlap can only occur inside one
--    calendar day. Matching scheduled_date first lets this ride idx_jobs_date
--    instead of scanning.
-- ---------------------------------------------------------------------
create or replace function public.crew_double_booked(p_job_id uuid, p_profile_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $body$
declare
  v_org  uuid;
  v_slot tsrange;
  v_date date;
begin
  if p_job_id is null or p_profile_id is null then return false; end if;

  select j.organization_id, j.slot, j.scheduled_date
    into v_org, v_slot, v_date
    from public.jobs j
   where j.id = p_job_id
     and j.deleted_at is null
     and j.status <> 'cancelled';

  -- No job, no times on it, or it is cancelled/deleted: nothing to overlap.
  -- This mirrors the WHERE clause of jobs_no_double_book exactly.
  if v_slot is null then return false; end if;

  return exists (
    select 1
      from public.jobs other
     where other.id <> p_job_id
       and other.organization_id = v_org
       and other.scheduled_date = v_date
       and other.deleted_at is null
       and other.status <> 'cancelled'
       and other.slot is not null
       and other.slot && v_slot
       and (
         other.assigned_to = p_profile_id
         or exists (
           select 1 from public.job_assignments a
            where a.job_id = other.id
              and a.profile_id = p_profile_id
              and a.assignment_status <> 'declined'
         )
       )
  );
end;
$body$;

revoke all on function public.crew_double_booked(uuid, uuid) from public;
grant execute on function public.crew_double_booked(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Adding or moving a crew assignment.
-- ---------------------------------------------------------------------
create or replace function public.assert_crew_not_double_booked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $body$
begin
  -- Crew-level rows (crew_id) carry no single profile; and a declined
  -- assignment is not a commitment, so neither is checked.
  if new.profile_id is null or new.assignment_status = 'declined' then return new; end if;

  if public.crew_double_booked(new.job_id, new.profile_id) then
    raise exception 'That technician is already booked for an overlapping time.'
      using errcode = '23P01';
  end if;
  return new;
end;
$body$;

drop trigger if exists trg_job_assignments_no_double_book on public.job_assignments;
create trigger trg_job_assignments_no_double_book
before insert or update of job_id, profile_id, assignment_status on public.job_assignments
for each row execute function public.assert_crew_not_double_booked();

-- ---------------------------------------------------------------------
-- 3. The other direction: moving a JOB onto a time where one of its crew is
--    already committed. Without this half, the guard is trivially side-stepped
--    by assigning first and rescheduling afterwards — which is precisely what
--    the dispatch board's drag-and-drop does.
--
--    AFTER, not BEFORE: `jobs.slot` is a generated column, and generated
--    columns are not populated in BEFORE-row triggers. A BEFORE trigger would
--    read NEW.slot as null and wave every reschedule through.
-- ---------------------------------------------------------------------
create or replace function public.assert_job_crew_not_double_booked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $body$
declare
  v_profile uuid;
begin
  if new.deleted_at is not null or new.status = 'cancelled' or new.slot is null then return new; end if;
  -- Only worth checking when the timing actually moved.
  if tg_op = 'UPDATE' and old.slot is not distinct from new.slot
     and old.status is not distinct from new.status
     and old.deleted_at is not distinct from new.deleted_at then
    return new;
  end if;

  for v_profile in
    select a.profile_id from public.job_assignments a
     where a.job_id = new.id and a.profile_id is not null and a.assignment_status <> 'declined'
  loop
    if public.crew_double_booked(new.id, v_profile) then
      raise exception 'A crew member on this job is already booked for an overlapping time.'
        using errcode = '23P01';
    end if;
  end loop;
  return new;
end;
$body$;

drop trigger if exists trg_jobs_crew_no_double_book on public.jobs;
create trigger trg_jobs_crew_no_double_book
after update of scheduled_date, start_time, end_time, status, deleted_at on public.jobs
for each row execute function public.assert_job_crew_not_double_booked();

-- ---------------------------------------------------------------------
-- 4. Supporting index. The lookup above is "other live jobs for this profile on
--    this date", which nothing indexed: idx_job_assignments_profile is keyed
--    (profile_id, job_id) and is used for the crew leg, but the lead leg wants
--    (organization_id, scheduled_date, assigned_to).
-- ---------------------------------------------------------------------
create index if not exists idx_jobs_org_date_assigned
  on public.jobs (organization_id, scheduled_date, assigned_to)
  where deleted_at is null and start_time is not null;

-- ---------------------------------------------------------------------
-- 5. Historical data is REPORTED, not rejected.
--
--    Triggers only see new writes, so nothing above can fail on existing rows —
--    the equivalent of `not valid` for a constraint. But an operator should
--    still learn that overlaps are already in the table, because editing such a
--    row will now be refused until it is reconciled.
-- ---------------------------------------------------------------------
do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
    from public.job_assignments a
   where a.profile_id is not null
     and a.assignment_status <> 'declined'
     and public.crew_double_booked(a.job_id, a.profile_id);
  if v_count > 0 then
    raise notice 'Migration 028: % existing crew assignment(s) already overlap. They are left in place and untouched; the trigger applies to new writes only. Query: select a.job_id, a.profile_id from public.job_assignments a where a.profile_id is not null and public.crew_double_booked(a.job_id, a.profile_id);', v_count;
  end if;
exception when others then
  raise notice 'Migration 028: overlap survey skipped: %', sqlerrm;
end $$;

-- =====================================================================
-- End migration 028.
-- =====================================================================
