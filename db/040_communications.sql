-- =====================================================================
--  ServicePro — Migration 040: communications, statements, feeds, reports
--  Run once in the Supabase SQL Editor, AFTER 035. Safe to re-run.
--
--  Remediation ledger 6c.5, 6c.6, 6c.7, 6c.9, 6c.10, 6c.12.
--
--   6c.5  STAFF NOTIFICATIONS. Nothing told a technician they had been given a
--         job (5.13 built the push sender, but push is one channel on one
--         device), and nothing at all told an owner that money had arrived.
--         `staff_notifications` is the in-app inbox AND the claim: the row is
--         inserted under a unique dedupe key BEFORE anything is sent, so two
--         concurrent writers cannot both notify, and it is deleted again if the
--         claim's own work fails, exactly as `reminder_log` is released.
--
--   6c.6  STATEMENTS + DUNNING. Collections was ONE weekly SMS per invoice,
--         for ever, at the same volume on day 15 as on day 400. `dunning_events`
--         is the per-rung claim (unique per invoice+stage), so an escalation
--         fires once and the ladder terminates. `customer_statements` records
--         what was sent, to whom and on which channel — including a REFUSAL
--         and its consent reason, because a customer who was deliberately not
--         contacted must be as visible as one who was.
--
--   6c.7  CALENDAR FEED. `calendar_feed_tokens` is a CREDENTIAL and is bounded
--         by the rules 023 §10 settled on for portal links after they turned
--         out to be permanent and irrevocable: `expires_at` is NOT NULL and
--         enforced at lookup, `revoked_at` makes revocation immediate, and
--         `scope` limits what one URL can see. An organisation-wide feed is
--         refused to a technician both here (trigger) and in the app.
--
--   6c.9  SCHEDULED REPORTS. `report_schedules` + `report_deliveries`, where
--         the delivery row is claimed by period key so a cron that runs twice,
--         or catches up after an outage, sends exactly one digest per period.
--
--   6c.10 BULK OPERATIONS. `bulk_operations` is the durable record of a
--         multi-row action: how many were attempted, how many succeeded, and
--         the id + reason of every row that did not. A silent partial success
--         on 40 invoices is worse than a refusal, so the failures are stored,
--         not just shown once in a toast.
--
--   6c.12 ACCOUNTING SYNC — PARTIAL, DELIBERATELY. There is no OAuth app, no
--         token store and no API client in this migration or anywhere else,
--         because no developer credentials for QuickBooks or Xero exist in this
--         environment and an integration that has never authenticated must not
--         be shipped. `accounting_export_rows` is the part that IS real without
--         credentials: a stable external reference per source row, unique per
--         organisation + target, so re-exporting a month updates instead of
--         duplicating it. That is the defect the manual monthly CSV had.
--
--  THIS MIGRATION DROPS NOTHING. No table, no column, no policy and no function
--  is dropped, and no row is deleted. Every create is guarded, every column is
--  added with `if not exists`, and the two policies per table are created only
--  when a policy of that name is not already present.
--
--  Every column referenced below was checked against db/schema.sql and the
--  numbered migrations: profiles(id, organization_id, role, active),
--  customers(id, organization_id, sms_opt_in, email_opt_in — 019 §),
--  invoices(id, organization_id, customer_id, issue_date, status, total_minor),
--  organizations(id, name, currency, locale).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Staff notification preferences on the profile.
--
--    `notify_email_opt_in` defaults to TRUE so nothing changes for anybody who
--    never touches it, but the app reads it through the SAME contactEligibility
--    rule the customer channels use, which refuses a NON-BOOLEAN as well as an
--    explicit false. A query that forgot to select this column must not read as
--    universal consent.
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists notify_email_opt_in boolean not null default true;
alter table public.profiles add column if not exists notify_push_opt_in  boolean not null default true;
alter table public.profiles add column if not exists notify_email        text;

comment on column public.profiles.notify_email is
  'Where staff notifications are emailed. NULL falls back to the auth email, which app code resolves; the column exists so a business can route alerts to a shared inbox.';

-- ---------------------------------------------------------------------
-- 2. The in-app inbox — and the claim that stops a double send.
-- ---------------------------------------------------------------------
create table if not exists public.staff_notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  -- Deterministic: '<type>:<relatedType>:<relatedId>:<profileId>'. It is built
  -- by lib/core/staff-notify.mjs, which THROWS on a missing part rather than
  -- producing a key every row in the business would share.
  dedupe_key      text not null,
  type            text not null,
  title           text not null,
  body            text not null default '',
  url             text,
  related_type    text,
  related_id      uuid,
  -- How it actually went out. 'inbox_only' is an honest state (no devices, no
  -- email provider), not a failure, and is distinct from 'failed'.
  delivery_status text not null default 'pending',
  delivery_error  text,
  push_delivered  integer not null default 0,
  email_sent_at   timestamptz,
  read_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (organization_id, dedupe_key)
);

