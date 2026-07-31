-- =====================================================================
--  ServicePro — Migration 009 (v11 batch)
--  Run once in the Supabase SQL Editor, AFTER 008.
--
--  Adds:
--    1. Leads + online booking (public request form -> lead pipeline)
--    2. Tech field tools: job timestamps, time tracking, completion signature
--    3. Estimate deposits + invoice online-payment flag
--    4. Public functions for the booking page (anon)
--
--  Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Leads (online booking + sales pipeline)
-- ---------------------------------------------------------------------
create table if not exists public.leads (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  name                  text not null check (length(trim(name)) > 0),
  phone                 text,
  email                 text,
  address               text,
  city                  text,
  service               text,
  notes                 text,
  status                text not null default 'new' check (status in ('new','contacted','quoted','won','lost')),
  source                text default 'Online booking',
  preferred_date        date,
  converted_customer_id uuid references public.customers(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_leads_org on public.leads(organization_id, status);

alter table public.leads enable row level security;
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select
  using (organization_id = public.current_org_id());
drop policy if exists leads_write on public.leads;
create policy leads_write on public.leads for all
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))
  with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));

-- Public: minimal org branding for the booking page (anon).
create or replace function public.public_booking_info(p_org uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select name, tagline, logo_url, accent_color, phone, email into o from public.organizations where id = p_org;
  if not found then return null; end if;
  return jsonb_build_object('name', o.name, 'tagline', o.tagline, 'logo_url', o.logo_url,
                            'accent_color', o.accent_color, 'phone', o.phone, 'email', o.email);
end $$;
grant execute on function public.public_booking_info(uuid) to anon, authenticated;

-- Public: a prospect submits a booking request -> creates a lead (anon).
create or replace function public.submit_booking(
  p_org uuid, p_name text, p_phone text, p_email text,
  p_address text, p_city text, p_service text, p_notes text, p_date date
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.organizations where id = p_org) then return false; end if;
  if coalesce(trim(p_name),'') = '' then return false; end if;
  insert into public.leads (organization_id, name, phone, email, address, city, service, notes, preferred_date, source, status)
  values (p_org, left(trim(p_name),120), left(coalesce(p_phone,''),40), left(coalesce(p_email,''),160),
          left(coalesce(p_address,''),200), left(coalesce(p_city,''),80), left(coalesce(p_service,''),120),
          left(coalesce(p_notes,''),2000), p_date, 'Online booking', 'new');
  return true;
end $$;
grant execute on function public.submit_booking(uuid, text, text, text, text, text, text, text, date) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Tech field tools
-- ---------------------------------------------------------------------
alter table public.jobs add column if not exists on_my_way_at        timestamptz;
alter table public.jobs add column if not exists started_at          timestamptz;
alter table public.jobs add column if not exists completed_at        timestamptz;
alter table public.jobs add column if not exists completion_signature text;
alter table public.jobs add column if not exists completion_signed_by text;

create table if not exists public.job_time_entries (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  job_id           uuid not null references public.jobs(id) on delete cascade,
  user_id          uuid references public.profiles(id) on delete set null,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_time_entries_job on public.job_time_entries(job_id);

alter table public.job_time_entries enable row level security;
drop policy if exists time_entries_select on public.job_time_entries;
create policy time_entries_select on public.job_time_entries for select
  using (organization_id = public.current_org_id());
drop policy if exists time_entries_write on public.job_time_entries;
create policy time_entries_write on public.job_time_entries for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

-- ---------------------------------------------------------------------
-- 3. Deposits + online payment flags
-- ---------------------------------------------------------------------
alter table public.estimates add column if not exists deposit_minor bigint not null default 0 check (deposit_minor >= 0);
alter table public.invoices  add column if not exists paid_online   boolean not null default false;
alter table public.invoices  add column if not exists stripe_session_id text;

-- =====================================================================
-- End migration 009 (v11).
-- =====================================================================
