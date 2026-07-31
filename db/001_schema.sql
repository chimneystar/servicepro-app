-- =====================================================================
--  ServicePro — Production database schema v2 (PostgreSQL / Supabase)
--
--  Internationalized: each organization has locale (en/he), currency
--  (USD/ILS/EUR) and its own tax rate + label (US "Sales Tax" or IL "VAT").
--
--  Hardened for correctness & reliability:
--   * MONEY is stored as INTEGER minor units (cents / agorot, 1 unit = 100).
--     No floating point, ever. Quantities are integer milliunits (qty*1000).
--     Tax is basis points (8.25% = 825; 18% = 1800). Mirrors the tested engine.
--   * DOUBLE-BOOKING IS IMPOSSIBLE: a database EXCLUSION CONSTRAINT rejects
--     any two active jobs for the same technician whose time ranges overlap.
--   * APPOINTMENTS NEVER DISAPPEAR: jobs are never hard-deleted (no delete
--     policy) — they are cancelled or soft-deleted, and every change is
--     written to audit_log by a trigger.
--   * Multi-tenant isolation via Row-Level Security on every table.
--   * Tables for Stripe (subscriptions + invoice payments), SMS, email,
--     team invitations, and idempotent webhook processing.
--
--  Run once in the Supabase SQL Editor.
-- =====================================================================

create extension if not exists pgcrypto;    -- gen_random_uuid()
create extension if not exists btree_gist;   -- required for the no-double-book constraint

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin create type user_role       as enum ('owner','office','tech'); exception when duplicate_object then null; end $$;
do $$ begin create type job_status      as enum ('scheduled','in_progress','done','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type estimate_status as enum ('draft','sent','approved','rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type invoice_status  as enum ('unpaid','paid','void'); exception when duplicate_object then null; end $$;
do $$ begin create type message_type    as enum ('before','onway','after','review','manual'); exception when duplicate_object then null; end $$;
do $$ begin create type sub_status      as enum ('trialing','active','past_due','canceled','incomplete'); exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------
create table if not exists public.organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) > 0),
  tagline          text,
  logo_url         text,
  address          text,
  city             text,
  phone            text,
  email            text,
  business_id      text,
  locale           text not null default 'en'  check (locale in ('en','he')),
  currency         text not null default 'USD' check (currency in ('USD','ILS','EUR')),
  tax_label        text not null default 'Sales Tax',   -- e.g. 'Sales Tax' (US) or 'VAT' / 'מע"מ' (IL)
  tax_rate_bps     integer not null default 0 check (tax_rate_bps between 0 and 100000),
  terms            text,
  invoice_counter  integer not null default 5000,
  estimate_counter integer not null default 1000,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  organization_id  uuid references public.organizations(id) on delete cascade,
  full_name        text not null default '',
  phone            text,
  role             user_role not null default 'owner',
  color            text default '#2563eb',
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_profiles_org on public.profiles(organization_id);

create table if not exists public.customers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  phone            text not null,
  email            text,
  address          text,
  city             text,
  source           text,
  notes            text,
  created_by       uuid references public.profiles(id) on delete set null,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_customers_org  on public.customers(organization_id) where deleted_at is null;
create index if not exists idx_customers_name on public.customers(organization_id, name);

create table if not exists public.jobs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  customer_id      uuid not null references public.customers(id) on delete restrict,
  assigned_to      uuid references public.profiles(id) on delete set null,
  service          text not null,
  status           job_status not null default 'scheduled',
  price_minor     bigint not null default 0 check (price_minor >= 0),
  scheduled_date   date not null,
  start_time       time,
  end_time         time,
  source           text,
  notes            text,
  created_by       uuid references public.profiles(id) on delete set null,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (end_time is null or start_time is null or end_time > start_time),
  -- immutable local-time range used by the no-double-book constraint
  slot tsrange generated always as (
    case
      when start_time is not null and end_time is not null
      then tsrange((scheduled_date + start_time)::timestamp,
                   (scheduled_date + end_time)::timestamp, '[)')
      else null
    end
  ) stored
);
create index if not exists idx_jobs_org      on public.jobs(organization_id) where deleted_at is null;
create index if not exists idx_jobs_date     on public.jobs(organization_id, scheduled_date);
create index if not exists idx_jobs_customer on public.jobs(customer_id);
create index if not exists idx_jobs_assigned on public.jobs(assigned_to);

-- >>> The database physically cannot double-book a technician <<<
alter table public.jobs drop constraint if exists jobs_no_double_book;
alter table public.jobs add constraint jobs_no_double_book
  exclude using gist (organization_id with =, assigned_to with =, slot with &&)
  where (status <> 'cancelled' and deleted_at is null and assigned_to is not null and slot is not null);

