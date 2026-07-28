-- ServicePro — סכמת Supabase מלאה
-- מריצים פעם אחת ב-Supabase: SQL Editor > New query > Run

create extension if not exists btree_gist;
create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.sp_organizations (
  id bigint generated always as identity primary key,
  name text not null check (char_length(trim(name)) between 2 and 80),
  created_by uuid not null references auth.users(id) on delete restrict,
  timezone text not null default 'Asia/Jerusalem',
  currency text not null default 'ILS' check (currency = 'ILS'),
  default_vat_basis_points integer not null default 1800 check (default_vat_basis_points between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sp_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  phone text,
  default_organization_id bigint references public.sp_organizations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sp_organization_members (
  organization_id bigint not null references public.sp_organizations(id) on delete cascade,
  user_id uuid not null references public.sp_profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'office', 'technician')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.sp_customers (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.sp_organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  phone text,
  email text,
  address text,
  notes text,
  created_by uuid not null references public.sp_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sp_jobs (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.sp_organizations(id) on delete cascade,
  customer_id bigint not null references public.sp_customers(id) on delete restrict,
  technician_user_id uuid references public.sp_profiles(id) on delete set null,
  title text not null check (char_length(trim(title)) between 2 and 140),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  address text,
  status text not null default 'scheduled' check (status in ('scheduled', 'on_way', 'in_progress', 'completed', 'cancelled')),
  price_agorot bigint not null default 0 check (price_agorot >= 0),
  notes text,
  created_by uuid not null references public.sp_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sp_jobs_valid_time check (ends_at > starts_at)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sp_jobs_no_technician_overlap'
      and conrelid = 'public.sp_jobs'::regclass
  ) then
    alter table public.sp_jobs
      add constraint sp_jobs_no_technician_overlap
      exclude using gist (
        technician_user_id with =,
        tstzrange(starts_at, ends_at, '[)') with &&
      )
      where (technician_user_id is not null and status in ('scheduled', 'on_way', 'in_progress'));
  end if;
end $$;

create table if not exists public.sp_invoices (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.sp_organizations(id) on delete cascade,
  customer_id bigint not null references public.sp_customers(id) on delete restrict,
  job_id bigint references public.sp_jobs(id) on delete set null,
  invoice_number text not null check (char_length(trim(invoice_number)) between 1 and 40),
  status text not null default 'sent' check (status in ('draft', 'sent', 'overdue', 'paid', 'cancelled')),
  subtotal_agorot bigint not null check (subtotal_agorot >= 0),
  discount_agorot bigint not null default 0 check (discount_agorot >= 0),
  vat_basis_points integer not null default 1800 check (vat_basis_points between 0 and 10000),
  total_agorot bigint not null default 0 check (total_agorot >= 0),
  due_date date not null,
  paid_at timestamptz,
  notes text,
  created_by uuid not null references public.sp_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sp_invoices_discount_valid check (discount_agorot <= subtotal_agorot),
  constraint sp_invoices_number_per_org unique (organization_id, invoice_number)
);

create table if not exists public.sp_expenses (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.sp_organizations(id) on delete cascade,
  category text not null check (char_length(trim(category)) between 2 and 60),
  vendor text,
  description text,
  amount_agorot bigint not null check (amount_agorot > 0),
  spent_on date not null default current_date,
  created_by uuid not null references public.sp_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sp_outreach_log (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.sp_organizations(id) on delete cascade,
  customer_id bigint not null references public.sp_customers(id) on delete cascade,
  invoice_id bigint references public.sp_invoices(id) on delete set null,
  channel text not null check (channel in ('whatsapp', 'phone', 'email')),
  message text not null check (char_length(trim(message)) between 2 and 1000),
  opened_at timestamptz not null default now(),
  opened_by uuid not null references public.sp_profiles(id) on delete restrict
);

create table if not exists public.sp_audit_log (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.sp_organizations(id) on delete cascade,
  actor_user_id uuid references public.sp_profiles(id) on delete set null,
  entity_type text not null,
  entity_id bigint not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sp_profiles_default_organization_idx on public.sp_profiles (default_organization_id);
create index if not exists sp_organization_members_user_idx on public.sp_organization_members (user_id, active);
create index if not exists sp_organization_members_role_idx on public.sp_organization_members (organization_id, role) where active;
create index if not exists sp_customers_org_name_idx on public.sp_customers (organization_id, name);
create index if not exists sp_customers_org_phone_idx on public.sp_customers (organization_id, phone) where phone is not null;
create index if not exists sp_jobs_customer_idx on public.sp_jobs (customer_id);
create index if not exists sp_jobs_org_starts_idx on public.sp_jobs (organization_id, starts_at);
create index if not exists sp_jobs_org_status_starts_idx on public.sp_jobs (organization_id, status, starts_at);
create index if not exists sp_jobs_technician_active_idx on public.sp_jobs (technician_user_id, starts_at)
  where technician_user_id is not null and status in ('scheduled', 'on_way', 'in_progress');
create index if not exists sp_invoices_customer_idx on public.sp_invoices (customer_id);
create index if not exists sp_invoices_job_idx on public.sp_invoices (job_id) where job_id is not null;
create index if not exists sp_invoices_org_status_due_idx on public.sp_invoices (organization_id, status, due_date);
create index if not exists sp_expenses_org_date_idx on public.sp_expenses (organization_id, spent_on desc);
create index if not exists sp_outreach_org_date_idx on public.sp_outreach_log (organization_id, opened_at desc);
create index if not exists sp_outreach_customer_idx on public.sp_outreach_log (customer_id);
create index if not exists sp_outreach_invoice_idx on public.sp_outreach_log (invoice_id) where invoice_id is not null;
create index if not exists sp_audit_org_date_idx on public.sp_audit_log (organization_id, created_at desc);
create index if not exists sp_audit_actor_idx on public.sp_audit_log (actor_user_id) where actor_user_id is not null;

create or replace function private.sp_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.sp_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sp_profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function private.sp_calculate_invoice_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  taxable bigint;
begin
  taxable := new.subtotal_agorot - new.discount_agorot;
  new.total_agorot := taxable + round((taxable::numeric * new.vat_basis_points::numeric) / 10000)::bigint;
  if new.status = 'paid' and new.paid_at is null then
    new.paid_at := now();
  elsif new.status <> 'paid' then
    new.paid_at := null;
  end if;
  return new;
end;
$$;

create or replace function private.sp_write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
  org_id bigint;
  record_id bigint;
begin
  if tg_op = 'DELETE' then
    row_data := to_jsonb(old);
    org_id := old.organization_id;
    record_id := old.id;
  else
    row_data := to_jsonb(new);
    org_id := new.organization_id;
    record_id := new.id;
  end if;

  insert into public.sp_audit_log (organization_id, actor_user_id, entity_type, entity_id, action, changes)
  values (org_id, (select auth.uid()), tg_table_name, record_id, lower(tg_op), row_data);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists sp_on_auth_user_created on auth.users;
create trigger sp_on_auth_user_created
  after insert on auth.users
  for each row execute function private.sp_handle_new_user();

drop trigger if exists sp_organizations_set_updated_at on public.sp_organizations;
create trigger sp_organizations_set_updated_at before update on public.sp_organizations
  for each row execute function private.sp_set_updated_at();
drop trigger if exists sp_profiles_set_updated_at on public.sp_profiles;
create trigger sp_profiles_set_updated_at before update on public.sp_profiles
  for each row execute function private.sp_set_updated_at();
drop trigger if exists sp_customers_set_updated_at on public.sp_customers;
create trigger sp_customers_set_updated_at before update on public.sp_customers
  for each row execute function private.sp_set_updated_at();
drop trigger if exists sp_jobs_set_updated_at on public.sp_jobs;
create trigger sp_jobs_set_updated_at before update on public.sp_jobs
  for each row execute function private.sp_set_updated_at();
drop trigger if exists sp_invoices_set_updated_at on public.sp_invoices;
create trigger sp_invoices_set_updated_at before update on public.sp_invoices
  for each row execute function private.sp_set_updated_at();
drop trigger if exists sp_expenses_set_updated_at on public.sp_expenses;
create trigger sp_expenses_set_updated_at before update on public.sp_expenses
  for each row execute function private.sp_set_updated_at();

drop trigger if exists sp_invoices_calculate_total on public.sp_invoices;
create trigger sp_invoices_calculate_total before insert or update on public.sp_invoices
  for each row execute function private.sp_calculate_invoice_total();

drop trigger if exists sp_jobs_audit on public.sp_jobs;
create trigger sp_jobs_audit after insert or update or delete on public.sp_jobs
  for each row execute function private.sp_write_audit_log();
drop trigger if exists sp_invoices_audit on public.sp_invoices;
create trigger sp_invoices_audit after insert or update or delete on public.sp_invoices
  for each row execute function private.sp_write_audit_log();

create or replace function private.sp_is_org_member(p_organization_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sp_organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = (select auth.uid())
      and member.active
  );
$$;

create or replace function private.sp_has_org_role(p_organization_id bigint, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sp_organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = (select auth.uid())
      and member.role = any(p_roles)
      and member.active
  );
$$;

create or replace function private.sp_shares_org_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sp_organization_members mine
    join public.sp_organization_members theirs
      on theirs.organization_id = mine.organization_id
     and theirs.user_id = p_user_id
     and theirs.active
    where mine.user_id = (select auth.uid())
      and mine.active
  );
$$;

create or replace function private.sp_is_org_creator(p_organization_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sp_organizations organization
    where organization.id = p_organization_id
      and organization.created_by = (select auth.uid())
  );
$$;

create or replace function private.sp_can_view_customer(p_organization_id bigint, p_customer_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.sp_organization_members member
      where member.organization_id = p_organization_id
        and member.user_id = (select auth.uid())
        and member.role in ('owner', 'office')
        and member.active
    )
    or exists (
      select 1 from public.sp_jobs job
      where job.organization_id = p_organization_id
        and job.customer_id = p_customer_id
        and job.technician_user_id = (select auth.uid())
        and job.status <> 'cancelled'
    );
$$;

revoke execute on function private.sp_set_updated_at() from public, anon, authenticated;
revoke execute on function private.sp_handle_new_user() from public, anon, authenticated;
revoke execute on function private.sp_calculate_invoice_total() from public, anon, authenticated;
revoke execute on function private.sp_write_audit_log() from public, anon, authenticated;
revoke execute on function private.sp_is_org_member(bigint) from public, anon;
revoke execute on function private.sp_has_org_role(bigint, text[]) from public, anon;
revoke execute on function private.sp_shares_org_with(uuid) from public, anon;
revoke execute on function private.sp_is_org_creator(bigint) from public, anon;
revoke execute on function private.sp_can_view_customer(bigint, bigint) from public, anon;
grant execute on function private.sp_is_org_member(bigint) to authenticated;
grant execute on function private.sp_has_org_role(bigint, text[]) to authenticated;
grant execute on function private.sp_shares_org_with(uuid) to authenticated;
grant execute on function private.sp_is_org_creator(bigint) to authenticated;
grant execute on function private.sp_can_view_customer(bigint, bigint) to authenticated;

alter table public.sp_organizations enable row level security;
alter table public.sp_profiles enable row level security;
alter table public.sp_organization_members enable row level security;
alter table public.sp_customers enable row level security;
alter table public.sp_jobs enable row level security;
alter table public.sp_invoices enable row level security;
alter table public.sp_expenses enable row level security;
alter table public.sp_outreach_log enable row level security;
alter table public.sp_audit_log enable row level security;

drop policy if exists sp_organizations_select on public.sp_organizations;
create policy sp_organizations_select on public.sp_organizations for select to authenticated
  using ((select private.sp_is_org_member(id)));
drop policy if exists sp_organizations_insert on public.sp_organizations;
create policy sp_organizations_insert on public.sp_organizations for insert to authenticated
  with check (created_by = (select auth.uid()));
drop policy if exists sp_organizations_update on public.sp_organizations;
create policy sp_organizations_update on public.sp_organizations for update to authenticated
  using ((select private.sp_has_org_role(id, array['owner']::text[])))
  with check ((select private.sp_has_org_role(id, array['owner']::text[])));
drop policy if exists sp_organizations_delete on public.sp_organizations;
create policy sp_organizations_delete on public.sp_organizations for delete to authenticated
  using ((select private.sp_has_org_role(id, array['owner']::text[])));

drop policy if exists sp_profiles_select on public.sp_profiles;
create policy sp_profiles_select on public.sp_profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.sp_shares_org_with(id)));
drop policy if exists sp_profiles_update on public.sp_profiles;
create policy sp_profiles_update on public.sp_profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists members_select on public.sp_organization_members;
create policy members_select on public.sp_organization_members for select to authenticated
  using (user_id = (select auth.uid()) or (select private.sp_is_org_member(organization_id)));
drop policy if exists members_insert on public.sp_organization_members;
create policy members_insert on public.sp_organization_members for insert to authenticated
  with check (
    (
      user_id = (select auth.uid())
      and (select private.sp_is_org_creator(organization_id))
    )
    or (select private.sp_has_org_role(organization_id, array['owner']::text[]))
  );
drop policy if exists members_update on public.sp_organization_members;
create policy members_update on public.sp_organization_members for update to authenticated
  using ((select private.sp_has_org_role(organization_id, array['owner']::text[])))
  with check ((select private.sp_has_org_role(organization_id, array['owner']::text[])));
drop policy if exists members_delete on public.sp_organization_members;
create policy members_delete on public.sp_organization_members for delete to authenticated
  using ((select private.sp_has_org_role(organization_id, array['owner']::text[])));

drop policy if exists sp_customers_select on public.sp_customers;
create policy sp_customers_select on public.sp_customers for select to authenticated
  using ((select private.sp_can_view_customer(organization_id, id)));
drop policy if exists sp_customers_insert on public.sp_customers;
create policy sp_customers_insert on public.sp_customers for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select private.sp_has_org_role(organization_id, array['owner', 'office']::text[]))
  );
