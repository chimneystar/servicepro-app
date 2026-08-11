-- =====================================================================
--  ServicePro — Migration 017 (Helcim payment foundation)
--  Run once in the Supabase SQL Editor, AFTER 015. Safe to re-run.
--
--  Adds provider-neutral payment state, Helcim connected-account status,
--  business payment settings, progress schedules, manual Zelle/check
--  verification, and a safe public payment-options RPC.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Fine-grained payment permissions. These live outside profiles so the
-- existing self-edit profile policy can never be used to grant oneself
-- financial authority.
-- ---------------------------------------------------------------------
create table if not exists public.profile_payment_permissions (
  profile_id                    uuid primary key references public.profiles(id) on delete cascade,
  organization_id               uuid not null references public.organizations(id) on delete cascade,
  can_confirm_manual_payments   boolean not null default false,
  can_refund_payments           boolean not null default false,
  can_override_ach_holds        boolean not null default false,
  updated_by                    uuid references public.profiles(id) on delete set null,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create index if not exists idx_profile_payment_permissions_org
  on public.profile_payment_permissions(organization_id);

-- ---------------------------------------------------------------------
-- 2. Connected merchant status. Secrets live in a separate deny-all table.
-- ---------------------------------------------------------------------
create table if not exists public.merchant_connections (
  organization_id       uuid primary key references public.organizations(id) on delete cascade,
  provider              text not null default 'helcim' check (provider = 'helcim'),
  connected_account_id  text unique,
  status                text not null default 'not_started'
                        check (status in ('not_started','application_started','under_review','action_required','approved','rejected','suspended')),
  status_reason         text,
  card_enabled          boolean not null default false,
  ach_enabled           boolean not null default false,
  terminal_enabled      boolean not null default false,
  fee_saver_eligible    boolean not null default false,
  onboarding_started_at timestamptz,
  approved_at           timestamptz,
  last_webhook_at       timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.merchant_secrets (
  organization_id       uuid primary key references public.merchant_connections(organization_id) on delete cascade,
  encrypted_api_token   text not null,
  token_last_four       text,
  key_version           integer not null default 1,
  created_at            timestamptz not null default now(),
  rotated_at            timestamptz
);

-- ---------------------------------------------------------------------
-- 3. Business payment preferences and customer-facing instructions.
-- ---------------------------------------------------------------------
create table if not exists public.payment_settings (
  organization_id          uuid primary key references public.organizations(id) on delete cascade,
  card_enabled             boolean not null default true,
  ach_enabled              boolean not null default true,
  zelle_enabled            boolean not null default false,
  check_enabled            boolean not null default false,
  fee_saver_enabled        boolean not null default true,
  ach_hold_until_settled   boolean not null default true,
  save_methods_enabled     boolean not null default true,
  tips_enabled             boolean not null default false,
  suggested_tip_percents   integer[] not null default array[15,20,25],
  default_deposit_type     text not null default 'none' check (default_deposit_type in ('none','percent','fixed')),
  default_deposit_bps      integer not null default 0 check (default_deposit_bps between 0 and 10000),
  default_deposit_minor    bigint not null default 0 check (default_deposit_minor >= 0),
  zelle_recipient_name     text,
  zelle_email              text,
  zelle_phone              text,
  zelle_qr_url             text,
  zelle_instructions       text,
  check_payee              text,
  check_address            text,
  check_city_state_zip     text,
  check_memo_instructions  text,
  receipt_email_enabled    boolean not null default true,
  receipt_sms_enabled      boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (not zelle_enabled or zelle_email is not null or zelle_phone is not null),
  check (not check_enabled or (check_payee is not null and check_address is not null))
);

-- Keep every new organization ready for payment configuration.
create or replace function public.initialize_payment_settings()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.payment_settings (organization_id) values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end $$;
revoke execute on function public.initialize_payment_settings() from public, anon, authenticated;

drop trigger if exists trg_organizations_payment_settings on public.organizations;
create trigger trg_organizations_payment_settings
after insert on public.organizations
for each row execute function public.initialize_payment_settings();

insert into public.payment_settings (organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

-- ---------------------------------------------------------------------
-- 4. Deposit and progress-payment schedules.
-- ---------------------------------------------------------------------
create table if not exists public.payment_schedules (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  estimate_id       uuid references public.estimates(id) on delete cascade,
  invoice_id        uuid references public.invoices(id) on delete cascade,
  name              text not null default 'Deposit and final payment',
  status            text not null default 'active' check (status in ('draft','active','completed','cancelled')),
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (num_nonnulls(estimate_id, invoice_id) = 1)
);
create unique index if not exists idx_payment_schedules_id_org on public.payment_schedules(id, organization_id);
create index if not exists idx_payment_schedules_org on public.payment_schedules(organization_id, status);

create table if not exists public.payment_milestones (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  schedule_id       uuid not null,
  label             text not null,
  calculation_type  text not null check (calculation_type in ('percent','fixed','remaining')),
  amount_minor      bigint check (amount_minor is null or amount_minor >= 0),
  percent_bps       integer check (percent_bps is null or percent_bps between 0 and 10000),
  due_trigger       text not null default 'manual' check (due_trigger in ('on_approval','on_start','manual','on_completion')),
  sort              integer not null default 0,
  status            text not null default 'pending' check (status in ('pending','due','processing','paid','waived','cancelled')),
  due_at            timestamptz,
  paid_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint payment_milestones_schedule_org_fk
    foreign key (schedule_id, organization_id)
    references public.payment_schedules(id, organization_id) on delete cascade
);
create unique index if not exists idx_payment_milestones_id_org on public.payment_milestones(id, organization_id);
create index if not exists idx_payment_milestones_schedule on public.payment_milestones(schedule_id, sort);

-- ---------------------------------------------------------------------
-- 5. Provider-neutral requests, transactions, and manual submissions.
-- ---------------------------------------------------------------------
create table if not exists public.payment_requests (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  estimate_id            uuid references public.estimates(id) on delete cascade,
  invoice_id             uuid references public.invoices(id) on delete cascade,
  milestone_id           uuid,
  document_type          text not null check (document_type in ('estimate_deposit','invoice','milestone')),
  amount_minor           bigint not null check (amount_minor > 0),
  currency               text not null default 'USD' check (currency = 'USD'),
  allowed_methods        text[] not null default array['card','ach']::text[],
  status                 text not null default 'created'
                         check (status in ('created','action_required','submitted','processing','partially_paid','paid','failed','cancelled','expired','partially_refunded','refunded','disputed')),
  public_token           uuid not null default gen_random_uuid() unique,
  helcim_checkout_token  text,
  fee_saver_requested    boolean not null default false,
  expires_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (num_nonnulls(estimate_id, invoice_id) = 1),
  check (allowed_methods <@ array['card','ach','zelle','check']::text[]),
  constraint payment_requests_milestone_org_fk
    foreign key (milestone_id, organization_id)
    references public.payment_milestones(id, organization_id) on delete restrict
);
create unique index if not exists idx_payment_requests_id_org on public.payment_requests(id, organization_id);
create index if not exists idx_payment_requests_org_status on public.payment_requests(organization_id, status);
create index if not exists idx_payment_requests_document on public.payment_requests(estimate_id, invoice_id);
-- Only one reusable online checkout may be open for the same balance. This
-- prevents a customer from accidentally paying twice in two browser tabs.
create unique index if not exists idx_payment_requests_active_invoice_checkout
  on public.payment_requests(invoice_id)
  where invoice_id is not null and milestone_id is null
    and status in ('created','action_required','processing')
    and allowed_methods && array['card','ach']::text[];
create unique index if not exists idx_payment_requests_active_estimate_checkout
  on public.payment_requests(estimate_id)
  where estimate_id is not null and milestone_id is null
    and status in ('created','action_required','processing')
    and allowed_methods && array['card','ach']::text[];

create table if not exists public.payment_checkout_secrets (
  payment_request_id      uuid primary key references public.payment_requests(id) on delete cascade,
  encrypted_secret_token text not null,
  key_version            integer not null default 1,
  expires_at             timestamptz not null,
  created_at             timestamptz not null default now()
);

alter table public.payments add column if not exists provider text;
alter table public.payments add column if not exists provider_transaction_id text;
alter table public.payments add column if not exists normalized_status text;
alter table public.payments add column if not exists estimate_id uuid references public.estimates(id) on delete set null;
alter table public.payments add column if not exists payment_request_id uuid references public.payment_requests(id) on delete set null;
alter table public.payments add column if not exists base_amount_minor bigint;
alter table public.payments add column if not exists surcharge_minor bigint not null default 0;
alter table public.payments add column if not exists tip_minor bigint not null default 0;
alter table public.payments add column if not exists refunded_minor bigint not null default 0;
alter table public.payments add column if not exists submitted_at timestamptz;
alter table public.payments add column if not exists settled_at timestamptz;

update public.payments
set provider = case when stripe_payment_intent_id is not null then 'stripe' else 'manual' end
where provider is null;
update public.payments
set normalized_status = case when status = 'paid' then 'settled' else coalesce(status, 'created') end
where normalized_status is null;
update public.payments set base_amount_minor = amount_minor where base_amount_minor is null;

alter table public.payments alter column provider set default 'manual';
alter table public.payments alter column provider set not null;
alter table public.payments alter column normalized_status set default 'created';
alter table public.payments alter column normalized_status set not null;
alter table public.payments alter column base_amount_minor set not null;

-- Existing application paths do not yet send provider-neutral fields. This
-- trigger derives them so the migration cannot break manual or legacy Stripe
-- inserts while those paths are migrated incrementally.
create or replace function public.prepare_payment_row()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.provider is null then
    new.provider := case when new.stripe_payment_intent_id is not null then 'stripe' else 'manual' end;
  end if;
  if new.normalized_status is null then
    new.normalized_status := case when new.status = 'paid' then 'settled' else coalesce(new.status, 'created') end;
  end if;
  if new.base_amount_minor is null then new.base_amount_minor := new.amount_minor; end if;
  if new.submitted_at is null then new.submitted_at := coalesce(new.paid_at, now()); end if;
  if new.normalized_status = 'settled' and new.settled_at is null then
    new.settled_at := coalesce(new.paid_at, now());
  end if;
  return new;
end $$;
revoke execute on function public.prepare_payment_row() from public, anon, authenticated;

alter table public.payments alter column provider drop default;
alter table public.payments alter column normalized_status drop default;
drop trigger if exists trg_prepare_payment_row on public.payments;
create trigger trg_prepare_payment_row before insert or update on public.payments
for each row execute function public.prepare_payment_row();

do $$ begin
  alter table public.payments add constraint payments_normalized_status_check
    check (normalized_status in ('created','action_required','submitted','processing','settled','failed','cancelled','partially_refunded','refunded','disputed'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.payments add constraint payments_amount_parts_check
    check (base_amount_minor >= 0 and surcharge_minor >= 0 and tip_minor >= 0 and refunded_minor >= 0);
exception when duplicate_object then null; end $$;

create unique index if not exists idx_payments_provider_transaction
  on public.payments(organization_id, provider, provider_transaction_id)
  where provider_transaction_id is not null;
create index if not exists idx_payments_estimate on public.payments(estimate_id, settled_at);
create index if not exists idx_payments_request on public.payments(payment_request_id);

create table if not exists public.manual_payment_submissions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  payment_request_id  uuid not null,
  method              text not null check (method in ('zelle','check')),
  amount_minor        bigint not null check (amount_minor > 0),
  reference           text,
  mailed_on           date,
  status              text not null default 'verification_pending'
                      check (status in ('verification_pending','confirmed','rejected','reversed')),
  submitted_at        timestamptz not null default now(),
  confirmed_by        uuid references public.profiles(id) on delete set null,
  confirmed_at        timestamptz,
  decision_reason     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint manual_submission_request_org_fk
    foreign key (payment_request_id, organization_id)
    references public.payment_requests(id, organization_id) on delete cascade
);
create index if not exists idx_manual_payments_org_status on public.manual_payment_submissions(organization_id, status, submitted_at);

create table if not exists public.payment_events (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid references public.organizations(id) on delete cascade,
  provider          text not null,
  provider_event_id text not null,
  event_type        text not null,
  payload_digest    text not null,
  sanitized_data    jsonb not null default '{}'::jsonb,
  status            text not null default 'received' check (status in ('received','processed','ignored','needs_review','failed')),
  error_message     text,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  unique (provider, provider_event_id)
);
create index if not exists idx_payment_events_org on public.payment_events(organization_id, received_at desc);

create table if not exists public.payment_notifications (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  payment_id          uuid not null references public.payments(id) on delete cascade,
  event_type          text not null default 'receipt' check (event_type in ('receipt','status_update','refund')),
  channel             text not null check (channel in ('email','sms')),
  status              text not null default 'pending' check (status in ('pending','sent','failed')),
  provider_message_id text,
  error_message       text,
  attempts            integer not null default 0,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  updated_at          timestamptz not null default now(),
  unique (payment_id, event_type, channel)
);
create index if not exists idx_payment_notifications_retry
  on public.payment_notifications(status, created_at) where status in ('pending','failed');

-- Composite tenant guards for nullable document links.
do $$
begin
  if to_regprocedure('public.assert_child_org()') is not null then
    drop trigger if exists profile_payment_permissions_profile_org_guard on public.profile_payment_permissions;
    create trigger profile_payment_permissions_profile_org_guard before insert or update on public.profile_payment_permissions
      for each row execute function public.assert_child_org('profiles', 'profile_id');
    drop trigger if exists profile_payment_permissions_updater_org_guard on public.profile_payment_permissions;
    create trigger profile_payment_permissions_updater_org_guard before insert or update on public.profile_payment_permissions
      for each row execute function public.assert_child_org('profiles', 'updated_by');
    drop trigger if exists payment_schedules_estimate_org_guard on public.payment_schedules;
    create trigger payment_schedules_estimate_org_guard before insert or update on public.payment_schedules
      for each row execute function public.assert_child_org('estimates', 'estimate_id');
    drop trigger if exists payment_schedules_invoice_org_guard on public.payment_schedules;
    create trigger payment_schedules_invoice_org_guard before insert or update on public.payment_schedules
      for each row execute function public.assert_child_org('invoices', 'invoice_id');
    drop trigger if exists payment_requests_estimate_org_guard on public.payment_requests;
    create trigger payment_requests_estimate_org_guard before insert or update on public.payment_requests
      for each row execute function public.assert_child_org('estimates', 'estimate_id');
    drop trigger if exists payment_requests_invoice_org_guard on public.payment_requests;
    create trigger payment_requests_invoice_org_guard before insert or update on public.payment_requests
      for each row execute function public.assert_child_org('invoices', 'invoice_id');
    drop trigger if exists payments_estimate_org_guard on public.payments;
    create trigger payments_estimate_org_guard before insert or update on public.payments
      for each row execute function public.assert_child_org('estimates', 'estimate_id');
    drop trigger if exists payments_request_org_guard on public.payments;
    create trigger payments_request_org_guard before insert or update on public.payments
      for each row execute function public.assert_child_org('payment_requests', 'payment_request_id');
    drop trigger if exists payment_notifications_payment_org_guard on public.payment_notifications;
    create trigger payment_notifications_payment_org_guard before insert or update on public.payment_notifications
      for each row execute function public.assert_child_org('payments', 'payment_id');
  end if;
end $$;

-- Keep timestamps current.
do $$
declare t text;
begin
  foreach t in array array['profile_payment_permissions','merchant_connections','payment_settings','payment_schedules','payment_milestones','payment_requests','manual_payment_submissions','payment_notifications'] loop
    execute format('drop trigger if exists trg_%s_updated on public.%I;', t, t);
    execute format('create trigger trg_%s_updated before update on public.%I for each row execute function public.set_updated_at();', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. RLS and explicit Data API grants.
-- ---------------------------------------------------------------------
alter table public.merchant_connections enable row level security;
alter table public.profile_payment_permissions enable row level security;
alter table public.merchant_secrets enable row level security;
alter table public.payment_settings enable row level security;
alter table public.payment_schedules enable row level security;
alter table public.payment_milestones enable row level security;
alter table public.payment_requests enable row level security;
alter table public.payment_checkout_secrets enable row level security;
alter table public.manual_payment_submissions enable row level security;
alter table public.payment_events enable row level security;
alter table public.payment_notifications enable row level security;

drop policy if exists merchant_connections_select on public.merchant_connections;
create policy merchant_connections_select on public.merchant_connections for select to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() = 'owner');

drop policy if exists profile_payment_permissions_select on public.profile_payment_permissions;
create policy profile_payment_permissions_select on public.profile_payment_permissions for select to authenticated
  using (organization_id = public.current_org_id() and
         (public.current_user_role() = 'owner' or profile_id = auth.uid()));
drop policy if exists profile_payment_permissions_owner_write on public.profile_payment_permissions;
create policy profile_payment_permissions_owner_write on public.profile_payment_permissions for all to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() = 'owner')
  with check (organization_id = public.current_org_id() and public.current_user_role() = 'owner');

drop policy if exists merchant_secrets_no_client_access on public.merchant_secrets;
create policy merchant_secrets_no_client_access on public.merchant_secrets for all to anon, authenticated
  using (false) with check (false);

drop policy if exists payment_settings_select on public.payment_settings;
create policy payment_settings_select on public.payment_settings for select to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));
drop policy if exists payment_settings_owner_write on public.payment_settings;
create policy payment_settings_owner_write on public.payment_settings for all to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() = 'owner')
  with check (organization_id = public.current_org_id() and public.current_user_role() = 'owner');