create table if not exists public.job_photos (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  job_id           uuid not null references public.jobs(id) on delete cascade,
  storage_path     text not null,
  label            text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_job_photos_job on public.job_photos(job_id);

create table if not exists public.estimates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  number           integer not null,
  customer_id      uuid not null references public.customers(id) on delete restrict,
  status           estimate_status not null default 'draft',
  discount_minor  bigint not null default 0 check (discount_minor >= 0),
  tax_rate_bps     integer not null default 0 check (tax_rate_bps between 0 and 100000),
  total_minor     bigint not null default 0 check (total_minor >= 0),  -- cached, set by server from tested engine
  notes            text,
  issue_date       date not null default current_date,
  created_by       uuid references public.profiles(id) on delete set null,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, number)
);
create index if not exists idx_estimates_org on public.estimates(organization_id);

create table if not exists public.estimate_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  estimate_id      uuid not null references public.estimates(id) on delete cascade,
  description      text not null,
  qty_milli        bigint not null default 1000 check (qty_milli >= 0),
  unit_price_minor bigint not null default 0 check (unit_price_minor >= 0),
  sort             integer not null default 0
);
create index if not exists idx_estimate_items_parent on public.estimate_items(estimate_id);

create table if not exists public.invoices (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  number           integer not null,
  customer_id      uuid not null references public.customers(id) on delete restrict,
  job_id           uuid references public.jobs(id) on delete set null,
  status           invoice_status not null default 'unpaid',
  method           text,
  discount_minor  bigint not null default 0 check (discount_minor >= 0),
  tax_rate_bps     integer not null default 0 check (tax_rate_bps between 0 and 100000),
  total_minor     bigint not null default 0 check (total_minor >= 0),
  notes            text,
  issue_date       date not null default current_date,
  paid_at          timestamptz,
  deleted_at       timestamptz,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, number)
);
create index if not exists idx_invoices_org      on public.invoices(organization_id);
create index if not exists idx_invoices_customer on public.invoices(customer_id);

create table if not exists public.invoice_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  invoice_id       uuid not null references public.invoices(id) on delete cascade,
  description      text not null,
  qty_milli        bigint not null default 1000 check (qty_milli >= 0),
  unit_price_minor bigint not null default 0 check (unit_price_minor >= 0),
  sort             integer not null default 0
);
create index if not exists idx_invoice_items_parent on public.invoice_items(invoice_id);

create table if not exists public.expenses (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  expense_date     date not null default current_date,
  category         text not null,
  vendor           text,
  amount_minor    bigint not null default 0 check (amount_minor >= 0),
  notes            text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_expenses_org on public.expenses(organization_id, expense_date);

create table if not exists public.price_book (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  category         text,
  unit             text default 'יחידה',
  price_minor     bigint not null default 0 check (price_minor >= 0),
  created_at       timestamptz not null default now()
);
create index if not exists idx_price_book_org on public.price_book(organization_id);

create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  customer_id      uuid references public.customers(id) on delete set null,
  job_id           uuid references public.jobs(id) on delete set null,
  type             message_type not null default 'manual',
  body             text not null,
  status           text not null default 'sent',
  sent_at          timestamptz not null default now()
);
create index if not exists idx_messages_org on public.messages(organization_id, sent_at);

create table if not exists public.reviews (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  customer_id      uuid references public.customers(id) on delete set null,
  job_id           uuid references public.jobs(id) on delete set null,
  rating           smallint not null check (rating between 1 and 5),
  body             text,
  review_date      date not null default current_date
);
create index if not exists idx_reviews_org on public.reviews(organization_id);

-- ---------------------------------------------------------------------
-- Integration & operations tables
-- ---------------------------------------------------------------------
-- SaaS subscription (you charge the business to use the app)
create table if not exists public.subscriptions (
  organization_id       uuid primary key references public.organizations(id) on delete cascade,
  stripe_customer_id    text,
  stripe_subscription_id text,
  plan                  text,
  status                sub_status not null default 'trialing',
  trial_end             timestamptz,
  current_period_end    timestamptz,
  updated_at            timestamptz not null default now()
);

-- Payments made by a customer against an invoice (Stripe)
create table if not exists public.payments (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations(id) on delete cascade,
  invoice_id              uuid references public.invoices(id) on delete set null,
  stripe_payment_intent_id text unique,
  amount_minor           bigint not null check (amount_minor >= 0),
  currency                text not null default 'USD',
  status                  text not null default 'requires_payment',
  paid_at                 timestamptz,
  created_at              timestamptz not null default now()
);
create index if not exists idx_payments_invoice on public.payments(invoice_id);

