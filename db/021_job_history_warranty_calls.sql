-- ServicePro job history, warranty callbacks and call tracking.
-- Additive and idempotent. Run after 020_booking_experience.sql.

alter table public.jobs add column if not exists parent_job_id uuid references public.jobs(id) on delete set null;
alter table public.jobs add column if not exists is_warranty_callback boolean not null default false;
create index if not exists idx_jobs_parent_job on public.jobs(parent_job_id) where parent_job_id is not null;

create table if not exists public.job_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  action_type text not null check (action_type in ('note','follow_up')),
  title text not null check (length(trim(title)) between 1 and 180),
  body text,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  due_at timestamptz,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_job_actions_timeline on public.job_actions(job_id, created_at desc);
create index if not exists idx_job_actions_due on public.job_actions(organization_id, status, due_at) where status = 'open';

create table if not exists public.job_warranties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  coverage_type text not null default 'workmanship' check (coverage_type in ('workmanship','manufacturer','custom')),
  starts_on date not null,
  expires_on date,
  terms text,
  status text not null default 'active' check (status in ('active','expired','void')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id),
  check (expires_on is null or expires_on >= starts_on)
);
create index if not exists idx_job_warranties_expiry on public.job_warranties(organization_id, status, expires_on);

create table if not exists public.warranty_callbacks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  warranty_id uuid references public.job_warranties(id) on delete set null,
  original_job_id uuid not null references public.jobs(id) on delete restrict,
  callback_job_id uuid references public.jobs(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  issue text not null check (length(trim(issue)) between 1 and 4000),
  priority text not null default 'normal' check (priority in ('low','normal','urgent')),
  responsibility text not null default 'review' check (responsibility in ('review','covered','customer','manufacturer','third_party')),
  status text not null default 'reported' check (status in ('reported','scheduled','in_progress','resolved','denied')),
  scheduled_for date,
  resolution text,
  internal_cost_minor bigint not null default 0 check (internal_cost_minor >= 0),
  reported_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (callback_job_id)
);
create index if not exists idx_warranty_callbacks_queue on public.warranty_callbacks(organization_id, status, reported_at desc);
create index if not exists idx_warranty_callbacks_original on public.warranty_callbacks(original_job_id, created_at desc);

create table if not exists public.tracked_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'twilio',
  provider_number_id text,
  phone_number text not null,
  label text not null,
  lead_source text,
  campaign text,
  destination_number text not null,
  active boolean not null default true,
  recording_enabled boolean not null default false,
  recording_notice_enabled boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, phone_number)
);
create index if not exists idx_tracked_numbers_lookup on public.tracked_phone_numbers(phone_number) where active;

create table if not exists public.call_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'manual',
  provider_call_id text,
  direction text not null check (direction in ('inbound','outbound')),
  status text not null default 'completed' check (status in ('initiated','ringing','in_progress','completed','missed','failed','voicemail')),
  from_number text not null,
  to_number text not null,
  tracked_number_id uuid references public.tracked_phone_numbers(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  handled_by uuid references public.profiles(id) on delete set null,
  reason text,
  outcome text,
  notes text,
  needs_follow_up boolean not null default false,
  recording_url text,
  recording_consent boolean not null default false,
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, provider_call_id)
);
create index if not exists idx_call_events_log on public.call_events(organization_id, started_at desc);
create index if not exists idx_call_events_job on public.call_events(job_id, started_at desc) where job_id is not null;
create index if not exists idx_call_events_customer on public.call_events(customer_id, started_at desc) where customer_id is not null;
create index if not exists idx_call_events_follow_up on public.call_events(organization_id, needs_follow_up, started_at desc) where needs_follow_up;

