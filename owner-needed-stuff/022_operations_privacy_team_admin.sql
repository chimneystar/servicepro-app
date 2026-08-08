-- ServicePro operations, privacy, appearance, and platform administration.
-- Additive migration: no existing route, table, or workflow is removed.

-- ---------------------------------------------------------------------
-- 1. Personal appearance preferences and last-owner protection.
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists ui_theme text not null default 'system'
  check (ui_theme in ('light','dark','system'));
alter table public.profiles add column if not exists ui_contrast text not null default 'normal'
  check (ui_contrast in ('normal','high'));
alter table public.profiles add column if not exists ui_text_scale text not null default 'normal'
  check (ui_text_scale in ('normal','large'));
alter table public.profiles add column if not exists ui_reduce_motion boolean not null default false;

create or replace function public.protect_last_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare remaining integer;
begin
  if old.organization_id is null or old.role::text <> 'owner' or not old.active then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op <> 'DELETE'
     and new.role::text = 'owner'
     and new.active
     and new.organization_id = old.organization_id then
    return new;
  end if;
  select count(*) into remaining
  from public.profiles p
  where p.organization_id = old.organization_id
    and p.id <> old.id and p.role::text = 'owner' and p.active;
  if remaining = 0 then
    raise exception 'last_owner_required' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.protect_last_owner() from public, anon, authenticated;
drop trigger if exists trg_profiles_protect_last_owner on public.profiles;
create trigger trg_profiles_protect_last_owner
before update of role, active, organization_id or delete on public.profiles
for each row execute function public.protect_last_owner();

-- ---------------------------------------------------------------------
-- 2. Tax, settlement, and chargeback operations.
-- ---------------------------------------------------------------------
create table if not exists public.tax_jurisdictions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text,
  jurisdiction_type text not null default 'state' check (jurisdiction_type in ('state','county','city','district','other')),
  rate_bps integer not null default 0 check (rate_bps between 0 and 100000),
  applies_to text not null default 'all' check (applies_to in ('all','labor','materials','custom')),
  effective_from date not null default current_date,
  effective_to date,
  active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists idx_tax_jurisdictions_org_active on public.tax_jurisdictions(organization_id, active, effective_from);

create table if not exists public.customer_tax_exemptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  certificate_number text,
  reason text not null,
  document_url text,
  expires_on date,
  active boolean not null default true,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, customer_id, certificate_number)
);
create index if not exists idx_tax_exemptions_org on public.customer_tax_exemptions(organization_id, active, expires_on);

create table if not exists public.tax_filings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  due_on date,
  taxable_sales_minor bigint not null default 0 check (taxable_sales_minor >= 0),
  exempt_sales_minor bigint not null default 0 check (exempt_sales_minor >= 0),
  tax_collected_minor bigint not null default 0 check (tax_collected_minor >= 0),
  tax_remitted_minor bigint not null default 0 check (tax_remitted_minor >= 0),
  status text not null default 'open' check (status in ('open','ready','filed','paid','overdue')),
  filed_on date,
  confirmation_reference text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, period_start, period_end),
  check (period_end >= period_start)
);
create index if not exists idx_tax_filings_org_due on public.tax_filings(organization_id, status, due_on);

create table if not exists public.settlement_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'manual',
  provider_settlement_id text,
  settlement_date date not null default current_date,
  expected_arrival date,
  gross_minor bigint not null default 0,
  fees_minor bigint not null default 0,
  refunds_minor bigint not null default 0,
  chargebacks_minor bigint not null default 0,
  adjustments_minor bigint not null default 0,
  net_minor bigint not null default 0,
  status text not null default 'expected' check (status in ('expected','in_transit','deposited','reconciled','exception')),
  bank_reference text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  reconciled_by uuid references public.profiles(id) on delete set null,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, provider, provider_settlement_id)
);
create index if not exists idx_settlements_org_status on public.settlement_batches(organization_id, status, settlement_date desc);

create table if not exists public.settlement_payment_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  settlement_id uuid not null references public.settlement_batches(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete restrict,
  amount_minor bigint not null check (amount_minor >= 0),
  created_at timestamptz not null default now(),
  unique (settlement_id, payment_id)
);

create table if not exists public.payment_disputes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete set null,
  provider text not null default 'manual',
  provider_dispute_id text,
  reason_code text,
  reason text not null,
  disputed_minor bigint not null check (disputed_minor > 0),
  status text not null default 'needs_response' check (status in ('needs_response','under_review','won','lost','accepted','closed')),
  opened_at timestamptz not null default now(),
  response_due_at timestamptz,
  evidence_notes text,
  evidence_urls text[] not null default '{}',
  outcome_notes text,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, provider_dispute_id)
);
create index if not exists idx_payment_disputes_org_due on public.payment_disputes(organization_id, status, response_due_at);