-- Team invitations
create table if not exists public.invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  email            text not null,
  role             user_role not null default 'tech',
  token            text not null unique,
  invited_by       uuid references public.profiles(id) on delete set null,
  expires_at       timestamptz not null default (now() + interval '7 days'),
  accepted_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_invitations_org on public.invitations(organization_id);

-- Outbound SMS log
create table if not exists public.sms_messages (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  customer_id         uuid references public.customers(id) on delete set null,
  job_id              uuid references public.jobs(id) on delete set null,
  to_phone            text not null,
  body                text not null,
  provider            text,
  provider_message_id text,
  status              text not null default 'queued',
  error               text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);
create index if not exists idx_sms_org on public.sms_messages(organization_id, created_at);

-- Outbound email log
create table if not exists public.email_messages (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  related_type        text,
  related_id          uuid,
  to_email            text not null,
  subject             text,
  provider            text,
  provider_message_id text,
  status              text not null default 'queued',
  error               text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);
create index if not exists idx_email_org on public.email_messages(organization_id, created_at);

-- Webhook idempotency (never process the same provider event twice)
create table if not exists public.webhook_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  event_id     text not null,
  payload      jsonb,
  received_at  timestamptz not null default now(),
  unique (provider, event_id)
);

-- Audit log — nothing important changes without a trail
create table if not exists public.audit_log (
  id               bigint generated always as identity primary key,
  organization_id  uuid,
  table_name       text not null,
  row_id           uuid,
  action           text not null,
  actor            uuid,
  old_data         jsonb,
  new_data         jsonb,
  at               timestamptz not null default now()
);
create index if not exists idx_audit_org on public.audit_log(organization_id, at);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['organizations','profiles','customers','jobs','estimates','invoices','subscriptions'] loop
    execute format('drop trigger if exists trg_%s_updated on public.%I;', t, t);
    execute format('create trigger trg_%s_updated before update on public.%I for each row execute function public.set_updated_at();', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Generic audit trigger
-- ---------------------------------------------------------------------
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare org uuid; rid uuid;
begin
  if (tg_op = 'DELETE') then
    org := old.organization_id; rid := old.id;
    insert into public.audit_log(organization_id, table_name, row_id, action, actor, old_data)
      values (org, tg_table_name, rid, tg_op, auth.uid(), to_jsonb(old));
    return old;
  else
    org := new.organization_id; rid := new.id;
    insert into public.audit_log(organization_id, table_name, row_id, action, actor, old_data, new_data)
      values (org, tg_table_name, rid, tg_op, auth.uid(),
              case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new));
    return new;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['jobs','invoices','estimates','customers'] loop
    execute format('drop trigger if exists trg_%s_audit on public.%I;', t, t);
    execute format('create trigger trg_%s_audit after insert or update or delete on public.%I for each row execute function public.audit_trigger();', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Security helper functions
-- ---------------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_user_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.create_org_and_owner(org_name text, owner_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_org uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and organization_id is not null) then
    raise exception 'user already belongs to an organization';
  end if;
  insert into public.organizations (name) values (coalesce(nullif(trim(org_name),''),'העסק שלי')) returning id into new_org;
  insert into public.profiles (id, organization_id, full_name, role)
    values (auth.uid(), new_org, coalesce(nullif(trim(owner_name),''),''), 'owner')
    on conflict (id) do update set organization_id = excluded.organization_id, full_name = excluded.full_name, role = 'owner';
  insert into public.subscriptions (organization_id, status, trial_end)
    values (new_org, 'trialing', now() + interval '14 days')
    on conflict (organization_id) do nothing;
  return new_org;
end $$;

create or replace function public.next_document_number(p_org uuid, p_kind text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_org <> public.current_org_id() then raise exception 'forbidden'; end if;
  if p_kind = 'invoice' then
    update public.organizations set invoice_counter = invoice_counter + 1 where id = p_org returning invoice_counter into n;
  elsif p_kind = 'estimate' then
    update public.organizations set estimate_counter = estimate_counter + 1 where id = p_org returning estimate_counter into n;
  else raise exception 'unknown document kind'; end if;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------
alter table public.organizations  enable row level security;
alter table public.profiles        enable row level security;
alter table public.customers       enable row level security;
alter table public.jobs            enable row level security;
alter table public.job_photos      enable row level security;
alter table public.estimates       enable row level security;
alter table public.estimate_items  enable row level security;
alter table public.invoices        enable row level security;
alter table public.invoice_items   enable row level security;
alter table public.expenses        enable row level security;
alter table public.price_book      enable row level security;
alter table public.messages        enable row level security;
alter table public.reviews         enable row level security;
alter table public.subscriptions   enable row level security;
alter table public.payments        enable row level security;
alter table public.invitations     enable row level security;
alter table public.sms_messages    enable row level security;
alter table public.email_messages  enable row level security;
alter table public.webhook_events  enable row level security;   -- no policies => service-role only
alter table public.audit_log       enable row level security;

-- Organizations
drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations for select using (id = public.current_org_id());
drop policy if exists org_update on public.organizations;
create policy org_update on public.organizations for update
  using (id = public.current_org_id() and public.current_user_role() = 'owner')
  with check (id = public.current_org_id() and public.current_user_role() = 'owner');

-- Profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (organization_id = public.current_org_id());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid() and organization_id = public.current_org_id());
drop policy if exists profiles_owner_write on public.profiles;
create policy profiles_owner_write on public.profiles for all
  using (organization_id = public.current_org_id() and public.current_user_role() = 'owner')
  with check (organization_id = public.current_org_id() and public.current_user_role() = 'owner');

-- Audit log: readable by owner/office within org; writes are trigger-only (definer).
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));