drop policy if exists payment_schedules_select on public.payment_schedules;
create policy payment_schedules_select on public.payment_schedules for select to authenticated
  using (organization_id = public.current_org_id());
drop policy if exists payment_schedules_write on public.payment_schedules;
create policy payment_schedules_write on public.payment_schedules for all to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))
  with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));

drop policy if exists payment_milestones_select on public.payment_milestones;
create policy payment_milestones_select on public.payment_milestones for select to authenticated
  using (organization_id = public.current_org_id());
drop policy if exists payment_milestones_write on public.payment_milestones;
create policy payment_milestones_write on public.payment_milestones for all to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))
  with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));

drop policy if exists payment_requests_select on public.payment_requests;
create policy payment_requests_select on public.payment_requests for select to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));

drop policy if exists checkout_secrets_no_client_access on public.payment_checkout_secrets;
create policy checkout_secrets_no_client_access on public.payment_checkout_secrets for all to anon, authenticated
  using (false) with check (false);

drop policy if exists manual_payments_select on public.manual_payment_submissions;
create policy manual_payments_select on public.manual_payment_submissions for select to authenticated
  using (organization_id = public.current_org_id() and
    (public.current_user_role() = 'owner' or (public.current_user_role() = 'office' and exists (
      select 1 from public.profile_payment_permissions permission
       where permission.profile_id = auth.uid()
         and permission.organization_id = public.current_org_id()
         and permission.can_confirm_manual_payments
    ))));