drop policy if exists sp_customers_update on public.sp_customers;
create policy sp_customers_update on public.sp_customers for update to authenticated
  using ((select private.sp_has_org_role(organization_id, array['owner', 'office']::text[])))
  with check ((select private.sp_has_org_role(organization_id, array['owner', 'office']::text[])));
drop policy if exists sp_customers_delete on public.sp_customers;
create policy sp_customers_delete on public.sp_customers for delete to authenticated
  using ((select private.sp_has_org_role(organization_id, array['owner', 'office']::text[])));

drop policy if exists sp_jobs_select on public.sp_jobs;
create policy sp_jobs_select on public.sp_jobs for select to authenticated
  using (
    (select private.sp_has_org_role(organization_id, array['owner', 'office']::text[]))
    or (
      technician_user_id = (select auth.uid())
      and (select private.sp_has_org_role(organization_id, array['technician']::text[]))
    )
  );
drop policy if exists sp_jobs_insert on public.sp_jobs;
create policy sp_jobs_insert on public.sp_jobs for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select private.sp_has_org_role(organization_id, array['owner', 'office']::text[]))
  );
drop policy if exists sp_jobs_update on public.sp_jobs;
create policy sp_jobs_update on public.sp_jobs for update to authenticated
  using ((select private.sp_has_org_role(organization_id, array['owner', 'office']::text[])))
  with check ((select private.sp_has_org_role(organization_id, array['owner', 'office']::text[])));
