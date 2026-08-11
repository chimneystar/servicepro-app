-- =====================================================================
--  ServicePro — Migration 007 (v9 batch)
--  Run once in the Supabase SQL Editor, AFTER 006.
--
--  Adds:
--    1. Job (service) address + customer billing address
--    2. Customizable client message templates (booked / day-before / on-the-way / completed)
--    3. Job line items  (Items tab)
--    4. Job tasks       (Tasks tab)
--    5. Job checklist   (Checklists tab)
--    6. Job equipment   (Equipment tab)
--    7. Manual-payment columns on payments (Payments tab)
--
--  Safe to re-run: everything uses "if not exists" / re-creatable policies.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Addresses
-- ---------------------------------------------------------------------
alter table public.jobs      add column if not exists job_address text;
alter table public.jobs      add column if not exists job_city    text;
alter table public.customers add column if not exists billing_address text;
alter table public.customers add column if not exists billing_city    text;

-- ---------------------------------------------------------------------
-- 2. Message templates (client automations you can customize)
-- ---------------------------------------------------------------------
create table if not exists public.message_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  trigger          text not null check (trigger in ('booked','day_before','on_the_way','completed')),
  enabled          boolean not null default true,
  body             text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, trigger)
);
create index if not exists idx_message_templates_org on public.message_templates(organization_id);

alter table public.message_templates enable row level security;
drop policy if exists message_templates_select on public.message_templates;
create policy message_templates_select on public.message_templates for select
  using (organization_id = public.current_org_id());
drop policy if exists message_templates_write on public.message_templates;
create policy message_templates_write on public.message_templates for all
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))
  with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));

-- Seed sensible defaults for every org that has none yet.
insert into public.message_templates (organization_id, trigger, enabled, body)
select o.id, d.trigger, d.enabled, d.body
from public.organizations o
cross join (values
  ('booked',      true,  'Hi {name}, your {service} appointment is booked for {date} at {time}. — {business}'),
  ('day_before',  true,  'Reminder: your {service} appointment is tomorrow, {date} at {time}. Reply to reschedule. — {business}'),
  ('on_the_way',  true,  'Hi {name}, your technician is on the way for your {service} appointment. — {business}'),
  ('completed',   false, 'Thanks {name}! Your {service} job is complete. We''d love a quick review. — {business}')
) as d(trigger, enabled, body)
where not exists (
  select 1 from public.message_templates m
  where m.organization_id = o.id and m.trigger = d.trigger
);

-- ---------------------------------------------------------------------
-- 3. Job line items (Items tab)
-- ---------------------------------------------------------------------
create table if not exists public.job_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  job_id           uuid not null references public.jobs(id) on delete cascade,
  description      text not null,
  qty_milli        bigint not null default 1000 check (qty_milli >= 0),
  unit_price_minor bigint not null default 0 check (unit_price_minor >= 0),
  cost_minor       bigint not null default 0 check (cost_minor >= 0),
  sort             integer not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_job_items_job on public.job_items(job_id);

-- ---------------------------------------------------------------------
-- 4. Job tasks (Tasks tab)
-- ---------------------------------------------------------------------
create table if not exists public.job_tasks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  job_id           uuid not null references public.jobs(id) on delete cascade,
  title            text not null,
  done             boolean not null default false,
  sort             integer not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_job_tasks_job on public.job_tasks(job_id);

-- ---------------------------------------------------------------------
-- 5. Job checklist (Checklists tab)
-- ---------------------------------------------------------------------
create table if not exists public.job_checklist_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  job_id           uuid not null references public.jobs(id) on delete cascade,
  label            text not null,
  checked          boolean not null default false,
  sort             integer not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_job_checklist_job on public.job_checklist_items(job_id);

-- ---------------------------------------------------------------------
-- 6. Job equipment (Equipment tab)
-- ---------------------------------------------------------------------
create table if not exists public.job_equipment (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  job_id           uuid not null references public.jobs(id) on delete cascade,
  name             text not null,
  serial           text,
  notes            text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_job_equipment_job on public.job_equipment(job_id);

-- RLS for the four job-scoped tables: anyone in the org can read;
-- owner/office/tech can all write (techs do the field work).
do $$
declare tbl text;
begin
  foreach tbl in array array['job_items','job_tasks','job_checklist_items','job_equipment'] loop
    execute format('alter table public.%I enable row level security;', tbl);
    execute format('drop policy if exists %1$s_select on public.%1$I;', tbl);
    execute format('create policy %1$s_select on public.%1$I for select using (organization_id = public.current_org_id());', tbl);
    execute format('drop policy if exists %1$s_write on public.%1$I;', tbl);
    execute format('create policy %1$s_write on public.%1$I for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());', tbl);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7. Manual payment recording (Payments tab)
-- ---------------------------------------------------------------------
alter table public.payments add column if not exists method     text;
alter table public.payments add column if not exists note       text;
alter table public.payments add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- =====================================================================
-- End migration 007 (v9).
-- =====================================================================