drop policy if exists manual_payments_update on public.manual_payment_submissions;

drop policy if exists payment_events_owner_select on public.payment_events;
create policy payment_events_owner_select on public.payment_events for select to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() = 'owner');

drop policy if exists payment_notifications_select on public.payment_notifications;
create policy payment_notifications_select on public.payment_notifications for select to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));

grant select on public.merchant_connections, public.payment_events to authenticated;
grant select, insert, update, delete on public.profile_payment_permissions to authenticated;
grant select, insert, update, delete on public.payment_settings, public.payment_schedules, public.payment_milestones to authenticated;
grant select on public.payment_requests to authenticated;
grant select on public.manual_payment_submissions to authenticated;
grant select on public.payment_notifications to authenticated;
grant all on public.profile_payment_permissions, public.merchant_connections, public.merchant_secrets, public.payment_settings,
  public.payment_schedules, public.payment_milestones, public.payment_requests,
  public.payment_checkout_secrets, public.manual_payment_submissions, public.payment_events,
  public.payment_notifications to service_role;

revoke all on public.merchant_secrets, public.payment_checkout_secrets from anon, authenticated;
revoke all on public.profile_payment_permissions, public.merchant_connections, public.payment_settings, public.payment_schedules,
  public.payment_milestones, public.payment_requests, public.manual_payment_submissions,
  public.payment_events, public.payment_notifications from anon;

