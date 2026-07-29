-- =====================================================================
--  ServicePro — Migration 011 (v14 batch: recurring + reminders + reviews)
--  Run once in the Supabase SQL Editor, AFTER 010. Safe to re-run.
--
--  Adds:
--    1. Recurring maintenance plans (auto-repeat annual jobs)
--    2. reminder_log — so an automated reminder is never sent twice
--    3. organizations.review_url + onboarding_dismissed
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Recurring maintenance plans
-- ---------------------------------------------------------------------
create table if not exists public.recurring_plans (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  customer_id      uuid not null references public.customers(id) on delete cascade,
  service          text not null,
  interval_months  integer not null default 12 check (interval_months between 1 and 60),
  price_minor      bigint not null default 0 check (price_minor >= 0),
  assigned_to      uuid references public.profiles(id) on delete set null,
  next_due         date not null default current_date,
  active           boolean not null default true,
  notes            text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_recurring_org on public.recurring_plans(organization_id, next_due) where active;

alter table public.recurring_plans enable row level security;
drop policy if exists recurring_select on public.recurring_plans;
create policy recurring_select on public.recurring_plans for select
  using (organization_id = public.current_org_id());
drop policy if exists recurring_write on public.recurring_plans;
create policy recurring_write on public.recurring_plans for all
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))
  with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));

-- ---------------------------------------------------------------------
-- 2. Reminder log (idempotency for automated messages)
-- ---------------------------------------------------------------------
create table if not exists public.reminder_log (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  kind             text not null,            -- 'appointment' | 'overdue' | 'review'
  ref_id           uuid not null,            -- job or invoice id
  sent_on          date not null default current_date,
  created_at       timestamptz not null default now(),
  unique (kind, ref_id, sent_on)
);
create index if not exists idx_reminder_org on public.reminder_log(organization_id, sent_on);
alter table public.reminder_log enable row level security;
drop policy if exists reminder_select on public.reminder_log;
create policy reminder_select on public.reminder_log for select using (organization_id = public.current_org_id());

-- ---------------------------------------------------------------------
-- 3. Organization settings: review link + onboarding state
-- ---------------------------------------------------------------------
alter table public.organizations add column if not exists review_url           text;
alter table public.organizations add column if not exists onboarding_dismissed  boolean not null default false;

-- =====================================================================
-- End migration 011 (v14).
-- =====================================================================