drop policy if exists sp_jobs_delete on public.sp_jobs;
create policy sp_jobs_delete on public.sp_jobs for delete to authenticated
  using ((select private.sp_has_org_role(organization_id, array['owner']::text[])));

drop policy if exists sp_invoices_select on public.sp_invoices;
create policy sp_invoices_select on public.sp_invoices for select to authenticated
  using ((select private.sp_has_org_role(organization_id, array['owner', 'office']::text[])));
drop policy if exists sp_invoices_insert on public.sp_invoices;
create policy sp_invoices_insert on public.sp_invoices for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select private.sp_has_org_role(organization_id, array['owner', 'office']::text[]))
  );
drop policy if exists sp_invoices_update on public.sp_invoices;
create policy sp_invoices_update on public.sp_invoices for update to authenticated
  using ((select private.sp_has_org_role(organization_id, array['owner', 'office']::text[])))
  with check ((select private.sp_has_org_role(organization_id, array['owner', 'office']::text[])));
drop policy if exists sp_invoices_delete on public.sp_invoices;
create policy sp_invoices_delete on public.sp_invoices for delete to authenticated
  using ((select private.sp_has_org_role(organization_id, array['owner']::text[])));

drop policy if exists sp_expenses_select on public.sp_expenses;
create policy sp_expenses_select on public.sp_expenses for select to authenticated
  using ((select private.sp_has_org_role(organization_id, array['owner', 'office']::text[])));
