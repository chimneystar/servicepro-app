-- =====================================================================
--  ServicePro — Migration 034: notifications, support access, invitations
--
--  Closes three stored-but-inert features (remediation ledger 5.13, 5.17, 5.18).
--
--   5.13  Push notifications were ENROLLED and never DELIVERED. Subscriptions
--         were stored, the service worker handled `push`, and no sender existed
--         anywhere. The sender now lives in lib/push.ts; this migration gives
--         `push_notification_events` the link back to what the notification was
--         about, so a delivery failure can be traced to a job.
--
--   5.17  `support_sessions` recorded a time-boxed, reason-bound, revocable
--         grant that NO CODE READ. Access is now evaluated against the session
--         (lib/core/support-access.mjs + lib/platform-admin.ts) and every
--         attempt — granted or refused — is written to the new
--         `support_session_events` table, so support access finally has an
--         audit trail rather than an unused row.
--
--   5.18  Invitations were never delivered: a `token` was generated, written,
--         and never used, and NO EMAIL WAS EVER SENT. Worse,
--         `accept_invitation()` matched on EMAIL ALONE, so possession of the
--         mailbox was the only control and the token protected nothing.
--         `accept_invitation(text)` now REQUIRES the token AND the email of the
--         invitation to match the caller. The owner-invite guard added by
--         023 §2 is preserved verbatim — it is not weakened here.
--
--  Idempotent. Re-runnable. This migration DROPS NOTHING: no table, no policy,
--  no function is dropped, and no existing row is deleted. Every policy is
--  created only if a policy of that name does not already exist, and the two
--  functions that change are changed with CREATE OR REPLACE, which preserves
--  their existing grants.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Push delivery: trace an event back to the thing it was about.
--    (`push_notification_events` was created by 018_product_foundation.sql
--     with organization_id / profile_id / event_type / title / body /
--     target_url / status / error_message / created_at / sent_at.)
-- ---------------------------------------------------------------------
alter table public.push_notification_events add column if not exists related_type text;
alter table public.push_notification_events add column if not exists related_id   uuid;
alter table public.push_notification_events add column if not exists device_count integer not null default 0;

create index if not exists idx_push_events_org_created
  on public.push_notification_events(organization_id, created_at desc);
create index if not exists idx_push_events_related
  on public.push_notification_events(related_type, related_id)
  where related_id is not null;

comment on column public.push_notification_events.device_count is
  'How many enabled device_subscriptions the send actually reached. 0 with status=sent is impossible; 0 with status=unavailable means nobody could be reached and the app says so.';

-- ---------------------------------------------------------------------
-- 2. Support access: prove the session was consulted.
--    Service-role only, exactly like every other platform table created by
--    022_operations_privacy_team_admin.sql §4. Tenants get no grants at all.
-- ---------------------------------------------------------------------
create table if not exists public.support_session_events (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid references public.support_sessions(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  admin_user_id   uuid not null references auth.users(id) on delete cascade,
  action          text not null,
  granted         boolean not null,
  refusal_reason  text,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_support_session_events_session
  on public.support_session_events(session_id, created_at desc);
create index if not exists idx_support_session_events_org
  on public.support_session_events(organization_id, created_at desc);

alter table public.support_session_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'support_session_events'
       and policyname = 'support_session_events_deny_clients'
  ) then
    create policy support_session_events_deny_clients on public.support_session_events
      for all to anon, authenticated using (false) with check (false);
  end if;
end $$;

revoke all on public.support_session_events from anon, authenticated;
grant all  on public.support_session_events to service_role;

comment on table public.support_session_events is
  'Every attempt by platform staff to reach a business through a support session, granted or refused. Before this, support_sessions was written and never read: revoking a session changed a timestamp and nothing else.';

-- ---------------------------------------------------------------------
-- 3. Invitations: delivery state, and an acceptance that needs the token.
-- ---------------------------------------------------------------------
alter table public.invitations add column if not exists sent_at         timestamptz;
alter table public.invitations add column if not exists delivery_status text not null default 'pending';
alter table public.invitations add column if not exists delivery_error  text;
alter table public.invitations add column if not exists accepted_by     uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'invitations_delivery_status_check'
       and conrelid = 'public.invitations'::regclass
  ) then
    alter table public.invitations
      add constraint invitations_delivery_status_check
      check (delivery_status in ('pending','sent','failed','unavailable'));
  end if;
end $$;

comment on column public.invitations.delivery_status is
  'pending until the invitation email is attempted. Before this column existed no email was EVER sent, and the screen still showed the invite as if the person had been told.';