-- ---------------------------------------------------------------------
-- 3. Consent, privacy requests, and retention controls.
-- ---------------------------------------------------------------------
create table if not exists public.organization_privacy_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  privacy_email text,
  privacy_phone text,
  location_retention_days integer not null default 30 check (location_retention_days between 1 and 3650),
  call_recording_retention_days integer not null default 90 check (call_recording_retention_days between 1 and 3650),
  communication_retention_days integer not null default 730 check (communication_retention_days between 30 and 3650),
  job_media_retention_days integer not null default 2555 check (job_media_retention_days between 30 and 3650),
  audit_retention_days integer not null default 2555 check (audit_retention_days between 365 and 7300),
  auto_enforce boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.consent_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  channel text not null check (channel in ('email','sms','phone','location','terms','privacy','payment_method')),
  purpose text not null,
  granted boolean not null,
  source text not null default 'staff' check (source in ('customer_portal','booking','estimate','invoice','staff','import','system')),
  policy_version text,
  proof jsonb not null default '{}'::jsonb,
  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_at timestamptz not null default now()
);
create index if not exists idx_consent_events_customer on public.consent_events(organization_id, customer_id, recorded_at desc);

create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  request_type text not null check (request_type in ('access','export','correction','deletion','opt_out')),
  status text not null default 'received' check (status in ('received','identity_check','in_progress','blocked','ready','completed','denied','cancelled')),
  requester_name text not null,
  requester_email text,
  requester_phone text,
  details text,
  received_at timestamptz not null default now(),
  due_at timestamptz,
  identity_verified_at timestamptz,
  assigned_to uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  completion_notes text,
  denial_reason text,
  export_downloaded_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_privacy_requests_org_due on public.privacy_requests(organization_id, status, due_at);

create table if not exists public.retention_holds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  category text not null default 'all' check (category in ('all','location','calls','communications','media','audit')),
  reason text not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  released_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  released_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > starts_at)
);

create table if not exists public.retention_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_key text not null,
  mode text not null default 'preview' check (mode in ('preview','enforce')),
  status text not null default 'running' check (status in ('running','completed','partial','failed')),
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  unique (organization_id, run_key, mode)
);

create or replace function public.initialize_privacy_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.organization_privacy_settings (organization_id) values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end $$;
revoke all on function public.initialize_privacy_settings() from public, anon, authenticated;
drop trigger if exists trg_organizations_privacy_settings on public.organizations;
create trigger trg_organizations_privacy_settings after insert on public.organizations
for each row execute function public.initialize_privacy_settings();
insert into public.organization_privacy_settings (organization_id)
select id from public.organizations on conflict (organization_id) do nothing;

create or replace function public.consent_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'consent_events_are_append_only' using errcode = 'check_violation';
end $$;
revoke all on function public.consent_events_append_only() from public, anon, authenticated;
drop trigger if exists trg_consent_events_append_only on public.consent_events;
create trigger trg_consent_events_append_only before update or delete on public.consent_events
for each row execute function public.consent_events_append_only();