drop policy if exists sp_expenses_insert on public.sp_expenses;
create policy sp_expenses_insert on public.sp_expenses for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select private.sp_has_org_role(organization_id, array['owner', 'office']::text[]))
  );
drop policy if exists sp_expenses_update on public.sp_expenses;
create policy sp_expenses_update on public.sp_expenses for update to authenticated
  using ((select private.sp_has_org_role(organization_id, array['owner', 'office']::text[])))
  with check ((select private.sp_has_org_role(organization_id, array['owner', 'office']::text[])));
drop policy if exists sp_expenses_delete on public.sp_expenses;
create policy sp_expenses_delete on public.sp_expenses for delete to authenticated
  using ((select private.sp_has_org_role(organization_id, array['owner']::text[])));

drop policy if exists outreach_select on public.sp_outreach_log;
create policy outreach_select on public.sp_outreach_log for select to authenticated
  using ((select private.sp_has_org_role(organization_id, array['owner', 'office']::text[])));
drop policy if exists outreach_insert on public.sp_outreach_log;
create policy outreach_insert on public.sp_outreach_log for insert to authenticated
  with check (
    opened_by = (select auth.uid())
    and (select private.sp_has_org_role(organization_id, array['owner', 'office']::text[]))
  );

drop policy if exists audit_select on public.sp_audit_log;
create policy audit_select on public.sp_audit_log for select to authenticated
  using ((select private.sp_has_org_role(organization_id, array['owner']::text[])));