-- Fast, exact token lookup for acceptance. Partial: an accepted or expired
-- invitation must never be found by token either.
create index if not exists idx_invitations_token_open
  on public.invitations (token) where accepted_at is null;

-- ---------------------------------------------------------------------
-- 3a. accept_invitation(text) — the token now means something.
--
--     Requires ALL of:
--       * a token that matches an open, unexpired invitation
--       * the caller's auth email to equal that invitation's email
--       * for role='owner', an owner-issued invitation (023 §2, unchanged)
--
--     Email alone is no longer sufficient, which was the whole defect: the
--     token was generated, stored, and never checked by anything.
-- ---------------------------------------------------------------------
create or replace function public.accept_invitation(invite_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare em text; inv record; inviter_role text; wanted text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  -- Already in a business: idempotent, same answer the no-argument form gave.
  if exists (select 1 from public.profiles where id = auth.uid() and organization_id is not null) then
    return (select organization_id from public.profiles where id = auth.uid());
  end if;

  wanted := btrim(coalesce(invite_token, ''));
  if wanted = '' then return null; end if;

  select email into em from auth.users where id = auth.uid();
  if em is null then return null; end if;

  select * into inv from public.invitations
    where token = wanted and accepted_at is null and expires_at > now()
    limit 1;
  if not found then return null; end if;

  -- The token identifies the invitation; the email still has to match it, so a
  -- forwarded or leaked link cannot be redeemed by a different account.
  if lower(inv.email) is distinct from lower(em) then
    raise exception 'invitation_email_mismatch' using errcode = 'insufficient_privilege';
  end if;

  -- PRESERVED FROM 023 §2 — an owner-level invitation is only honoured if an
  -- owner actually issued it. Do not weaken this.
  if inv.role::text = 'owner' then
    select p.role::text into inviter_role from public.profiles p where p.id = inv.invited_by;
    if inviter_role is distinct from 'owner' then
      raise exception 'invitation_role_not_permitted' using errcode = 'insufficient_privilege';
    end if;
  end if;

  insert into public.profiles (id, organization_id, full_name, role)
    values (auth.uid(), inv.organization_id, '', inv.role)
    on conflict (id) do update set organization_id = excluded.organization_id, role = excluded.role;

  update public.invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = inv.id;
  return inv.organization_id;
end $$;

revoke execute on function public.accept_invitation(text) from public, anon;
grant  execute on function public.accept_invitation(text) to authenticated;

comment on function public.accept_invitation(text) is
  'Redeem a team invitation. Requires the emailed token AND the invited email address. Replaces the email-only match, under which the generated token protected nothing.';

-- ---------------------------------------------------------------------
-- 3b. accept_invitation() — kept, but it no longer grants on email alone.
--
--     NOT DROPPED: the zero-argument function stays so that anything still
--     calling it keeps working, and so its grants are preserved. It now only
--     answers the harmless question "which business am I already in?".
--     Joining requires the token via accept_invitation(text).
-- ---------------------------------------------------------------------
create or replace function public.accept_invitation()
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return (select organization_id from public.profiles where id = auth.uid());
end $$;

revoke execute on function public.accept_invitation() from public, anon;
grant  execute on function public.accept_invitation() to authenticated;

comment on function public.accept_invitation() is
  'Retained for compatibility. It NO LONGER joins a business: possession of a mailbox is not a credential. Use accept_invitation(token), which is what the emailed link carries.';

-- ---------------------------------------------------------------------
-- 3c. pending_invitation_hint() — so requiring the token cannot strand anyone.
--
--     A person who was invited but signs up without opening the link would
--     otherwise land on onboarding and create a SECOND business. This tells
--     them an invitation is waiting and who it is from. It deliberately does
--     NOT return the token, so it grants nothing.
-- ---------------------------------------------------------------------
create or replace function public.pending_invitation_hint()
returns table(organization_name text, invited_email text, expires_at timestamptz)
language sql security definer set search_path = public stable as $$
  select o.name, i.email, i.expires_at
    from public.invitations i
    join public.organizations o on o.id = i.organization_id
   where auth.uid() is not null
     and lower(i.email) = lower((select u.email from auth.users u where u.id = auth.uid()))
     and i.accepted_at is null
     and i.expires_at > now()
   order by i.created_at desc
   limit 1;
$$;

revoke execute on function public.pending_invitation_hint() from public, anon;
grant  execute on function public.pending_invitation_hint() to authenticated;

comment on function public.pending_invitation_hint() is
  'Tells the signed-in user that an invitation is waiting for their email address, without revealing its token. Grants no access.';