do $$ begin
  alter table public.staff_notifications
    add constraint staff_notifications_delivery_status_check
    check (delivery_status in ('pending','sent','inbox_only','failed'));
exception when duplicate_object then null; end $$;

create index if not exists idx_staff_notifications_unread
  on public.staff_notifications (profile_id, created_at desc) where read_at is null;
create index if not exists idx_staff_notifications_org
  on public.staff_notifications (organization_id, created_at desc);

-- Cross-tenant guard, the same shape 019 uses for every child table.
do $$
declare r record;
begin
  for r in select * from (values
    ('staff_notifications','staff_notifications_profile_org_guard','profiles','profile_id')
  ) as t(tbl,trg,parent,fkcol) loop
    execute format('drop trigger if exists %I on public.%I;', r.trg, r.tbl);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.assert_child_org(%L,%L);',
                   r.trg, r.tbl, r.parent, r.fkcol);
  end loop;
end $$;

alter table public.staff_notifications enable row level security;

-- OWN-PROFILE ONLY, like device_subscriptions (018 §): an inbox is personal,
-- and a dispatcher has no business reading a colleague's notifications. The
-- cron writes with the service role.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='staff_notifications' and policyname='staff_notifications_own_select') then
    create policy staff_notifications_own_select on public.staff_notifications for select to authenticated
      using (profile_id = auth.uid() and organization_id = public.current_org_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='staff_notifications' and policyname='staff_notifications_own_update') then
    -- Marking your own notification read. Insert is service-role only, so a
    -- member cannot forge a notification for a colleague.
    create policy staff_notifications_own_update on public.staff_notifications for update to authenticated
      using (profile_id = auth.uid() and organization_id = public.current_org_id())
      with check (profile_id = auth.uid() and organization_id = public.current_org_id());
  end if;
end $$;

grant select, update on public.staff_notifications to authenticated;
grant all on public.staff_notifications to service_role;
revoke all on public.staff_notifications from anon;

comment on table public.staff_notifications is
  'In-app inbox for staff. The row is inserted BEFORE the push/email is attempted, under unique (organization_id, dedupe_key), so it is both the claim and the audit record; a failure releases it so the notification can be retried.';

-- ---------------------------------------------------------------------
-- 3. Structured dunning: one rung, once, and it ends.
-- ---------------------------------------------------------------------
create table if not exists public.dunning_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id      uuid not null references public.invoices(id) on delete cascade,
  customer_id     uuid references public.customers(id) on delete set null,
  stage           text not null,
  channel         text not null,
  status          text not null default 'running',
  -- 'skipped' carries the CONSENT reason (sms_opt_out, no_email, ...). A
  -- customer deliberately not contacted must be as visible as one who was.
  reason          text,
  attempts        integer not null default 1,
  age_days        integer,
  outstanding_minor bigint,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz,
  unique (invoice_id, stage)
);

do $$ begin
  alter table public.dunning_events add constraint dunning_events_stage_check
    check (stage in ('reminder','overdue','second_notice','final_notice'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.dunning_events add constraint dunning_events_status_check
    check (status in ('running','sent','failed','skipped'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.dunning_events add constraint dunning_events_channel_check
    check (channel in ('sms','email'));
exception when duplicate_object then null; end $$;

create index if not exists idx_dunning_events_org on public.dunning_events (organization_id, created_at desc);
create index if not exists idx_dunning_events_invoice on public.dunning_events (invoice_id, stage);

do $$
declare r record;
begin
  for r in select * from (values
    ('dunning_events','dunning_events_invoice_org_guard','invoices','invoice_id'),
    ('dunning_events','dunning_events_customer_org_guard','customers','customer_id')
  ) as t(tbl,trg,parent,fkcol) loop
    execute format('drop trigger if exists %I on public.%I;', r.trg, r.tbl);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.assert_child_org(%L,%L);',
                   r.trg, r.tbl, r.parent, r.fkcol);
  end loop;
end $$;

alter table public.dunning_events enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='dunning_events' and policyname='dunning_events_select') then
    create policy dunning_events_select on public.dunning_events for select to authenticated
      using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='dunning_events' and policyname='dunning_events_manage') then
    create policy dunning_events_manage on public.dunning_events for all to authenticated
      using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))
      with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));
  end if;
