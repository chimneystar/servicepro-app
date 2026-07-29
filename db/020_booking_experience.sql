-- ServicePro guided online booking and booking administration.
-- Additive migration: the original submit_booking function and lead workflow remain available.

create table if not exists public.booking_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default true,
  approval_required boolean not null default true,
  enforce_service_area boolean not null default false,
  use_team_capacity boolean not null default true,
  min_notice_hours integer not null default 4 check (min_notice_hours between 0 and 720),
  max_days_ahead integer not null default 60 check (max_days_ahead between 1 and 365),
  slot_interval_min integer not null default 60 check (slot_interval_min in (15,30,45,60,90,120)),
  arrival_window_min integer not null default 120 check (arrival_window_min in (30,60,90,120,180,240)),
  hours_json jsonb not null default jsonb_build_object(
    '1',jsonb_build_array('08:00','17:00'),'2',jsonb_build_array('08:00','17:00'),
    '3',jsonb_build_array('08:00','17:00'),'4',jsonb_build_array('08:00','17:00'),
    '5',jsonb_build_array('08:00','17:00'),'6',null,'7',null
  ),
  payment_mode text not null default 'none' check (payment_mode in ('none','fixed','percentage','full')),
  deposit_value integer not null default 0 check (deposit_value >= 0),
  success_message_en text,
  success_message_he text,
  urgent_message_en text,
  urgent_message_he text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.booking_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_type_id uuid references public.job_types(id) on delete set null,
  name_en text not null,
  name_he text,
  description_en text,
  description_he text,
  duration_min integer not null default 60 check (duration_min between 15 and 1440),
  price_minor bigint not null default 0 check (price_minor >= 0),
  book_as text not null default 'job' check (book_as in ('job','estimate')),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, job_type_id)
);
create index if not exists idx_booking_services_org on public.booking_services(organization_id, active, sort);

create table if not exists public.booking_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label_en text not null,
  label_he text,
  field_type text not null default 'text' check (field_type in ('text','textarea','choice','checkbox')),
  options_json jsonb not null default jsonb_build_array(),
  required boolean not null default false,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_booking_questions_org on public.booking_questions(organization_id, active, sort);

alter table public.leads add column if not exists postal_code text;
alter table public.leads add column if not exists preferred_start_time time;
alter table public.leads add column if not exists preferred_window_min integer;
alter table public.leads add column if not exists booking_service_id uuid references public.booking_services(id) on delete set null;
alter table public.leads add column if not exists booking_answers jsonb not null default jsonb_build_object();
alter table public.leads add column if not exists booking_reference text;
alter table public.leads add column if not exists booking_status text not null default 'requested';
alter table public.leads add column if not exists campaign text;
alter table public.leads add column if not exists contact_preference text;
alter table public.leads add column if not exists urgency text;
create unique index if not exists uq_leads_booking_reference on public.leads(booking_reference) where booking_reference is not null;

insert into public.booking_settings(organization_id)
select id from public.organizations on conflict (organization_id) do nothing;

insert into public.booking_services(organization_id,job_type_id,name_en,name_he,duration_min,price_minor,sort)
select jt.organization_id,jt.id,jt.name,jt.name,jt.duration_min,jt.default_price_minor,jt.sort
from public.job_types jt
on conflict (organization_id,job_type_id) do nothing;