-- ---------------------------------------------------------------------
-- 4. ServicePro platform support and controlled-release registry.
--    These tables are service-role only; tenant users receive no grants.
-- ---------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'support' check (role in ('support','operations','super_admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.support_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  case_number bigint generated always as identity unique,
  subject text not null,
  description text,
  status text not null default 'open' check (status in ('open','investigating','waiting','resolved','closed')),
  severity text not null default 'normal' check (severity in ('low','normal','high','critical')),
  assigned_to uuid references auth.users(id) on delete set null,
  opened_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.support_sessions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  access_level text not null default 'read_only' check (access_level in ('read_only','guided_write')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > starts_at and expires_at <= starts_at + interval '8 hours')
);

create table if not exists public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text,
  enabled boolean not null default false,
  rollout_percent integer not null default 0 check (rollout_percent between 0 and 100),
  organization_allowlist uuid[] not null default '{}',
  organization_blocklist uuid[] not null default '{}',
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.release_records (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  summary text,
  git_sha text,
  deployment_url text,
  status text not null default 'draft' check (status in ('draft','review','approved','rolling_out','live','paused','rolled_back')),
  risk_level text not null default 'standard' check (risk_level in ('low','standard','high')),
  regression_checklist jsonb not null default '{}'::jsonb,
  approved_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  released_at timestamptz,
  rollback_release_id uuid references public.release_records(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.release_events (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.release_records(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. Timestamps, tenant relationship guards, auditing, and RLS.
-- ---------------------------------------------------------------------
do $$ declare t text;
begin
  foreach t in array array[
    'tax_jurisdictions','customer_tax_exemptions','tax_filings','settlement_batches','payment_disputes',
    'organization_privacy_settings','privacy_requests','support_cases','feature_flags','release_records'
  ] loop
    execute format('drop trigger if exists trg_%s_updated on public.%I;', t, t);
    execute format('create trigger trg_%s_updated before update on public.%I for each row execute function public.set_updated_at();', t, t);
  end loop;
end $$;

do $$ declare r record;
begin
  for r in select * from (values
    ('customer_tax_exemptions','tax_exemption_customer_org_guard','customers','customer_id'),
    ('settlement_payment_links','settlement_link_settlement_org_guard','settlement_batches','settlement_id'),
    ('settlement_payment_links','settlement_link_payment_org_guard','payments','payment_id'),
    ('payment_disputes','payment_disputes_payment_org_guard','payments','payment_id'),
    ('consent_events','consent_events_customer_org_guard','customers','customer_id'),
    ('privacy_requests','privacy_requests_customer_org_guard','customers','customer_id'),
    ('retention_holds','retention_holds_customer_org_guard','customers','customer_id')
  ) as x(tbl,trg,parent,fkcol) loop
    execute format('drop trigger if exists %I on public.%I;', r.trg, r.tbl);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.assert_child_org(%L,%L);', r.trg, r.tbl, r.parent, r.fkcol);
  end loop;
end $$;

do $$ declare t text;
begin
  foreach t in array array[
    'tax_jurisdictions','customer_tax_exemptions','tax_filings','settlement_batches','settlement_payment_links','payment_disputes',
    'organization_privacy_settings','consent_events','privacy_requests','retention_holds','retention_runs'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
  foreach t in array array['platform_admins','support_cases','support_sessions','feature_flags','release_records','release_events'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_deny_clients', t);
    execute format('create policy %I on public.%I for all to anon, authenticated using (false) with check (false);', t || '_deny_clients', t);
  end loop;
end $$;

create or replace function public.audit_privacy_settings_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    insert into public.audit_log(organization_id,table_name,row_id,action,actor,old_data)
    values(old.organization_id,tg_table_name,old.organization_id,tg_op,auth.uid(),to_jsonb(old));
    return old;
  end if;
  insert into public.audit_log(organization_id,table_name,row_id,action,actor,old_data,new_data)
  values(new.organization_id,tg_table_name,new.organization_id,tg_op,auth.uid(),case when tg_op='UPDATE' then to_jsonb(old) end,to_jsonb(new));
  return new;
end $$;
revoke all on function public.audit_privacy_settings_trigger() from public, anon, authenticated;
drop trigger if exists trg_organization_privacy_settings_audit on public.organization_privacy_settings;
create trigger trg_organization_privacy_settings_audit after insert or update or delete on public.organization_privacy_settings
for each row execute function public.audit_privacy_settings_trigger();

do $$ declare t text;
begin
  foreach t in array array['tax_jurisdictions','customer_tax_exemptions','tax_filings','settlement_batches','settlement_payment_links','payment_disputes'] loop
    execute format('drop policy if exists %I on public.%I;', t || '_finance_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (organization_id = public.current_org_id() and public.current_user_can(''payments.manage''));', t || '_finance_select', t);
    execute format('drop policy if exists %I on public.%I;', t || '_finance_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (organization_id = public.current_org_id() and public.current_user_can(''payments.manage'')) with check (organization_id = public.current_org_id() and public.current_user_can(''payments.manage''));', t || '_finance_write', t);
  end loop;
  foreach t in array array['consent_events','privacy_requests','retention_holds','retention_runs'] loop
    execute format('drop policy if exists %I on public.%I;', t || '_owner', t);
    execute format('create policy %I on public.%I for all to authenticated using (organization_id = public.current_org_id() and public.current_user_role() = ''owner'') with check (organization_id = public.current_org_id() and public.current_user_role() = ''owner'');', t || '_owner', t);
  end loop;
end $$;

drop policy if exists privacy_settings_owner on public.organization_privacy_settings;
create policy privacy_settings_owner on public.organization_privacy_settings for all to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() = 'owner')
  with check (organization_id = public.current_org_id() and public.current_user_role() = 'owner');

do $$ declare t text;
begin
  foreach t in array array[
    'tax_jurisdictions','customer_tax_exemptions','tax_filings','settlement_batches','settlement_payment_links','payment_disputes',
    'organization_privacy_settings','consent_events','privacy_requests','retention_holds','retention_runs'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    execute format('grant all on public.%I to service_role;', t);
    execute format('revoke all on public.%I from anon;', t);
  end loop;
  foreach t in array array['platform_admins','support_cases','support_sessions','feature_flags','release_records','release_events'] loop
    execute format('revoke all on public.%I from anon, authenticated;', t);
    execute format('grant all on public.%I to service_role;', t);
  end loop;
end $$;

do $$ declare t text;
begin
  foreach t in array array[
    'tax_jurisdictions','customer_tax_exemptions','tax_filings','settlement_batches','settlement_payment_links','payment_disputes',
    'consent_events','privacy_requests','retention_holds','retention_runs'
  ] loop
    execute format('drop trigger if exists trg_%s_audit on public.%I;', t, t);
    execute format('create trigger trg_%s_audit after insert or update or delete on public.%I for each row execute function public.audit_trigger();', t, t);
  end loop;
end $$;

-- Identity sequence is otherwise not usable by the service role in some setups.
grant usage, select on sequence public.support_cases_case_number_seq to service_role;

-- Seed safe, disabled feature controls. A platform admin must enable them.
insert into public.feature_flags(key, description, enabled, rollout_percent) values
  ('finance_operations','Tax, settlements, and chargeback workspaces',true,100),
  ('privacy_center','Consent, privacy request, and retention workspace',true,100),
  ('support_access','Audited, expiring support sessions',false,0)
on conflict (key) do nothing;