end $$;
grant select, insert, update, delete on public.dunning_events to authenticated;
grant all on public.dunning_events to service_role;
revoke all on public.dunning_events from anon;

-- ---------------------------------------------------------------------
-- 4. Statements that were actually sent.
-- ---------------------------------------------------------------------
create table if not exists public.customer_statements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  as_of           date not null,
  since           date,
  opening_minor   bigint not null default 0,
  charges_minor   bigint not null default 0,
  payments_minor  bigint not null default 0,
  balance_minor   bigint not null default 0,
  past_due_minor  bigint not null default 0,
  channel         text,
  status          text not null default 'created',
  reason          text,
  sent_to         text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

do $$ begin
  alter table public.customer_statements add constraint customer_statements_status_check
    check (status in ('created','sent','failed','skipped'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.customer_statements add constraint customer_statements_channel_check
    check (channel is null or channel in ('sms','email','print'));
exception when duplicate_object then null; end $$;

create index if not exists idx_customer_statements_customer
  on public.customer_statements (customer_id, as_of desc);
create index if not exists idx_customer_statements_org
  on public.customer_statements (organization_id, created_at desc);

do $$
declare r record;
begin
  for r in select * from (values
    ('customer_statements','customer_statements_customer_org_guard','customers','customer_id')
  ) as t(tbl,trg,parent,fkcol) loop
    execute format('drop trigger if exists %I on public.%I;', r.trg, r.tbl);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.assert_child_org(%L,%L);',
                   r.trg, r.tbl, r.parent, r.fkcol);
  end loop;
end $$;

alter table public.customer_statements enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customer_statements' and policyname='customer_statements_select') then
    create policy customer_statements_select on public.customer_statements for select to authenticated
      using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customer_statements' and policyname='customer_statements_manage') then
    create policy customer_statements_manage on public.customer_statements for all to authenticated
      using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))
      with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));
  end if;
end $$;
grant select, insert, update, delete on public.customer_statements to authenticated;
grant all on public.customer_statements to service_role;
revoke all on public.customer_statements from anon;

-- ---------------------------------------------------------------------
-- 5. Calendar feed tokens — the credential, bounded per 023 §10.
-- ---------------------------------------------------------------------
create table if not exists public.calendar_feed_tokens (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  token           uuid not null default gen_random_uuid(),
  label           text not null default '',
  -- 'mine' = the holder's own jobs. 'organization' = the whole schedule, and is
  -- refused to a technician by the trigger below as well as by the app.
  scope           text not null default 'mine',
  -- NOT NULL on purpose. A nullable expiry is how the portal token ended up
  -- permanent: the absence of a bound read as an unlimited one.
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  revoked_by      uuid references public.profiles(id) on delete set null,
  last_accessed_at timestamptz,
  access_count    bigint not null default 0,
  created_at      timestamptz not null default now(),
  unique (token)
);

do $$ begin
  alter table public.calendar_feed_tokens add constraint calendar_feed_tokens_scope_check
    check (scope in ('mine','organization'));
exception when duplicate_object then null; end $$;

create index if not exists idx_calendar_feed_tokens_live
  on public.calendar_feed_tokens (token) where revoked_at is null;
create index if not exists idx_calendar_feed_tokens_profile
  on public.calendar_feed_tokens (profile_id, created_at desc);

-- An organisation-wide feed hands every customer address in the business to one
-- long-lived URL. A technician cannot mint one — enforced here so a forged
-- form post cannot do what the screen refuses.
create or replace function public.assert_calendar_feed_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
declare holder_role text; holder_org uuid;
begin
  select p.role::text, p.organization_id into holder_role, holder_org
    from public.profiles p where p.id = new.profile_id;
  if holder_org is null then
    raise exception 'calendar feed references a profile that does not exist'
      using errcode = 'foreign_key_violation';
  end if;
  if holder_org <> new.organization_id then
    raise exception 'cross-tenant reference blocked: calendar_feed_tokens.profile_id'
      using errcode = 'check_violation';
  end if;
  if new.scope = 'organization' and holder_role not in ('owner','office') then
    raise exception 'a technician may only subscribe to their own schedule'
      using errcode = 'insufficient_privilege';
  end if;
  -- A token with no future is not a token. Refuse it rather than mint a dead one.
  if new.expires_at <= now() then
    raise exception 'calendar feed token must expire in the future'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function public.assert_calendar_feed_scope() from public, anon, authenticated;

drop trigger if exists calendar_feed_tokens_scope_guard on public.calendar_feed_tokens;
create trigger calendar_feed_tokens_scope_guard
before insert or update on public.calendar_feed_tokens
for each row execute function public.assert_calendar_feed_scope();