create or replace function public.sp_create_business(p_name text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  new_organization_id bigint;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if char_length(trim(p_name)) not between 2 and 80 then
    raise exception 'Business name must contain 2 to 80 characters';
  end if;

  insert into public.sp_organizations (name, created_by)
  values (trim(p_name), current_user_id)
  returning id into new_organization_id;

  insert into public.sp_organization_members (organization_id, user_id, role)
  values (new_organization_id, current_user_id, 'owner');

  update public.sp_profiles
  set default_organization_id = new_organization_id
  where id = current_user_id;

  return new_organization_id;
end;
$$;

create or replace function public.sp_advance_job_status(p_job_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  selected_job public.sp_jobs%rowtype;
  next_status text;
  allowed boolean;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into selected_job
  from public.sp_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Job not found';
  end if;

  select exists (
    select 1
    from public.sp_organization_members member
    where member.organization_id = selected_job.organization_id
      and member.user_id = current_user_id
      and member.active
      and (
        member.role in ('owner', 'office')
        or (member.role = 'technician' and selected_job.technician_user_id = current_user_id)
      )
  ) into allowed;

  if not allowed then
    raise exception 'Not allowed to update this job';
  end if;

  next_status := case selected_job.status
    when 'scheduled' then 'on_way'
    when 'on_way' then 'in_progress'
    when 'in_progress' then 'completed'
    else null
  end;

  if next_status is null then
    raise exception 'This job cannot advance';
  end if;

  update public.sp_jobs set status = next_status where id = p_job_id;
  return next_status;
end;
$$;

revoke execute on function public.sp_create_business(text) from public, anon;
revoke execute on function public.sp_advance_job_status(bigint) from public, anon;
grant execute on function public.sp_create_business(text) to authenticated;
grant execute on function public.sp_advance_job_status(bigint) to authenticated;

revoke all on public.sp_organizations, public.sp_profiles, public.sp_organization_members,
  public.sp_customers, public.sp_jobs, public.sp_invoices, public.sp_expenses,
  public.sp_outreach_log, public.sp_audit_log from anon;

grant select, insert, update, delete on public.sp_organizations to authenticated;
grant select, update on public.sp_profiles to authenticated;
grant select, insert, update, delete on public.sp_organization_members to authenticated;
grant select, insert, update, delete on public.sp_customers to authenticated;
grant select, insert, update, delete on public.sp_jobs to authenticated;
grant select, insert, update, delete on public.sp_invoices to authenticated;
grant select, insert, update, delete on public.sp_expenses to authenticated;
grant select, insert on public.sp_outreach_log to authenticated;
grant select on public.sp_audit_log to authenticated;

grant usage, select on sequence public.sp_organizations_id_seq to authenticated;
grant usage, select on sequence public.sp_customers_id_seq to authenticated;
grant usage, select on sequence public.sp_jobs_id_seq to authenticated;
grant usage, select on sequence public.sp_invoices_id_seq to authenticated;
grant usage, select on sequence public.sp_expenses_id_seq to authenticated;
grant usage, select on sequence public.sp_outreach_log_id_seq to authenticated;
grant usage, select on sequence public.sp_audit_log_id_seq to authenticated;

-- Backfill sp_profiles if the project already had Auth users before this schema was installed.
insert into public.sp_profiles (id, display_name)
select
  user_account.id,
  coalesce(nullif(trim(user_account.raw_user_meta_data ->> 'display_name'), ''), split_part(user_account.email, '@', 1), '')
from auth.users user_account
on conflict (id) do nothing;

comment on table public.sp_organizations is 'ServicePro businesses. Every operational table is isolated by organization_id.';
comment on function public.sp_advance_job_status(bigint) is 'Advances only the status field after checking membership and assignment.';
