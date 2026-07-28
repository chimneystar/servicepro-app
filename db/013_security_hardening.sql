-- =====================================================================
--  ServicePro — Migration 013 (GO-LIVE security hardening)
--  Run once in the Supabase SQL Editor, AFTER 012. Safe to re-run.
--
--  Closes the production-audit security findings:
--    * Every function gets a fixed search_path (no mutable search_path).
--    * EXECUTE is revoked from PUBLIC on ALL routines, then granted only to
--      the roles that actually need each one. Public (anon) can only reach
--      the five intentional client entry points.
--    * submit_booking gets DB-level flood protection (rate limiting).
--    * webhook_events gets an explicit deny-all policy (service-role only).
--    * btree_gist is moved out of the public schema.
--
--  NOTE: "Leaked password protection" is a Supabase Auth dashboard toggle,
--  not SQL — see MIGRATIONS.md step 5.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Fix the mutable-search-path helper (set_updated_at).
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql security definer set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------------
-- 2. Rate-limit the public booking endpoint (5 requests / org / minute).
--    Everything else in the body is unchanged from migration 009.
-- ---------------------------------------------------------------------
create or replace function public.submit_booking(
  p_org uuid, p_name text, p_phone text, p_email text,
  p_address text, p_city text, p_service text, p_notes text, p_date date
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.organizations where id = p_org) then return false; end if;
  if coalesce(trim(p_name),'') = '' then return false; end if;
  -- Basic flood protection: no more than 5 new online bookings per org per minute.
  if (select count(*) from public.leads
        where organization_id = p_org and source = 'Online booking'
          and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'Too many requests. Please try again in a minute.' using errcode = 'check_violation';
  end if;
  insert into public.leads (organization_id, name, phone, email, address, city, service, notes, preferred_date, source, status)
  values (p_org, left(trim(p_name),120), left(coalesce(p_phone,''),40), left(coalesce(p_email,''),160),
          left(coalesce(p_address,''),200), left(coalesce(p_city,''),80), left(coalesce(p_service,''),120),
          left(coalesce(p_notes,''),2000), p_date, 'Online booking', 'new');
  return true;
end $$;

-- ---------------------------------------------------------------------
-- 3. Lock down EXECUTE: revoke PUBLIC, grant only what each role needs.
-- ---------------------------------------------------------------------
-- Internal helpers & privileged actions — authenticated users only.
revoke execute on function public.current_org_id()                     from public, anon;
grant  execute on function public.current_org_id()                     to authenticated;
revoke execute on function public.current_user_role()                  from public, anon;
grant  execute on function public.current_user_role()                  to authenticated;
revoke execute on function public.create_org_and_owner(text, text)     from public, anon;
grant  execute on function public.create_org_and_owner(text, text)     to authenticated;
revoke execute on function public.next_document_number(uuid, text)     from public, anon;
grant  execute on function public.next_document_number(uuid, text)     to authenticated;
revoke execute on function public.accept_invitation()                  from public, anon;
grant  execute on function public.accept_invitation()                  to authenticated;

-- Trigger functions are invoked by the trigger, never called directly.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.audit_trigger()  from public, anon, authenticated;

-- Intentional public client entry points (opaque-token or org-id scoped).
revoke execute on function public.public_document(uuid)                              from public;
grant  execute on function public.public_document(uuid)                              to anon, authenticated;
revoke execute on function public.approve_document(uuid, text, text)                 from public;
grant  execute on function public.approve_document(uuid, text, text)                 to anon, authenticated;
revoke execute on function public.public_booking_info(uuid)                          from public;
grant  execute on function public.public_booking_info(uuid)                          to anon, authenticated;
revoke execute on function public.submit_booking(uuid, text, text, text, text, text, text, text, date) from public;
grant  execute on function public.submit_booking(uuid, text, text, text, text, text, text, text, date) to anon, authenticated;
revoke execute on function public.public_customer_portal(uuid)                       from public;
grant  execute on function public.public_customer_portal(uuid)                       to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. webhook_events: RLS is enabled but had no policy. Make intent explicit —
--    deny all non-service-role access (service_role bypasses RLS entirely).
-- ---------------------------------------------------------------------
drop policy if exists webhook_events_no_access on public.webhook_events;
create policy webhook_events_no_access on public.webhook_events
  for all to anon, authenticated using (false) with check (false);

-- ---------------------------------------------------------------------
-- 5. Move btree_gist out of the public schema (best-effort; existing
--    constraints keep working because they reference it by OID).
-- ---------------------------------------------------------------------
do $$
begin
  create schema if not exists extensions;
  alter extension btree_gist set schema extensions;
exception when others then
  raise notice 'btree_gist relocation skipped: %', sqlerrm;
end $$;

-- =====================================================================
-- End migration 013.
-- =====================================================================