alter table public.calendar_feed_tokens enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='calendar_feed_tokens' and policyname='calendar_feed_tokens_own') then
    -- Own feeds only, for every role. An owner who needs to revoke somebody
    -- else's does it through the service role, on the record; letting one
    -- member SELECT another's token would make the token readable, which is
    -- the whole thing it must not be.
    create policy calendar_feed_tokens_own on public.calendar_feed_tokens for all to authenticated
      using (profile_id = auth.uid() and organization_id = public.current_org_id())
      with check (profile_id = auth.uid() and organization_id = public.current_org_id());
  end if;
end $$;
grant select, insert, update, delete on public.calendar_feed_tokens to authenticated;
grant all on public.calendar_feed_tokens to service_role;
revoke all on public.calendar_feed_tokens from anon;

comment on table public.calendar_feed_tokens is
  'Subscribable iCal feed URLs. Treated as credentials per 023 section 10: expires_at is NOT NULL and enforced at lookup, revoked_at is checked before expiry so revocation is immediate, and scope bounds what one URL exposes. The feed payload carries no price, no notes and no document token.';

-- ---------------------------------------------------------------------
-- 6. Scheduled reports.
-- ---------------------------------------------------------------------
create table if not exists public.report_schedules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null default 'Business summary',
  frequency       text not null default 'weekly',
  enabled         boolean not null default true,
  -- Who gets it. Profile ids, resolved to an address at send time through the
  -- shared eligibility rule, so a teammate who opted out is skipped WITH a
  -- reason rather than mailed anyway.
  recipient_profile_ids uuid[] not null default '{}',
  starts_on       date,
  -- The CLAIM. 'daily:2026-07-30' / 'weekly:2026-07-30' / 'monthly:2026-06'.
  -- Comparing period keys rather than timestamps is what makes a cron that runs
  -- twice, or catches up after an outage, send exactly one digest per period.
  last_period_key text,
  last_run_at     timestamptz,
  last_error      text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

do $$ begin
  alter table public.report_schedules add constraint report_schedules_frequency_check
    check (frequency in ('daily','weekly','monthly'));
exception when duplicate_object then null; end $$;

create index if not exists idx_report_schedules_due
  on public.report_schedules (enabled, frequency) where enabled;

create table if not exists public.report_deliveries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  schedule_id     uuid not null references public.report_schedules(id) on delete cascade,
  period_key      text not null,
  period_start    date,
  period_end      date,
  status          text not null default 'running',
  reason          text,
  attempts        integer not null default 1,
  recipients      integer not null default 0,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz,
  unique (schedule_id, period_key)
);

do $$ begin
  alter table public.report_deliveries add constraint report_deliveries_status_check
    check (status in ('running','sent','failed','skipped'));
exception when duplicate_object then null; end $$;

create index if not exists idx_report_deliveries_org
  on public.report_deliveries (organization_id, created_at desc);

do $$
declare r record;
begin
  for r in select * from (values
    ('report_deliveries','report_deliveries_schedule_org_guard','report_schedules','schedule_id')
  ) as t(tbl,trg,parent,fkcol) loop
    execute format('drop trigger if exists %I on public.%I;', r.trg, r.tbl);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.assert_child_org(%L,%L);',
                   r.trg, r.tbl, r.parent, r.fkcol);
  end loop;
end $$;

alter table public.report_schedules  enable row level security;
alter table public.report_deliveries enable row level security;

do $$
declare r record;
begin
  for r in select * from (values ('report_schedules'), ('report_deliveries')) as t(tbl) loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=r.tbl and policyname=r.tbl||'_select') then
      execute format($p$create policy %I on public.%I for select to authenticated
        using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))$p$,
        r.tbl||'_select', r.tbl);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=r.tbl and policyname=r.tbl||'_manage') then
      execute format($p$create policy %I on public.%I for all to authenticated
        using (organization_id = public.current_org_id() and public.current_user_role() = 'owner')
        with check (organization_id = public.current_org_id() and public.current_user_role() = 'owner')$p$,
        r.tbl||'_manage', r.tbl);
    end if;
  end loop;
end $$;

grant select, insert, update, delete on public.report_schedules, public.report_deliveries to authenticated;
grant all on public.report_schedules, public.report_deliveries to service_role;
revoke all on public.report_schedules, public.report_deliveries from anon;