do $$
declare r record;
begin
  for r in select * from (values
    ('jobs','jobs_parent_job_org_guard','jobs','parent_job_id'),
    ('job_actions','job_actions_job_org_guard','jobs','job_id'),
    ('job_actions','job_actions_assignee_org_guard','profiles','assigned_to'),
    ('job_actions','job_actions_creator_org_guard','profiles','created_by'),
    ('job_warranties','job_warranties_job_org_guard','jobs','job_id'),
    ('warranty_callbacks','warranty_callbacks_warranty_org_guard','job_warranties','warranty_id'),
    ('warranty_callbacks','warranty_callbacks_original_job_org_guard','jobs','original_job_id'),
    ('warranty_callbacks','warranty_callbacks_callback_job_org_guard','jobs','callback_job_id'),
    ('warranty_callbacks','warranty_callbacks_customer_org_guard','customers','customer_id'),
    ('call_events','call_events_tracked_number_org_guard','tracked_phone_numbers','tracked_number_id'),
    ('call_events','call_events_customer_org_guard','customers','customer_id'),
    ('call_events','call_events_job_org_guard','jobs','job_id'),
    ('call_events','call_events_lead_org_guard','leads','lead_id'),
    ('call_events','call_events_handler_org_guard','profiles','handled_by')
  ) as t(tbl,trg,parent,fkcol) loop
    execute format('drop trigger if exists %I on public.%I;', r.trg, r.tbl);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.assert_child_org(%L,%L);', r.trg, r.tbl, r.parent, r.fkcol);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['job_actions','job_warranties','warranty_callbacks','tracked_phone_numbers','call_events'] loop
    execute format('drop trigger if exists trg_%s_updated on public.%I;', t, t);
    execute format('create trigger trg_%s_updated before update on public.%I for each row execute function public.set_updated_at();', t, t);
    execute format('drop trigger if exists trg_%s_audit on public.%I;', t, t);
    execute format('create trigger trg_%s_audit after insert or update or delete on public.%I for each row execute function public.audit_trigger();', t, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- Owner and office users manage warranty and call-center data inside their organization.
do $$
declare t text;
begin
  foreach t in array array['job_warranties','warranty_callbacks','tracked_phone_numbers','call_events'] loop
    execute format('drop policy if exists %I on public.%I;', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (organization_id = public.current_org_id() and public.current_user_role() in (''owner'',''office''));', t || '_select', t);
    execute format('drop policy if exists %I on public.%I;', t || '_manage', t);
    execute format('create policy %I on public.%I for all to authenticated using (organization_id = public.current_org_id() and public.current_user_role() in (''owner'',''office'')) with check (organization_id = public.current_org_id() and public.current_user_role() in (''owner'',''office''));', t || '_manage', t);
  end loop;
end $$;

-- Job actions are visible to office users and to technicians assigned to that job.
drop policy if exists job_actions_select on public.job_actions;
create policy job_actions_select on public.job_actions for select to authenticated
  using (organization_id = public.current_org_id() and (
    public.current_user_role() in ('owner','office') or exists (
      select 1 from public.jobs j where j.id = job_id and (j.assigned_to = auth.uid() or exists (
        select 1 from public.job_assignments a where a.job_id = j.id and a.profile_id = auth.uid()
      ))
    )
  ));
drop policy if exists job_actions_manage on public.job_actions;
create policy job_actions_manage on public.job_actions for all to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))
  with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));
drop policy if exists job_actions_tech_note_insert on public.job_actions;
create policy job_actions_tech_note_insert on public.job_actions for insert to authenticated
  with check (organization_id = public.current_org_id() and created_by = auth.uid() and action_type = 'note' and exists (
    select 1 from public.jobs j where j.id = job_id and (j.assigned_to = auth.uid() or exists (
      select 1 from public.job_assignments a where a.job_id = j.id and a.profile_id = auth.uid()
    ))
  ));

grant select, insert, update, delete on public.job_actions, public.job_warranties, public.warranty_callbacks,
  public.tracked_phone_numbers, public.call_events to authenticated;
grant all on public.job_actions, public.job_warranties, public.warranty_callbacks,
  public.tracked_phone_numbers, public.call_events to service_role;
revoke all on public.job_actions, public.job_warranties, public.warranty_callbacks,
  public.tracked_phone_numbers, public.call_events from anon;

-- Atomically turn a reported callback into a linked return visit.
create or replace function public.schedule_warranty_callback(
  p_callback_id uuid,
  p_date date,
  p_start time default null,
  p_end time default null,
  p_assigned_to uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_callback public.warranty_callbacks;
  v_original public.jobs;
  v_job_id uuid;
begin
  if public.current_user_role() not in ('owner','office') then raise exception 'forbidden'; end if;
  if p_date is null then raise exception 'date required'; end if;
  select * into v_callback from public.warranty_callbacks
    where id = p_callback_id and organization_id = public.current_org_id() for update;
  if not found then raise exception 'callback not found'; end if;
  if v_callback.callback_job_id is not null then return v_callback.callback_job_id; end if;
  select * into v_original from public.jobs where id = v_callback.original_job_id and deleted_at is null;
  if not found then raise exception 'original job not found'; end if;

  insert into public.jobs (
    organization_id, customer_id, assigned_to, service, status, stage, price_minor,
    scheduled_date, end_date, start_time, end_time, source, notes, created_by,
    parent_job_id, is_warranty_callback
  ) values (
    v_callback.organization_id, v_callback.customer_id, p_assigned_to,
    'Warranty callback: ' || v_original.service, 'scheduled'::public.job_status, 'Scheduled', 0,
    p_date, p_date, p_start, p_end, 'Warranty callback', v_callback.issue, auth.uid(),
    v_callback.original_job_id, true
  ) returning id into v_job_id;

  update public.warranty_callbacks set callback_job_id = v_job_id, scheduled_for = p_date, status = 'scheduled'
    where id = p_callback_id;
  return v_job_id;
end $$;
revoke all on function public.schedule_warranty_callback(uuid,date,time,time,uuid) from public, anon;
grant execute on function public.schedule_warranty_callback(uuid,date,time,time,uuid) to authenticated, service_role;

-- Trigger helpers are never direct APIs.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.audit_trigger() from public, anon, authenticated;
revoke execute on function public.assert_child_org() from public, anon, authenticated;
