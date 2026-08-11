-- =====================================================================
--  ServicePro — Migration 038 (account security)
--  Run once in the Supabase SQL Editor, AFTER 037. Safe to re-run.
--
--  WHAT WAS MISSING
--  ----------------
--  Nothing in this product had ever recorded WHO was at the other end of a
--  connection. `grep -rn "x-forwarded-for" app lib` returned a single comment
--  in the rate limiter. The consequences were not cosmetic:
--
--    * an approved estimate stored a typed name and a PNG. No IP, no user
--      agent, no timestamped evidence record. As e-signature evidence under
--      ESIGN/UETA that is close to worthless — nothing ties the signature to
--      the person or the session that produced it.
--    * staff sign-in was unthrottled and unlogged. An owner account controlling
--      payouts could be guessed at indefinitely and leave no trace.
--    * role and capability changes — including `can_refund_payments` and owner
--      rights — left NO record anywhere. `app/(app)/team/actions.ts` had no
--      audit call at all.
--    * `merchant_secrets.key_version` has existed since 017 and nothing ever
--      wrote anything but its default, so PAYMENT_SECRETS_KEY could not be
--      rotated without making every stored Helcim token unreadable.
--
--  THIS MIGRATION IS ADDITIVE. It drops no existing table, policy, column or
--  grant. The one existing function it replaces is `approve_document`, and the
--  `signed_at is null` guard migration 023 §6 added is preserved VERBATIM —
--  see section 5, which asserts that in a comment and in
--  tests/account-security.test.mjs.
--
--  NOT WEAKENED BY THIS FILE (checked, not assumed): profiles_self_update,
--  accept_invitation, the invitations policies, and every other object touched
--  by db/023_authorization_hardening.sql. None of them is referenced here.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Helper: parse a client-supplied IP without ever aborting the caller.
--
--    The address arrives as text from a header. A malformed value must not
--    take down a sign-in or, worse, a customer's signature — it must be
--    recorded as absent.
-- ---------------------------------------------------------------------
create or replace function public.safe_inet(p_value text)
returns inet language plpgsql immutable as $$
begin
  if p_value is null or btrim(p_value) = '' then return null; end if;
  return btrim(p_value)::inet;
exception when others then
  return null;