-- ---------------------------------------------------------------------
-- 7. Bulk operations: which rows failed, and why, kept.
-- ---------------------------------------------------------------------
create table if not exists public.bulk_operations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id        uuid references public.profiles(id) on delete set null,
  action          text not null,
  attempted       integer not null default 0,
  succeeded       integer not null default 0,
  failed          integer not null default 0,
  skipped         integer not null default 0,
  -- [{id, label, reason}] for every row that did not succeed. Stored, not just
  -- shown once in a toast: "which six of the forty did not go out" must still
  -- be answerable tomorrow.
  failures        jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_bulk_operations_org
  on public.bulk_operations (organization_id, created_at desc);

alter table public.bulk_operations enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='bulk_operations' and policyname='bulk_operations_select') then
    create policy bulk_operations_select on public.bulk_operations for select to authenticated
      using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='bulk_operations' and policyname='bulk_operations_insert') then
    create policy bulk_operations_insert on public.bulk_operations for insert to authenticated
      with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));
  end if;
end $$;
grant select, insert on public.bulk_operations to authenticated;
grant all on public.bulk_operations to service_role;
revoke all on public.bulk_operations from anon;

-- ---------------------------------------------------------------------
-- 8. Accounting export idempotency — 6c.12, and ONLY this much.
--
--    NO OAuth app, NO token store, NO API client. See the header: none of that
--    can be proven in this environment, so none of it ships. What is here is
--    the thing the monthly manual CSV genuinely lacked — a stable external
--    reference per source row, unique per organisation and target, so a
--    re-export of the same month matches instead of double-booking it.
-- ---------------------------------------------------------------------
create table if not exists public.accounting_exports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target          text not null,
  kind            text not null,
  period_start    date not null,
  period_end      date not null,
  row_count       integer not null default 0,
  total_minor     bigint not null default 0,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

do $$ begin
  alter table public.accounting_exports add constraint accounting_exports_target_check
    check (target in ('quickbooks','xero'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.accounting_exports add constraint accounting_exports_kind_check
    check (kind in ('invoices','payments','expenses'));
exception when duplicate_object then null; end $$;

create table if not exists public.accounting_export_rows (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  export_id       uuid references public.accounting_exports(id) on delete set null,
  target          text not null,
  source_type     text not null,
  source_id       uuid not null,
  -- 'SP-INVOICE-<uuid>'. Deterministic, namespaced, and the only thing both
  -- importers round-trip, which is what makes a re-import idempotent.
  external_ref    text not null,
  amount_minor    bigint not null default 0,
  exported_on     date not null default current_date,
  -- Filled from the ledger side of the reconciliation. NULL means "not yet
  -- matched", which is deliberately different from "matched at zero".
  matched_minor   bigint,
  matched_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (organization_id, target, source_type, source_id)
);

do $$ begin
  alter table public.accounting_export_rows add constraint accounting_export_rows_target_check
    check (target in ('quickbooks','xero'));
exception when duplicate_object then null; end $$;

create index if not exists idx_accounting_export_rows_ref
  on public.accounting_export_rows (organization_id, external_ref);
create index if not exists idx_accounting_exports_org
  on public.accounting_exports (organization_id, created_at desc);

alter table public.accounting_exports     enable row level security;
alter table public.accounting_export_rows enable row level security;

do $$
declare r record;
begin
  for r in select * from (values ('accounting_exports'), ('accounting_export_rows')) as t(tbl) loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=r.tbl and policyname=r.tbl||'_select') then
      execute format($p$create policy %I on public.%I for select to authenticated
        using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))$p$,
        r.tbl||'_select', r.tbl);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=r.tbl and policyname=r.tbl||'_manage') then
      execute format($p$create policy %I on public.%I for all to authenticated
        using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))
        with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))$p$,
        r.tbl||'_manage', r.tbl);
    end if;
  end loop;
end $$;

grant select, insert, update, delete on public.accounting_exports, public.accounting_export_rows to authenticated;
grant all on public.accounting_exports, public.accounting_export_rows to service_role;
revoke all on public.accounting_exports, public.accounting_export_rows from anon;

comment on table public.accounting_export_rows is
  'Idempotency and two-way-match ledger for accounting exports. PARTIAL by design: there is no OAuth integration anywhere in this product, because no QuickBooks or Xero developer credentials exist in this environment and an integration that has never authenticated must not be shipped.';

-- ---------------------------------------------------------------------
-- 9. Indexes the new nightly work needs.
--
--    runDunning scans unpaid invoices by issue date per organisation; without
--    this it is a sequential scan of every invoice ever issued, every night.
-- ---------------------------------------------------------------------
create index if not exists idx_invoices_unpaid_issue
  on public.invoices (organization_id, issue_date)
  where status = 'unpaid' and deleted_at is null;

-- =====================================================================
-- End migration 040.
-- =====================================================================