-- ---------------------------------------------------------------------
-- 7. Safe public payment choices for an opaque estimate/invoice token.
-- ---------------------------------------------------------------------
create or replace function public.public_payment_options(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_est uuid; v_inv uuid; v_kind text; v_amount bigint; v_currency text;
  v_number bigint; v_signed boolean; v_paid bigint := 0; v_processing boolean := false;
  cfg public.payment_settings%rowtype; conn public.merchant_connections%rowtype;
begin
  select e.id, e.organization_id, 'estimate_deposit', e.deposit_minor, o.currency, e.number, e.signed_at is not null
    into v_est, v_org, v_kind, v_amount, v_currency, v_number, v_signed
    from public.estimates e join public.organizations o on o.id = e.organization_id
   where e.public_token = p_token and e.deleted_at is null;

  if not found then
    select i.id, i.organization_id, 'invoice', i.total_minor, o.currency, i.number, true
      into v_inv, v_org, v_kind, v_amount, v_currency, v_number, v_signed
      from public.invoices i join public.organizations o on o.id = i.organization_id
     where i.public_token = p_token and i.deleted_at is null;
    if not found then return null; end if;
  end if;

  select * into cfg from public.payment_settings where organization_id = v_org;
  if not found then return jsonb_build_object('available', false, 'reason', 'not_configured'); end if;
  select * into conn from public.merchant_connections where organization_id = v_org;

  if v_kind = 'invoice' then
    select coalesce(sum(greatest(base_amount_minor - refunded_minor, 0)), 0) into v_paid
      from public.payments
     where organization_id = v_org and invoice_id = v_inv and normalized_status in ('settled','partially_refunded');
  else
    select coalesce(sum(greatest(base_amount_minor - refunded_minor, 0)), 0) into v_paid
      from public.payments
     where organization_id = v_org and estimate_id = v_est and normalized_status in ('settled','partially_refunded');
  end if;

  v_amount := greatest(coalesce(v_amount, 0) - v_paid, 0);

  select exists (
    select 1 from public.payment_requests request
     where request.organization_id = v_org
       and request.status = 'processing'
       and ((v_inv is not null and request.invoice_id = v_inv) or
            (v_est is not null and request.estimate_id = v_est))
  ) into v_processing;

  return jsonb_build_object(
    'available', v_amount > 0 and not v_processing,
    'reason', case when v_processing then 'payment_processing' else null end,
    'kind', v_kind,
    'number', v_number,
    'signed', v_signed,
    'amount_minor', v_amount,
    'currency', v_currency,
    'methods', jsonb_build_object(
      'helcim', coalesce(conn.status = 'approved' and
                ((cfg.card_enabled and conn.card_enabled) or (cfg.ach_enabled and conn.ach_enabled)), false),
      'card', coalesce(conn.status = 'approved' and cfg.card_enabled and conn.card_enabled, false),
      'ach', coalesce(conn.status = 'approved' and cfg.ach_enabled and conn.ach_enabled, false),
      'zelle', cfg.zelle_enabled,
      'check', cfg.check_enabled
    ),
    'fee_saver', coalesce(cfg.fee_saver_enabled and conn.fee_saver_eligible and cfg.ach_enabled and conn.ach_enabled, false),
    'zelle', case when cfg.zelle_enabled then jsonb_build_object(
      'recipient_name', cfg.zelle_recipient_name,
      'email', cfg.zelle_email,
      'phone', cfg.zelle_phone,
      'qr_url', cfg.zelle_qr_url,
      'instructions', cfg.zelle_instructions,
      'memo', upper(v_kind) || '-' || v_number::text
    ) else null end,
    'check', case when cfg.check_enabled then jsonb_build_object(
      'payee', cfg.check_payee,
      'address', cfg.check_address,
      'city_state_zip', cfg.check_city_state_zip,
      'memo_instructions', cfg.check_memo_instructions,
      'memo', upper(v_kind) || '-' || v_number::text
    ) else null end
  );
end $$;

revoke execute on function public.public_payment_options(uuid) from public;
grant execute on function public.public_payment_options(uuid) to anon, authenticated;

-- =====================================================================
-- End migration 017.
-- =====================================================================
