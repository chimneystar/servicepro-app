-- ServicePro product foundation: permissions, onboarding catalogs, devices.
-- Additive migration. Existing CRM tables and workflows are preserved.

create table if not exists public.profile_capabilities (
  profile_id              uuid primary key references public.profiles(id) on delete cascade,
  organization_id         uuid not null references public.organizations(id) on delete cascade,
  can_view_customers      boolean not null default false,
  can_edit_customers      boolean not null default false,
  can_manage_schedule     boolean not null default false,
  can_edit_jobs           boolean not null default false,
  can_manage_estimates    boolean not null default false,
  can_manage_invoices     boolean not null default false,
  can_manage_payments     boolean not null default false,
  can_view_reports        boolean not null default false,
  can_manage_purchasing   boolean not null default false,
  can_manage_automations  boolean not null default false,
  can_manage_settings     boolean not null default false,
  can_manage_team         boolean not null default false,
  updated_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (profile_id, organization_id)
);
create index if not exists idx_profile_capabilities_org on public.profile_capabilities(organization_id);

insert into public.profile_capabilities (
  profile_id, organization_id,
  can_view_customers, can_edit_customers, can_manage_schedule, can_edit_jobs,
  can_manage_estimates, can_manage_invoices, can_manage_payments, can_view_reports,
  can_manage_purchasing, can_manage_automations, can_manage_settings, can_manage_team
)
select p.id, p.organization_id,
  true,
  p.role in ('owner','office'),
  p.role in ('owner','office'),
  true,
  p.role in ('owner','office'),
  p.role in ('owner','office'),
  p.role in ('owner','office'),
  p.role in ('owner','office'),
  p.role in ('owner','office'),
  p.role in ('owner','office'),
  p.role = 'owner',
  p.role = 'owner'
from public.profiles p
where p.organization_id is not null
on conflict (profile_id) do nothing;

create or replace function public.current_user_can(p_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_access public.profile_capabilities;
begin
  if auth.uid() is null then return false; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role = 'owner' then return true; end if;
  select * into v_access from public.profile_capabilities where profile_id = auth.uid();
  if not found then return false; end if;
  return case p_capability
    when 'customers.view' then v_access.can_view_customers
    when 'customers.edit' then v_access.can_edit_customers
    when 'schedule.manage' then v_access.can_manage_schedule
    when 'jobs.edit' then v_access.can_edit_jobs
    when 'estimates.manage' then v_access.can_manage_estimates
    when 'invoices.manage' then v_access.can_manage_invoices
    when 'payments.manage' then v_access.can_manage_payments
    when 'reports.view' then v_access.can_view_reports
    when 'purchasing.manage' then v_access.can_manage_purchasing
    when 'automations.manage' then v_access.can_manage_automations
    when 'settings.manage' then v_access.can_manage_settings
    when 'team.manage' then v_access.can_manage_team
    else false
  end;
end $$;
revoke all on function public.current_user_can(text) from public, anon;
grant execute on function public.current_user_can(text) to authenticated, service_role;

create table if not exists public.organization_industries (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  industry_key       text not null,
  services_imported  boolean not null default true,
  parts_imported     boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (organization_id, industry_key)
);
create index if not exists idx_organization_industries_org on public.organization_industries(organization_id);

create table if not exists public.catalog_import_batches (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  source              text not null,
  industry_keys       text[] not null default '{}',
  included_parts     boolean not null default false,
  item_count          integer not null default 0,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now()
);

alter table public.price_book add column if not exists industry_key text;
alter table public.price_book add column if not exists pack_item_key text;
alter table public.price_book add column if not exists item_kind text not null default 'service';
alter table public.price_book add column if not exists import_batch_id uuid references public.catalog_import_batches(id) on delete set null;
create unique index if not exists uq_price_book_pack_item
  on public.price_book(organization_id, pack_item_key)
  where pack_item_key is not null;

alter table public.customers add column if not exists sample_batch_id uuid;
alter table public.jobs add column if not exists sample_batch_id uuid;

create table if not exists public.device_subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  profile_id         uuid not null references public.profiles(id) on delete cascade,
  endpoint           text not null,
  p256dh             text not null,
  auth_secret        text not null,
  device_name        text,
  locale             text not null default 'en' check (locale in ('en','he')),
  enabled            boolean not null default true,
  last_seen_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  unique (profile_id, endpoint),
  unique (id, organization_id)
);
create index if not exists idx_device_subscriptions_profile on public.device_subscriptions(profile_id, enabled);