-- Subscriptions & payments & invitations: owner/office of the org
do $$
declare tbl text;
begin
  foreach tbl in array array['subscriptions','payments','invitations'] loop
    execute format('drop policy if exists %1$s_rw on public.%1$I;', tbl);
    execute format('create policy %1$s_rw on public.%1$I for all using (organization_id = public.current_org_id() and public.current_user_role() in (''owner'',''office'')) with check (organization_id = public.current_org_id() and public.current_user_role() in (''owner'',''office''));', tbl);
  end loop;
end $$;

-- SMS/email logs: any org member may read; inserts happen server-side
do $$
declare tbl text;
begin
  foreach tbl in array array['sms_messages','email_messages'] loop
    execute format('drop policy if exists %1$s_select on public.%1$I;', tbl);
    execute format('create policy %1$s_select on public.%1$I for select using (organization_id = public.current_org_id());', tbl);
    execute format('drop policy if exists %1$s_insert on public.%1$I;', tbl);
    execute format('create policy %1$s_insert on public.%1$I for insert with check (organization_id = public.current_org_id());', tbl);
  end loop;
end $$;

-- Member tables: any org member select/insert/update; delete = owner/office
do $$
declare
  tbl text;
  member_tables text[] := array['customers','job_photos','messages','reviews','price_book'];
  finance_tables text[] := array['estimates','estimate_items','invoices','invoice_items','expenses'];
begin
  foreach tbl in array member_tables loop
    execute format('drop policy if exists %1$s_select on public.%1$I;', tbl);
    execute format('create policy %1$s_select on public.%1$I for select using (organization_id = public.current_org_id());', tbl);
    execute format('drop policy if exists %1$s_insert on public.%1$I;', tbl);
    execute format('create policy %1$s_insert on public.%1$I for insert with check (organization_id = public.current_org_id());', tbl);
    execute format('drop policy if exists %1$s_update on public.%1$I;', tbl);
    execute format('create policy %1$s_update on public.%1$I for update using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());', tbl);
    execute format('drop policy if exists %1$s_delete on public.%1$I;', tbl);
    execute format('create policy %1$s_delete on public.%1$I for delete using (organization_id = public.current_org_id() and public.current_user_role() in (''owner'',''office''));', tbl);
  end loop;
  foreach tbl in array finance_tables loop
    execute format('drop policy if exists %1$s_select on public.%1$I;', tbl);
    execute format('create policy %1$s_select on public.%1$I for select using (organization_id = public.current_org_id() and public.current_user_role() in (''owner'',''office''));', tbl);
    execute format('drop policy if exists %1$s_write on public.%1$I;', tbl);
    execute format('create policy %1$s_write on public.%1$I for all using (organization_id = public.current_org_id() and public.current_user_role() in (''owner'',''office'')) with check (organization_id = public.current_org_id() and public.current_user_role() in (''owner'',''office''));', tbl);
  end loop;
end $$;

-- Jobs: technicians limited to their own; NO delete policy (jobs never vanish —
-- cancel or soft-delete via update only).
drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs for select
  using (organization_id = public.current_org_id()
         and (public.current_user_role() in ('owner','office') or assigned_to = auth.uid()));
drop policy if exists jobs_insert on public.jobs;
create policy jobs_insert on public.jobs for insert
  with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));
drop policy if exists jobs_update on public.jobs;
create policy jobs_update on public.jobs for update
  using (organization_id = public.current_org_id()
         and (public.current_user_role() in ('owner','office') or assigned_to = auth.uid()))
  with check (organization_id = public.current_org_id());
-- (intentionally no jobs delete policy)

-- =====================================================================
-- End of schema v2.
-- =====================================================================