end $$;
revoke all on function public.safe_inet(text) from public, anon;
grant execute on function public.safe_inet(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. Login attempts — the brute-force ledger.
--
--    Every attempt, successful or not, including attempts against addresses
--    that do not exist (which is exactly what an attack looks like). The
--    organisation is resolved when the address belongs to a real member, so an
--    owner can see attacks against their own business and cannot see anyone
--    else's.
-- ---------------------------------------------------------------------
create table if not exists public.auth_login_attempts (
  id               bigint generated always as identity primary key,
  email_key        text not null,
  organization_id  uuid references public.organizations(id) on delete set null,
  profile_id       uuid references public.profiles(id) on delete set null,
  success          boolean not null,
  reason           text,
  ip               inet,
  ip_source        text,
  ip_trusted       boolean not null default false,
  network_prefix   text,
  user_agent       text,
  device_label     text,
  at               timestamptz not null default now()
);
create index if not exists idx_login_attempts_email on public.auth_login_attempts (email_key, at desc);
create index if not exists idx_login_attempts_network on public.auth_login_attempts (network_prefix, at desc) where network_prefix is not null;
create index if not exists idx_login_attempts_org on public.auth_login_attempts (organization_id, at desc);

-- ---------------------------------------------------------------------
-- 2. Account security events — sign-ins, new devices, password changes,
--    two-factor enrolment, session revocation.
-- ---------------------------------------------------------------------
create table if not exists public.account_security_events (
  id               bigint generated always as identity primary key,
  organization_id  uuid references public.organizations(id) on delete cascade,
  profile_id       uuid references public.profiles(id) on delete cascade,
  event_type       text not null,
  ip               inet,
  ip_source        text,
  ip_trusted       boolean not null default false,
  user_agent       text,
  device_label     text,
  device_signature text,
  details          jsonb,
  at               timestamptz not null default now()
);
create index if not exists idx_security_events_profile on public.account_security_events (profile_id, at desc);
create index if not exists idx_security_events_org on public.account_security_events (organization_id, at desc);

-- ---------------------------------------------------------------------
-- 3. Permission-change history.
--
--    Written by TRIGGERS, not by application code, on purpose. The threat
--    model for this branch is an attacker who skips the server actions and
--    talks to PostgREST directly; a log written in `team/actions.ts` would
--    record only the changes made politely through the UI. A trigger records
--    the change whichever door it came through.
-- ---------------------------------------------------------------------
create table if not exists public.permission_change_log (
  id                  bigint generated always as identity primary key,
  organization_id     uuid,
  subject_profile_id  uuid,
  actor_profile_id    uuid,
  source_table        text not null,
  operation           text not null,
  changes             jsonb not null,
  ip                  inet,
  user_agent          text,
  at                  timestamptz not null default now()
);
create index if not exists idx_permission_log_org on public.permission_change_log (organization_id, at desc);
create index if not exists idx_permission_log_subject on public.permission_change_log (subject_profile_id, at desc);

create or replace function public.record_permission_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  watched text[];
  before_data jsonb;
  after_data jsonb;
  changes jsonb := '{}'::jsonb;
  k text;
  subject uuid;
  org uuid;
begin
  if tg_op = 'INSERT' then before_data := '{}'::jsonb; else before_data := to_jsonb(old); end if;
  if tg_op = 'DELETE' then after_data  := '{}'::jsonb; else after_data  := to_jsonb(new); end if;

  if tg_table_name = 'profiles' then
    -- The four columns migration 023 §1 made owner-only. A change to any of
    -- them is a privilege change by definition.
    watched := array['role', 'active', 'commission_pct', 'organization_id'];
    subject := nullif(coalesce(after_data ->> 'id', before_data ->> 'id'), '')::uuid;
  elsif tg_table_name = 'profile_capabilities' then
    watched := array[
      'can_view_customers', 'can_edit_customers', 'can_manage_schedule', 'can_edit_jobs',
      'can_manage_estimates', 'can_manage_invoices', 'can_manage_payments', 'can_view_reports',
      'can_manage_purchasing', 'can_manage_automations', 'can_manage_settings', 'can_manage_team'];
    subject := nullif(coalesce(after_data ->> 'profile_id', before_data ->> 'profile_id'), '')::uuid;
  elsif tg_table_name = 'invitations' then
    -- An invitation is a permission grant in waiting. An office user issuing
    -- themselves an owner invitation is the escalation 023 §2 closed; the
    -- attempt should still be on the record.
    watched := array['role', 'email', 'accepted_at'];
    subject := null;
  else
    watched := array['can_confirm_manual_payments', 'can_refund_payments', 'can_override_ach_holds'];
    subject := nullif(coalesce(after_data ->> 'profile_id', before_data ->> 'profile_id'), '')::uuid;
  end if;

  foreach k in array watched loop
    if (before_data -> k) is distinct from (after_data -> k) then
      changes := changes || jsonb_build_object(k, jsonb_build_object('from', before_data -> k, 'to', after_data -> k));
    end if;
  end loop;

  -- An ordinary edit (name, theme, updated_at) is not a permission change and
  -- must not fill the history with noise nobody will read.
  if changes = '{}'::jsonb then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  org := nullif(coalesce(after_data ->> 'organization_id', before_data ->> 'organization_id'), '')::uuid;
  insert into public.permission_change_log
    (organization_id, subject_profile_id, actor_profile_id, source_table, operation, changes)
  values (org, subject, auth.uid(), tg_table_name, tg_op, changes);

  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.record_permission_change() from public, anon, authenticated;

drop trigger if exists trg_profiles_permission_log on public.profiles;
create trigger trg_profiles_permission_log
  after update or delete on public.profiles
  for each row execute function public.record_permission_change();

do $$
begin
  if to_regclass('public.profile_capabilities') is not null then
    execute 'drop trigger if exists trg_profile_capabilities_permission_log on public.profile_capabilities';
    execute 'create trigger trg_profile_capabilities_permission_log after insert or update or delete on public.profile_capabilities for each row execute function public.record_permission_change()';
  end if;
  if to_regclass('public.profile_payment_permissions') is not null then
    execute 'drop trigger if exists trg_profile_payment_permissions_permission_log on public.profile_payment_permissions';
    execute 'create trigger trg_profile_payment_permissions_permission_log after insert or update or delete on public.profile_payment_permissions for each row execute function public.record_permission_change()';
  end if;
  if to_regclass('public.invitations') is not null then
    execute 'drop trigger if exists trg_invitations_permission_log on public.invitations';
    execute 'create trigger trg_invitations_permission_log after insert or update or delete on public.invitations for each row execute function public.record_permission_change()';
  end if;
end $$;

-- The trigger cannot see an HTTP header, so it records WHO and WHAT but not
-- FROM WHERE. The server action stamps the context onto the rows it just
-- caused. An actor can only ever stamp their own changes, so this adds
-- provenance without adding a forgery path; a change made straight through
-- PostgREST simply keeps a null IP, which is itself informative.
create or replace function public.stamp_permission_change_context(
  p_subject uuid, p_since timestamptz, p_ip text, p_user_agent text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if auth.uid() is null then return 0; end if;
  update public.permission_change_log
     set ip = public.safe_inet(p_ip),
         user_agent = left(nullif(btrim(coalesce(p_user_agent, '')), ''), 400)
   where actor_profile_id = auth.uid()
     and subject_profile_id is not distinct from p_subject
     and at >= coalesce(p_since, now() - interval '1 minute')
     and ip is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.stamp_permission_change_context(uuid, timestamptz, text, text) from public, anon;
grant execute on function public.stamp_permission_change_context(uuid, timestamptz, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Per-profile security state (login alerts, MFA mirror, revocation mark).
--
--    Supabase Auth owns the factors and the sessions. This table holds only
--    what the product needs to SHOW and to AUDIT: it is deliberately not a
--    second source of truth for whether MFA is on.
-- ---------------------------------------------------------------------
create table if not exists public.profile_security (
  profile_id             uuid primary key references public.profiles(id) on delete cascade,
  organization_id        uuid references public.organizations(id) on delete cascade,
  login_alerts_enabled   boolean not null default true,
  mfa_enrolled_at        timestamptz,
  mfa_removed_at         timestamptz,
  sessions_revoked_at    timestamptz,
  last_password_change_at timestamptz,
  last_sign_in_at        timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_profile_security_org on public.profile_security (organization_id);

drop trigger if exists trg_profile_security_updated on public.profile_security;
create trigger trg_profile_security_updated before update on public.profile_security
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 5. E-signature evidence.
--
--    `approve_document` is called from the BROWSER (components/SignApprove.tsx
--    used supabase.rpc directly), so the server never saw a request context at
--    all and no evidence could exist. Two things change:
--
--      a) every signature now writes an append-only evidence row, whichever
--         path produced it;
--      b) a new service-role-only entry point carries the IP and user agent
--         the SERVER observed, and the app's signing path goes through it.
--
--    `approve_document` keeps its anon grant and its exact signature and
--    return type, because migration 004 created it, 013 granted it, 023 §6
--    added the sign-once guard and db/ci/40_document_assertions.sql calls it
--    as `anon`. Removing the anon grant would break that proof. Instead the
--    un-evidenced path is now SELF-DECLARING: it writes an evidence row with
--    capture = 'none', so a signature taken without request context is visible
--    as such rather than indistinguishable from a properly witnessed one.
-- ---------------------------------------------------------------------
alter table public.estimates add column if not exists signature_ip inet;
alter table public.estimates add column if not exists signature_user_agent text;
alter table public.invoices  add column if not exists signature_ip inet;
alter table public.invoices  add column if not exists signature_user_agent text;

create table if not exists public.document_signature_events (
  id               bigint generated always as identity primary key,
  organization_id  uuid references public.organizations(id) on delete cascade,
  document_type    text not null check (document_type in ('estimate', 'invoice')),
  document_id      uuid,
  signer_name      text,
  signature_bytes  integer not null default 0,
  signature_sha256 text,
  capture          text not null default 'none' check (capture in ('none', 'server')),
  ip               inet,
  ip_source        text,
  ip_trusted       boolean not null default false,
  user_agent       text,
  device_label     text,
  signed_at        timestamptz not null default now()
);
create index if not exists idx_signature_events_document on public.document_signature_events (document_type, document_id, signed_at desc);
create index if not exists idx_signature_events_org on public.document_signature_events (organization_id, signed_at desc);

create or replace function public.approve_document_with_evidence(
  p_token uuid, p_name text, p_sig text,
  p_ip text default null, p_ip_source text default null, p_ip_trusted boolean default false,
  p_user_agent text default null, p_device text default null, p_sig_sha256 text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n int;
  kind text;
  doc_id uuid;
  org_id uuid;
  clean_name text := left(coalesce(nullif(trim(p_name), ''), 'Customer'), 120);
  clean_sig  text := left(coalesce(p_sig, ''), 400000);
  ip_value inet := public.safe_inet(p_ip);
  ua_value text := left(nullif(btrim(coalesce(p_user_agent, '')), ''), 400);
  capture_mode text := case when p_ip is not null or p_user_agent is not null then 'server' else 'none' end;
begin
  -- 023 §6's guard, preserved verbatim: sign once. Re-signing destroyed the
  -- original evidence and wrote ~800 KB of audit rows per call.
  update public.estimates
     set status = case when status in ('draft','sent') then 'approved'::estimate_status else status end,
         signer_name = clean_name,
         signed_at = now(),
         signature_data = clean_sig,
         signature_ip = ip_value,
         signature_user_agent = ua_value
   where public_token = p_token and deleted_at is null
     and signed_at is null
  returning id, organization_id into doc_id, org_id;
  get diagnostics n = row_count;
  if n > 0 then kind := 'estimate'; end if;

  if n = 0 then
    update public.invoices
       set signer_name = clean_name,
           signed_at = now(),
           signature_data = clean_sig,
           signature_ip = ip_value,
           signature_user_agent = ua_value
     where public_token = p_token and deleted_at is null
       and signed_at is null
    returning id, organization_id into doc_id, org_id;
    get diagnostics n = row_count;
    if n > 0 then kind := 'invoice'; end if;
  end if;

  if n = 0 then return jsonb_build_object('ok', false); end if;

  insert into public.document_signature_events
    (organization_id, document_type, document_id, signer_name, signature_bytes, signature_sha256,
     capture, ip, ip_source, ip_trusted, user_agent, device_label)
  values (org_id, kind, doc_id, clean_name, length(clean_sig), left(nullif(btrim(coalesce(p_sig_sha256, '')), ''), 64),
          capture_mode, ip_value, left(nullif(btrim(coalesce(p_ip_source, '')), ''), 60),
          coalesce(p_ip_trusted, false), ua_value, left(nullif(btrim(coalesce(p_device, '')), ''), 80));

  return jsonb_build_object('ok', true, 'kind', kind, 'id', doc_id, 'capture', capture_mode);
end $$;
-- Service role only. If the browser could call this it could dictate its own
-- IP address, which is worse than having none: forged evidence is evidence
-- against you.
revoke all on function public.approve_document_with_evidence(uuid, text, text, text, text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.approve_document_with_evidence(uuid, text, text, text, text, boolean, text, text, text) to service_role;

-- Same signature, same return type, same anon grant as 023 §6. It now delegates,
-- so the sign-once guard exists in exactly one place and the un-witnessed path
-- still produces an evidence row (capture = 'none').
create or replace function public.approve_document(p_token uuid, p_name text, p_sig text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  return coalesce((public.approve_document_with_evidence(p_token, p_name, p_sig) ->> 'ok')::boolean, false);
end $$;
revoke execute on function public.approve_document(uuid, text, text) from public;
grant  execute on function public.approve_document(uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Login attempt recording and throttle counting.
--
--    Both are service-role only and are called from the login server action,
--    never from the browser. Counting in the DATABASE is the point: the
--    in-process limiter in lib/core/rate-limit.mjs is per-instance and says so
--    in its own header, which is not good enough for authentication.
-- ---------------------------------------------------------------------
create or replace function public.record_login_attempt(
  p_email text, p_success boolean, p_reason text default null,
  p_ip text default null, p_ip_source text default null, p_ip_trusted boolean default false,
  p_network text default null, p_user_agent text default null, p_device text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  key text := lower(btrim(coalesce(p_email, '')));
  uid uuid;
  org uuid;
  new_id bigint;
begin
  if key = '' then return null; end if;

  select u.id into uid from auth.users u where lower(u.email) = key limit 1;
  if uid is not null then
    select p.organization_id into org from public.profiles p where p.id = uid;
  end if;

  insert into public.auth_login_attempts
    (email_key, organization_id, profile_id, success, reason, ip, ip_source, ip_trusted, network_prefix, user_agent, device_label)
  values (key, org, uid, coalesce(p_success, false), left(nullif(btrim(coalesce(p_reason, '')), ''), 120),
          public.safe_inet(p_ip), left(nullif(btrim(coalesce(p_ip_source, '')), ''), 60), coalesce(p_ip_trusted, false),
          left(nullif(btrim(coalesce(p_network, '')), ''), 60), left(nullif(btrim(coalesce(p_user_agent, '')), ''), 400),
          left(nullif(btrim(coalesce(p_device, '')), ''), 80))
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.record_login_attempt(text, boolean, text, text, text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.record_login_attempt(text, boolean, text, text, text, boolean, text, text, text) to service_role;

create or replace function public.login_throttle_counts(
  p_email text, p_network text default null, p_window_minutes integer default 15)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  key text := lower(btrim(coalesce(p_email, '')));
  net text := nullif(btrim(coalesce(p_network, '')), '');
  window_start timestamptz := now() - (greatest(coalesce(p_window_minutes, 15), 1) || ' minutes')::interval;
  last_success timestamptz;
  account_failures integer := 0;
  last_account timestamptz;
  ip_failures integer := 0;
  last_ip timestamptz;
begin
  if key = '' then return jsonb_build_object('account_failures', 0, 'ip_failures', 0); end if;

  -- Failures are counted only since the last SUCCESSFUL sign-in, so somebody
  -- who mistypes twice and then gets in is not one attempt from a lockout.
  select max(a.at) into last_success
    from public.auth_login_attempts a where a.email_key = key and a.success;

  select count(*), max(a.at) into account_failures, last_account
    from public.auth_login_attempts a
   where a.email_key = key and not a.success
     and a.at > window_start
     and a.at > coalesce(last_success, '-infinity'::timestamptz);

  if net is not null then
    select count(*), max(a.at) into ip_failures, last_ip
      from public.auth_login_attempts a
     where a.network_prefix = net and not a.success and a.at > window_start;
  end if;

  return jsonb_build_object(
    'account_failures', coalesce(account_failures, 0),
    'last_account_failure_at', last_account,
    'ip_failures', coalesce(ip_failures, 0),
    'last_ip_failure_at', last_ip);
end $$;
revoke all on function public.login_throttle_counts(text, text, integer) from public, anon, authenticated;
grant execute on function public.login_throttle_counts(text, text, integer) to service_role;

-- ---------------------------------------------------------------------
-- 7. Encryption-key rotation bookkeeping.
--
--    `merchant_secrets.key_version` has been inert since 017. A rotation now
--    leaves a record of what moved, from which version to which, and whether
--    it finished.
-- ---------------------------------------------------------------------
create table if not exists public.secret_key_rotations (
  id             bigint generated always as identity primary key,
  target         text not null,
  from_versions  integer[] not null default '{}',
  to_version     integer not null,
  rows_total     integer not null default 0,
  rows_rotated   integer not null default 0,
  rows_skipped   integer not null default 0,
  status         text not null default 'running' check (status in ('running', 'completed', 'failed', 'refused')),
  error          text,
  actor          uuid,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index if not exists idx_secret_key_rotations_started on public.secret_key_rotations (started_at desc);

do $$
begin
  if to_regclass('public.merchant_secrets') is not null then
    execute 'alter table public.merchant_secrets drop constraint if exists merchant_secrets_key_version_check';
    execute 'alter table public.merchant_secrets add constraint merchant_secrets_key_version_check check (key_version >= 1)';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Row-level security and grants.
--
--    Threat model is PostgREST, not the UI. Every new table is denied to anon
--    outright; the tables a business legitimately reads get a role-predicated
--    select policy and NO write policy, so they can only ever be written by
--    the definer functions and triggers above (service_role bypasses RLS).
-- ---------------------------------------------------------------------
alter table public.auth_login_attempts       enable row level security;
alter table public.account_security_events   enable row level security;
alter table public.permission_change_log     enable row level security;
alter table public.document_signature_events enable row level security;
alter table public.profile_security          enable row level security;
alter table public.secret_key_rotations      enable row level security;

drop policy if exists auth_login_attempts_select on public.auth_login_attempts;
create policy auth_login_attempts_select on public.auth_login_attempts for select to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() = 'owner');

drop policy if exists account_security_events_select on public.account_security_events;
create policy account_security_events_select on public.account_security_events for select to authenticated
  using (organization_id = public.current_org_id()
         and (profile_id = auth.uid() or public.current_user_role() = 'owner'));

drop policy if exists permission_change_log_select on public.permission_change_log;
create policy permission_change_log_select on public.permission_change_log for select to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() = 'owner');

drop policy if exists document_signature_events_select on public.document_signature_events;
create policy document_signature_events_select on public.document_signature_events for select to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner', 'office'));

drop policy if exists profile_security_self on public.profile_security;
create policy profile_security_self on public.profile_security for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and organization_id = public.current_org_id());

drop policy if exists profile_security_owner_select on public.profile_security;
create policy profile_security_owner_select on public.profile_security for select to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() = 'owner');

-- secret_key_rotations gets NO policy at all: it is platform bookkeeping and
-- only the service role has any business reading it.

do $$
declare t text;
begin
  foreach t in array array[
    'auth_login_attempts', 'account_security_events', 'permission_change_log',
    'document_signature_events', 'profile_security', 'secret_key_rotations'
  ] loop
    execute format('revoke all on public.%I from anon;', t);
    execute format('grant all on public.%I to service_role;', t);
  end loop;

  -- Read-only to members; every write path is a definer function or a trigger.
  foreach t in array array[
    'auth_login_attempts', 'account_security_events', 'permission_change_log', 'document_signature_events'
  ] loop
    execute format('revoke insert, update, delete on public.%I from authenticated;', t);
    execute format('grant select on public.%I to authenticated;', t);
  end loop;

  execute 'grant select, insert, update on public.profile_security to authenticated';
  execute 'revoke delete on public.profile_security from authenticated';
  execute 'revoke all on public.secret_key_rotations from authenticated';
end $$;

-- =====================================================================
-- End migration 038.
-- =====================================================================
