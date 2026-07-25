-- =====================================================================
--  ServicePro — GO-LIVE consolidated migration
--  Run this ONCE in the Supabase SQL Editor (top to bottom).
--  It applies, in order: 012 (v15 features) -> 013 (security) ->
--  014 (tenant isolation) -> 015 (indexes).
--  Assumes migrations through 011 are already applied to this project.
--  Everything is idempotent (safe to re-run).
--  After it succeeds, run 016_isolation_tests.sql to PROVE isolation.
-- =====================================================================


-- ######################## 012_v15.sql ########################

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

-- ######################## 013_security_hardening.sql ########################

-- =====================================================================
--  ServicePro — Migration 013 (GO-LIVE security hardening)
--  Run once in the Supabase SQL Editor, AFTER 012. Safe to re-run.
--
--  Closes the production-audit security findings:
--    * Every function gets a fixed search_path (no mutable search_path).
--    * EXECUTE is revoked from PUBLIC on ALL routines, then granted only to
--      the roles that actually need each one. Public (anon) can only reach
--      the five intentional client entry points.
--    * submit_booking gets DB-level flood protection (rate limiting).
--    * webhook_events gets an explicit deny-all policy (service-role only).
--    * btree_gist is moved out of the public schema.
--
--  NOTE: "Leaked password protection" is a Supabase Auth dashboard toggle,
--  not SQL — see MIGRATIONS.md step 5.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Fix the mutable-search-path helper (set_updated_at).
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql security definer set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------------
-- 2. Rate-limit the public booking endpoint (5 requests / org / minute).
--    Everything else in the body is unchanged from migration 009.
-- ---------------------------------------------------------------------
create or replace function public.submit_booking(
  p_org uuid, p_name text, p_phone text, p_email text,
  p_address text, p_city text, p_service text, p_notes text, p_date date
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.organizations where id = p_org) then return false; end if;
  if coalesce(trim(p_name),'') = '' then return false; end if;
  -- Basic flood protection: no more than 5 new online bookings per org per minute.
  if (select count(*) from public.leads
        where organization_id = p_org and source = 'Online booking'
          and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'Too many requests. Please try again in a minute.' using errcode = 'check_violation';
  end if;
  insert into public.leads (organization_id, name, phone, email, address, city, service, notes, preferred_date, source, status)
  values (p_org, left(trim(p_name),120), left(coalesce(p_phone,''),40), left(coalesce(p_email,''),160),
          left(coalesce(p_address,''),200), left(coalesce(p_city,''),80), left(coalesce(p_service,''),120),
          left(coalesce(p_notes,''),2000), p_date, 'Online booking', 'new');
  return true;
end $$;

-- ---------------------------------------------------------------------
-- 3. Lock down EXECUTE: revoke PUBLIC, grant only what each role needs.
-- ---------------------------------------------------------------------
-- Internal helpers & privileged actions — authenticated users only.
revoke execute on function public.current_org_id()                     from public, anon;
grant  execute on function public.current_org_id()                     to authenticated;
revoke execute on function public.current_user_role()                  from public, anon;
grant  execute on function public.current_user_role()                  to authenticated;
revoke execute on function public.create_org_and_owner(text, text)     from public, anon;
grant  execute on function public.create_org_and_owner(text, text)     to authenticated;
revoke execute on function public.next_document_number(uuid, text)     from public, anon;
grant  execute on function public.next_document_number(uuid, text)     to authenticated;
revoke execute on function public.accept_invitation()                  from public, anon;
grant  execute on function public.accept_invitation()                  to authenticated;

-- Trigger functions are invoked by the trigger, never called directly.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.audit_trigger()  from public, anon, authenticated;

-- Intentional public client entry points (opaque-token or org-id scoped).
revoke execute on function public.public_document(uuid)                              from public;
grant  execute on function public.public_document(uuid)                              to anon, authenticated;
revoke execute on function public.approve_document(uuid, text, text)                 from public;
grant  execute on function public.approve_document(uuid, text, text)                 to anon, authenticated;
revoke execute on function public.public_booking_info(uuid)                          from public;
grant  execute on function public.public_booking_info(uuid)                          to anon, authenticated;
revoke execute on function public.submit_booking(uuid, text, text, text, text, text, text, text, date) from public;
grant  execute on function public.submit_booking(uuid, text, text, text, text, text, text, text, date) to anon, authenticated;
revoke execute on function public.public_customer_portal(uuid)                       from public;
grant  execute on function public.public_customer_portal(uuid)                       to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. webhook_events: RLS is enabled but had no policy. Make intent explicit —
--    deny all non-service-role access (service_role bypasses RLS entirely).
-- ---------------------------------------------------------------------
drop policy if exists webhook_events_no_access on public.webhook_events;
create policy webhook_events_no_access on public.webhook_events
  for all to anon, authenticated using (false) with check (false);

-- ---------------------------------------------------------------------
-- 5. Move btree_gist out of the public schema (best-effort; existing
--    constraints keep working because they reference it by OID).
-- ---------------------------------------------------------------------
do $$
begin
  create schema if not exists extensions;
  alter extension btree_gist set schema extensions;
exception when others then
  raise notice 'btree_gist relocation skipped: %', sqlerrm;
end $$;

-- =====================================================================
-- End migration 013.
-- =====================================================================

-- ######################## 014_tenant_isolation.sql ########################

-- =====================================================================
--  ServicePro — Migration 014 (GO-LIVE tenant isolation)
--  Run once in the Supabase SQL Editor, AFTER 013. Safe to re-run.
--
--  Guarantees at the DATABASE level that records from two businesses can
--  never be linked. RLS controls what a user can SEE; these constraints
--  control what can be WRITTEN, so a bug or a forged request cannot attach
--  (say) Org A's job to Org B's customer.
--
--    * Parents get UNIQUE (id, organization_id).
--    * Required child links use composite FKs (child.parent_id + org must
--      match parent.id + org).
--    * Optional/nullable links use a validation trigger that preserves the
--      existing delete behaviour while blocking cross-tenant references.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Composite unique keys on the parent tables.
-- ---------------------------------------------------------------------
do $$ begin alter table public.customers add constraint customers_id_org_key unique (id, organization_id); exception when duplicate_table then null; when duplicate_object then null; end $$;
do $$ begin alter table public.jobs      add constraint jobs_id_org_key      unique (id, organization_id); exception when duplicate_table then null; when duplicate_object then null; end $$;
do $$ begin alter table public.invoices  add constraint invoices_id_org_key  unique (id, organization_id); exception when duplicate_table then null; when duplicate_object then null; end $$;
do $$ begin alter table public.estimates add constraint estimates_id_org_key unique (id, organization_id); exception when duplicate_table then null; when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. Composite FKs for required (NOT NULL) relationships.
-- ---------------------------------------------------------------------
do $$ begin alter table public.jobs      add constraint jobs_customer_org_fk      foreign key (customer_id, organization_id) references public.customers(id, organization_id) on delete restrict; exception when duplicate_object then null; end $$;
do $$ begin alter table public.estimates add constraint estimates_customer_org_fk foreign key (customer_id, organization_id) references public.customers(id, organization_id) on delete restrict; exception when duplicate_object then null; end $$;
do $$ begin alter table public.invoices  add constraint invoices_customer_org_fk  foreign key (customer_id, organization_id) references public.customers(id, organization_id) on delete restrict; exception when duplicate_object then null; end $$;
do $$ begin alter table public.estimate_items add constraint estimate_items_parent_org_fk foreign key (estimate_id, organization_id) references public.estimates(id, organization_id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.invoice_items  add constraint invoice_items_parent_org_fk  foreign key (invoice_id, organization_id)  references public.invoices(id, organization_id)  on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.job_photos          add constraint job_photos_job_org_fk     foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.job_items           add constraint job_items_job_org_fk      foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.job_tasks           add constraint job_tasks_job_org_fk      foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.job_checklist_items add constraint job_checklist_job_org_fk  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.job_equipment       add constraint job_equipment_job_org_fk  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.job_time_entries    add constraint job_time_job_org_fk       foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.recurring_plans     add constraint recurring_customer_org_fk foreign key (customer_id, organization_id) references public.customers(id, organization_id) on delete cascade; exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 3. Validation trigger for optional/nullable relationships.
--    Blocks cross-tenant writes without changing delete behaviour.
-- ---------------------------------------------------------------------
create or replace function public.assert_child_org()
returns trigger language plpgsql security definer set search_path = public as $$
declare parent text := tg_argv[0]; fkcol text := tg_argv[1]; fk uuid; porg uuid;
begin
  execute format('select ($1).%I', fkcol) into fk using new;
  if fk is null then return new; end if;
  execute format('select organization_id from public.%I where id = $1', parent) into porg using fk;
  if porg is not null and porg <> new.organization_id then
    raise exception 'cross-tenant reference blocked: %.% -> %', tg_table_name, fkcol, parent using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function public.assert_child_org() from public, anon, authenticated;

do $$
declare r record;
begin
  for r in (values
    ('invoices','invoices_job_org_guard','jobs','job_id'),
    ('payments','payments_invoice_org_guard','invoices','invoice_id'),
    ('messages','messages_customer_org_guard','customers','customer_id'),
    ('messages','messages_job_org_guard','jobs','job_id'),
    ('reviews','reviews_customer_org_guard','customers','customer_id'),
    ('reviews','reviews_job_org_guard','jobs','job_id'),
    ('leads','leads_customer_org_guard','customers','converted_customer_id')
  ) as t(tbl, trg, parent, fkcol) loop
    execute format('drop trigger if exists %I on public.%I;', r.trg, r.tbl);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.assert_child_org(%L, %L);', r.trg, r.tbl, r.parent, r.fkcol);
  end loop;
end $$;

-- =====================================================================
-- End migration 014.
-- =====================================================================

-- ######################## 015_indexes.sql ########################

-- =====================================================================
--  ServicePro — Migration 015 (GO-LIVE performance indexes)
--  Run once in the Supabase SQL Editor, AFTER 014. Safe to re-run.
--
--  Adds indexes on the high-volume access paths the app actually queries,
--  so lists, dashboards, and reports stay fast as data grows.
-- =====================================================================

-- Jobs: status tabs, calendar/route, customer history, tech commission.
create index if not exists idx_jobs_org_status    on public.jobs(organization_id, status)          where deleted_at is null;
create index if not exists idx_jobs_org_customer  on public.jobs(organization_id, customer_id)     where deleted_at is null;
create index if not exists idx_jobs_tech_date     on public.jobs(assigned_to, scheduled_date)      where deleted_at is null;

-- Invoices: due/paid lists, aging, customer history.
create index if not exists idx_invoices_org_status   on public.invoices(organization_id, status)      where deleted_at is null;
create index if not exists idx_invoices_org_customer on public.invoices(organization_id, customer_id) where deleted_at is null;
create index if not exists idx_invoices_org_issue    on public.invoices(organization_id, issue_date);

-- Estimates: pipeline + customer history.
create index if not exists idx_estimates_org_status   on public.estimates(organization_id, status)      where deleted_at is null;
create index if not exists idx_estimates_org_customer on public.estimates(organization_id, customer_id) where deleted_at is null;

-- Payments: reconciliation / accounting export.
create index if not exists idx_payments_org_paid on public.payments(organization_id, paid_at);

-- Messaging inbox: conversations keyed by phone + time.
create index if not exists idx_sms_org_to   on public.sms_messages(organization_id, to_phone);
create index if not exists idx_sms_org_from on public.sms_messages(organization_id, from_phone);

-- Timesheets / commission: entries per technician.
create index if not exists idx_job_time_user on public.job_time_entries(user_id);

-- =====================================================================
-- End migration 015.
-- =====================================================================