create or replace function public.create_booking_settings_for_org()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.booking_settings(organization_id) values(new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_org_booking_settings on public.organizations;
create trigger trg_org_booking_settings after insert on public.organizations for each row execute function public.create_booking_settings_for_org();

create or replace function public.sync_booking_service_from_job_type()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.booking_services(organization_id,job_type_id,name_en,name_he,duration_min,price_minor,sort)
  values(new.organization_id,new.id,new.name,new.name,new.duration_min,new.default_price_minor,new.sort)
  on conflict (organization_id,job_type_id) do update set
    name_en=excluded.name_en,
    duration_min=excluded.duration_min,
    price_minor=excluded.price_minor,
    sort=excluded.sort;
  return new;
end $$;
drop trigger if exists trg_job_type_booking_service on public.job_types;
create trigger trg_job_type_booking_service
after insert or update of name,duration_min,default_price_minor,sort on public.job_types
for each row execute function public.sync_booking_service_from_job_type();

drop trigger if exists trg_booking_settings_updated on public.booking_settings;
create trigger trg_booking_settings_updated before update on public.booking_settings for each row execute function public.set_updated_at();
drop trigger if exists trg_booking_services_updated on public.booking_services;
create trigger trg_booking_services_updated before update on public.booking_services for each row execute function public.set_updated_at();
drop trigger if exists trg_booking_questions_updated on public.booking_questions;
create trigger trg_booking_questions_updated before update on public.booking_questions for each row execute function public.set_updated_at();

alter table public.booking_settings enable row level security;
alter table public.booking_services enable row level security;
alter table public.booking_questions enable row level security;

drop policy if exists booking_settings_select on public.booking_settings;
create policy booking_settings_select on public.booking_settings for select to authenticated using (organization_id=public.current_org_id());
drop policy if exists booking_settings_owner on public.booking_settings;
create policy booking_settings_owner on public.booking_settings for all to authenticated using (organization_id=public.current_org_id() and public.current_user_role()='owner') with check (organization_id=public.current_org_id() and public.current_user_role()='owner');
drop policy if exists booking_services_select on public.booking_services;
create policy booking_services_select on public.booking_services for select to authenticated using (organization_id=public.current_org_id());
drop policy if exists booking_services_owner on public.booking_services;
create policy booking_services_owner on public.booking_services for all to authenticated using (organization_id=public.current_org_id() and public.current_user_role()='owner') with check (organization_id=public.current_org_id() and public.current_user_role()='owner');
drop policy if exists booking_questions_select on public.booking_questions;
create policy booking_questions_select on public.booking_questions for select to authenticated using (organization_id=public.current_org_id());
drop policy if exists booking_questions_owner on public.booking_questions;
create policy booking_questions_owner on public.booking_questions for all to authenticated using (organization_id=public.current_org_id() and public.current_user_role()='owner') with check (organization_id=public.current_org_id() and public.current_user_role()='owner');

grant select,insert,update,delete on public.booking_settings,public.booking_services,public.booking_questions to authenticated;
grant all on public.booking_settings,public.booking_services,public.booking_questions to service_role;
revoke all on public.booking_settings,public.booking_services,public.booking_questions from anon;

create or replace function public.public_booking_info_v2(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'id',o.id,'name',o.name,'tagline',o.tagline,'logo_url',o.logo_url,'accent_color',o.accent_color,
    'phone',o.phone,'email',o.email,'locale',o.locale,'currency',o.currency,
    'settings',jsonb_build_object('approval_required',s.approval_required,'enforce_service_area',s.enforce_service_area,'min_notice_hours',s.min_notice_hours,'max_days_ahead',s.max_days_ahead,'payment_mode',s.payment_mode,'deposit_value',s.deposit_value,'success_message_en',s.success_message_en,'success_message_he',s.success_message_he,'urgent_message_en',s.urgent_message_en,'urgent_message_he',s.urgent_message_he),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',bs.id,'name_en',bs.name_en,'name_he',bs.name_he,'description_en',bs.description_en,'description_he',bs.description_he,'duration_min',bs.duration_min,'price_minor',bs.price_minor,'book_as',bs.book_as) order by bs.sort,bs.name_en) from public.booking_services bs where bs.organization_id=o.id and bs.active),jsonb_build_array()),
    'questions',coalesce((select jsonb_agg(jsonb_build_object('id',bq.id,'label_en',bq.label_en,'label_he',bq.label_he,'field_type',bq.field_type,'options',bq.options_json,'required',bq.required) order by bq.sort,bq.created_at) from public.booking_questions bq where bq.organization_id=o.id and bq.active),jsonb_build_array())
  ) into result
  from public.organizations o join public.booking_settings s on s.organization_id=o.id
  where o.id=p_org and s.enabled;
  return result;
end $$;
revoke all on function public.public_booking_info_v2(uuid) from public;
grant execute on function public.public_booking_info_v2(uuid) to anon,authenticated,service_role;