create table if not exists public.push_notification_events (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  profile_id         uuid references public.profiles(id) on delete cascade,
  event_type         text not null,
  title              text not null,
  body               text not null,
  target_url         text,
  status             text not null default 'pending',
  error_message      text,
  created_at         timestamptz not null default now(),
  sent_at            timestamptz
);
create index if not exists idx_push_events_pending on public.push_notification_events(status, created_at)
  where status in ('pending','failed');

do $$
declare r record;
begin
  for r in select * from (values
    ('profile_capabilities','profile_capabilities_profile_org_guard','profiles','profile_id'),
    ('catalog_import_batches','catalog_batches_creator_org_guard','profiles','created_by'),
    ('device_subscriptions','device_subscriptions_profile_org_guard','profiles','profile_id'),
    ('push_notification_events','push_events_profile_org_guard','profiles','profile_id')
  ) as t(tbl,trg,parent,fkcol) loop
    execute format('drop trigger if exists %I on public.%I;',r.trg,r.tbl);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.assert_child_org(%L,%L);',r.trg,r.tbl,r.parent,r.fkcol);
  end loop;
end $$;

drop trigger if exists trg_profile_capabilities_updated on public.profile_capabilities;
create trigger trg_profile_capabilities_updated before update on public.profile_capabilities
  for each row execute function public.set_updated_at();

alter table public.profile_capabilities enable row level security;
alter table public.organization_industries enable row level security;
alter table public.catalog_import_batches enable row level security;
alter table public.device_subscriptions enable row level security;
alter table public.push_notification_events enable row level security;

drop policy if exists profile_capabilities_select on public.profile_capabilities;
create policy profile_capabilities_select on public.profile_capabilities for select to authenticated
  using (organization_id = public.current_org_id() and (profile_id = auth.uid() or public.current_user_role() = 'owner'));
drop policy if exists profile_capabilities_owner_write on public.profile_capabilities;
create policy profile_capabilities_owner_write on public.profile_capabilities for all to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() = 'owner')
  with check (organization_id = public.current_org_id() and public.current_user_role() = 'owner' and profile_id <> auth.uid());

drop policy if exists organization_industries_select on public.organization_industries;
create policy organization_industries_select on public.organization_industries for select to authenticated
  using (organization_id = public.current_org_id());
drop policy if exists organization_industries_owner_write on public.organization_industries;
create policy organization_industries_owner_write on public.organization_industries for all to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() = 'owner')
  with check (organization_id = public.current_org_id() and public.current_user_role() = 'owner');

drop policy if exists catalog_import_batches_select on public.catalog_import_batches;
create policy catalog_import_batches_select on public.catalog_import_batches for select to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));
drop policy if exists catalog_import_batches_owner_write on public.catalog_import_batches;
create policy catalog_import_batches_owner_write on public.catalog_import_batches for all to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() = 'owner')
  with check (organization_id = public.current_org_id() and public.current_user_role() = 'owner');

drop policy if exists device_subscriptions_own on public.device_subscriptions;
create policy device_subscriptions_own on public.device_subscriptions for all to authenticated
  using (organization_id = public.current_org_id() and profile_id = auth.uid())
  with check (organization_id = public.current_org_id() and profile_id = auth.uid());

drop policy if exists push_events_select on public.push_notification_events;
create policy push_events_select on public.push_notification_events for select to authenticated
  using (organization_id = public.current_org_id() and (profile_id = auth.uid() or public.current_user_role() in ('owner','office')));

grant select, insert, update, delete on public.profile_capabilities, public.organization_industries,
  public.catalog_import_batches, public.device_subscriptions to authenticated;
grant select on public.push_notification_events to authenticated;
grant all on public.profile_capabilities, public.organization_industries, public.catalog_import_batches,
  public.device_subscriptions, public.push_notification_events to service_role;
revoke all on public.profile_capabilities, public.organization_industries, public.catalog_import_batches,
  public.device_subscriptions, public.push_notification_events from anon;
