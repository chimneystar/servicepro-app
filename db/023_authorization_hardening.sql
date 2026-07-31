-- =====================================================================
--  ServicePro — Migration 023 (authorization hardening)
--  Run once in the Supabase SQL Editor, AFTER 022. Safe to re-run.
--
--  THREAT MODEL THIS MIGRATION ADDRESSES
--  ------------------------------------
--  Every finding below is exploitable by an authenticated user who SKIPS the
--  application's server actions and calls PostgREST (/rest/v1/) directly with
--  the public anon key and their own session JWT. The server actions are well
--  guarded (128 of 129 authenticate); the database policies were not. Policies,
--  not application code, are the security boundary here.
--
--  Closes:
--    1. Any member could promote themselves to owner (profiles.role unconstrained
--       in profiles_self_update WITH CHECK, and protect_last_owner short-circuits
--       for non-owners). Also covers self-set commission_pct (payroll fraud).
--    2. An office user could self-issue an invitation with role='owner' and
--       accept it (invitations_rw allows office; accept_invitation trusted
--       inv.role verbatim).
--    3. jobs_update WITH CHECK was weaker than USING — a technician could rewrite
--       price, expenses, customer, assignee, or soft-delete an assigned job.
--    4. job_time_entries.user_id unconstrained — techs could forge or delete a
--       colleague's timesheet.
--    5. Migration 019's blanket org-only SELECT on 24 tables exposed vendor costs,
--       subcontractor rates, ad spend and every colleague's GPS history to techs.
--    6. approve_document could re-sign an already-signed document without limit,
--       destroying the original e-signature evidence.
--    7. Billing state (subscriptions) was tenant-writable.
--    8. 32 pre-017 tables never revoked default privileges from anon.
--
--  NOTE: this migration deliberately does NOT change any application behaviour
--  that a legitimate user relies on. Everything here narrows authority that was
--  never intended to be granted.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. profiles: a member may edit their OWN presentation fields only.
--
--    Implemented as a trigger rather than only a policy, because a RLS
--    WITH CHECK cannot see OLD and a subquery comparison against the
--    pre-update snapshot is subtle enough to break silently on a future
--    Postgres/PostgREST change. The trigger is explicit and provable.
-- ---------------------------------------------------------------------
create or replace function public.guard_profile_privilege_columns()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor_role text;
begin
  -- Definer/service-role contexts (no JWT) are trusted: cron, webhooks,
  -- accept_invitation, create_org_and_owner.
  if auth.uid() is null then return new; end if;

  select p.role::text into actor_role from public.profiles p where p.id = auth.uid();

  -- Owners administer their organisation; protect_last_owner still applies.
  if actor_role = 'owner' then return new; end if;

  if new.role             is distinct from old.role
     or new.organization_id is distinct from old.organization_id
     or new.active         is distinct from old.active
     or new.commission_pct is distinct from old.commission_pct then
    raise exception 'privilege_change_denied'
      using errcode = 'insufficient_privilege',
            hint = 'Only an owner may change role, organisation, active state or commission.';
  end if;

  return new;
end $$;
revoke all on function public.guard_profile_privilege_columns() from public, anon, authenticated;

drop trigger if exists trg_profiles_guard_privileges on public.profiles;
create trigger trg_profiles_guard_privileges
before update on public.profiles
for each row execute function public.guard_profile_privilege_columns();

-- Belt and braces: narrow the policy too, so the intent is readable in the
-- policy list and not only in a trigger.
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and organization_id = public.current_org_id()
    and role           = (select p.role           from public.profiles p where p.id = auth.uid())
    and active         = (select p.active         from public.profiles p where p.id = auth.uid())
    and commission_pct = (select p.commission_pct from public.profiles p where p.id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 2. invitations: owner-only, and an invitation can never mint an owner
--    unless an owner issued it.
-- ---------------------------------------------------------------------
drop policy if exists invitations_rw on public.invitations;
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations for select to authenticated
  using (organization_id = public.current_org_id()
         and public.current_user_role() in ('owner','office'));
drop policy if exists invitations_write on public.invitations;
create policy invitations_write on public.invitations for all to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() = 'owner')
  with check (organization_id = public.current_org_id() and public.current_user_role() = 'owner');

-- Second, independent gate: even a forged invitation row cannot escalate,
-- because acceptance re-checks who created it.
create or replace function public.accept_invitation()
returns uuid language plpgsql security definer set search_path = public as $$
declare em text; inv record; inviter_role text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  if exists (select 1 from public.profiles where id = auth.uid() and organization_id is not null) then
    return (select organization_id from public.profiles where id = auth.uid());
  end if;

  select email into em from auth.users where id = auth.uid();
  if em is null then return null; end if;

  select * into inv from public.invitations
    where lower(email) = lower(em) and accepted_at is null and expires_at > now()
    order by created_at desc limit 1;
  if not found then return null; end if;

  -- An owner-level invitation is only honoured if an owner actually issued it.
  if inv.role::text = 'owner' then
    select p.role::text into inviter_role from public.profiles p where p.id = inv.invited_by;
    if inviter_role is distinct from 'owner' then
      raise exception 'invitation_role_not_permitted' using errcode = 'insufficient_privilege';
    end if;
  end if;

  insert into public.profiles (id, organization_id, full_name, role)
    values (auth.uid(), inv.organization_id, '', inv.role)
    on conflict (id) do update set organization_id = excluded.organization_id, role = excluded.role;

  update public.invitations set accepted_at = now() where id = inv.id;
  return inv.organization_id;
end $$;
revoke execute on function public.accept_invitation() from public, anon;
grant  execute on function public.accept_invitation() to authenticated;

-- ---------------------------------------------------------------------
-- 3. jobs: mirror the USING predicate into WITH CHECK so a technician cannot
--    reassign, re-price or soft-delete a job out from under the office.
-- ---------------------------------------------------------------------
drop policy if exists jobs_update on public.jobs;
create policy jobs_update on public.jobs for update to authenticated
  using (organization_id = public.current_org_id()
         and (public.current_user_role() in ('owner','office') or assigned_to = auth.uid()))
  with check (organization_id = public.current_org_id()
              and (public.current_user_role() in ('owner','office') or assigned_to = auth.uid()));

-- A technician must not be able to change money or ownership fields on a job
-- they merely happen to be assigned to.
create or replace function public.guard_job_field_authority()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if public.current_user_role() in ('owner','office') then return new; end if;

  if new.price_minor        is distinct from old.price_minor
     or new.customer_id     is distinct from old.customer_id
     or new.assigned_to     is distinct from old.assigned_to
     or new.deleted_at      is distinct from old.deleted_at
     or new.organization_id is distinct from old.organization_id
     -- job_expenses_minor is added by migration 012; compare it without
     -- assuming it exists (absent column => null on both sides => no change).
     or (to_jsonb(new) ->> 'job_expenses_minor') is distinct from (to_jsonb(old) ->> 'job_expenses_minor') then
    raise exception 'job_field_change_denied'
      using errcode = 'insufficient_privilege',
            hint = 'Technicians may update job progress, not pricing, assignment or deletion.';
  end if;
  return new;
end $$;
revoke all on function public.guard_job_field_authority() from public, anon, authenticated;

drop trigger if exists trg_jobs_guard_fields on public.jobs;
create trigger trg_jobs_guard_fields
before update on public.jobs
for each row execute function public.guard_job_field_authority();

-- Note on job_expenses_minor: it is added by migration 012, but this migration
-- must not assume it exists. The guard above compares it via to_jsonb so the
-- same function body is correct whether or not the column is present — no
-- conditional function definition, no duplicated body to drift.

-- ---------------------------------------------------------------------
-- 4. job_time_entries: a technician owns only their own timesheet.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.job_time_entries') is null then return; end if;

  execute 'drop policy if exists job_time_entries_select on public.job_time_entries';
  execute $p$
    create policy job_time_entries_select on public.job_time_entries for select to authenticated
      using (organization_id = public.current_org_id()
             and (public.current_user_role() in ('owner','office') or user_id = auth.uid()))
  $p$;

  execute 'drop policy if exists job_time_entries_write on public.job_time_entries';
  execute 'drop policy if exists job_time_entries_rw on public.job_time_entries';
  execute $p$
    create policy job_time_entries_write on public.job_time_entries for all to authenticated
      using (organization_id = public.current_org_id()
             and (public.current_user_role() in ('owner','office') or user_id = auth.uid()))
      with check (organization_id = public.current_org_id()
                  and (public.current_user_role() in ('owner','office') or user_id = auth.uid()))
  $p$;
end $$;

-- Prevent the duplicate-open-entry race that double-counts billable hours.
-- Existing data may already contain duplicates (the race has been live), which
-- would abort the whole migration. Report instead of failing, so this file stays
-- re-runnable and the duplicates can be reconciled as a data decision.
do $$
begin
  create unique index if not exists uq_job_time_entries_one_open
    on public.job_time_entries (job_id, user_id)
    where ended_at is null;
exception when unique_violation then
  raise notice 'uq_job_time_entries_one_open NOT created: duplicate open time entries already exist. Reconcile them, then re-run this migration. Query: select job_id, user_id, count(*) from public.job_time_entries where ended_at is null group by 1,2 having count(*) > 1;';
end $$;

-- ---------------------------------------------------------------------
-- 5. Cost, margin and location data is management information.
--    Migration 019 gave all 24 of its tables a blanket org-only SELECT.
--    Narrow the sensitive ones to owner/office (019's own _manage policy
--    already restricted writes; only reads were open).
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'vendors','purchase_orders','purchase_order_items',
    'subcontractors','subcontractor_assignments',
    'campaigns','referral_programs','referrals','lead_attribution_costs',
    'technician_locations','technician_location_consents',
    'automation_rules','automation_runs','migration_batches'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists %I on public.%I;', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (organization_id = public.current_org_id()
                and public.current_user_role() in (''owner'',''office''));',
      t || '_select', t);
  end loop;
end $$;

-- A technician still needs to see their OWN location consent and history.
do $$
begin
  if to_regclass('public.technician_locations') is not null then
    execute 'drop policy if exists technician_locations_self on public.technician_locations';
    execute $p$
      create policy technician_locations_self on public.technician_locations for select to authenticated
        using (organization_id = public.current_org_id() and profile_id = auth.uid())
    $p$;
  end if;
  if to_regclass('public.technician_location_consents') is not null then
    execute 'drop policy if exists technician_location_consents_self on public.technician_location_consents';
    execute $p$
      create policy technician_location_consents_self on public.technician_location_consents for select to authenticated
        using (organization_id = public.current_org_id() and profile_id = auth.uid())
    $p$;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. approve_document: sign once. Re-signing destroyed the original evidence
--    and each call wrote ~800 KB of audit rows.
-- ---------------------------------------------------------------------
-- Parameter names are unchanged from migration 004 on purpose: PostgreSQL
-- refuses to rename input parameters in CREATE OR REPLACE. The ONLY behavioural
-- change is the `signed_at is null` guard.
create or replace function public.approve_document(p_token uuid, p_name text, p_sig text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.estimates
     set status = case when status in ('draft','sent') then 'approved'::estimate_status else status end,
         signer_name = left(coalesce(nullif(trim(p_name), ''), 'Customer'), 120),
         signed_at = now(), signature_data = left(coalesce(p_sig, ''), 400000)
   where public_token = p_token and deleted_at is null
     and signed_at is null;          -- <<< sign once; re-signing destroyed evidence
  get diagnostics n = row_count;
  if n > 0 then return true; end if;

  update public.invoices
     set signer_name = left(coalesce(nullif(trim(p_name), ''), 'Customer'), 120),
         signed_at = now(), signature_data = left(coalesce(p_sig, ''), 400000)
   where public_token = p_token and deleted_at is null
     and signed_at is null;          -- <<< sign once
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.approve_document(uuid, text, text) from public;
grant  execute on function public.approve_document(uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Billing state is not tenant-writable. Reads stay, writes become
--    service-role only (service_role bypasses RLS).
-- ---------------------------------------------------------------------
drop policy if exists subscriptions_rw on public.subscriptions;
drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (organization_id = public.current_org_id()
         and public.current_user_role() in ('owner','office'));
-- deliberately no INSERT/UPDATE/DELETE policy: only service_role may write.

-- ---------------------------------------------------------------------
-- 8. Legacy tables (schema.sql, 006-012) never revoked anon's default
--    privileges. They are fail-closed today only because 013 revoked EXECUTE
--    on the helper functions — a single point of failure. Close it properly.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','profiles','customers','jobs','job_photos','estimates','estimate_items',
    'invoices','invoice_items','expenses','price_book','messages','reviews','subscriptions',
    'payments','invitations','sms_messages','email_messages','webhook_events','audit_log',
    'job_types','message_templates','job_items','job_tasks','job_checklist_items','job_equipment',
    'leads','job_time_entries','inventory_items','recurring_plans','reminder_log','job_statuses'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('revoke all on public.%I from anon;', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    execute format('grant all on public.%I to service_role;', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 9. item-photos storage bucket had NO policies while job-photos did, so
--    every uploaded line-item image was world-readable by URL.
--    Reads stay public (documents are shared by link); writes become
--    authenticated-only and scoped to the caller's organisation prefix.
-- ---------------------------------------------------------------------
do $$
begin
  execute 'drop policy if exists item_photos_read on storage.objects';
  execute $p$
    create policy item_photos_read on storage.objects for select
      using (bucket_id = 'item-photos')
  $p$;

  execute 'drop policy if exists item_photos_write on storage.objects';
  execute $p$
    create policy item_photos_write on storage.objects for insert to authenticated
      with check (bucket_id = 'item-photos'
                  and (storage.foldername(name))[1] = public.current_org_id()::text)
  $p$;

  execute 'drop policy if exists item_photos_modify on storage.objects';
  execute $p$
    create policy item_photos_modify on storage.objects for update to authenticated
      using (bucket_id = 'item-photos'
             and (storage.foldername(name))[1] = public.current_org_id()::text)
  $p$;

  execute 'drop policy if exists item_photos_delete on storage.objects';
  execute $p$
    create policy item_photos_delete on storage.objects for delete to authenticated
      using (bucket_id = 'item-photos'
             and (storage.foldername(name))[1] = public.current_org_id()::text)
  $p$;
exception when insufficient_privilege then
  raise notice 'item-photos storage policies skipped: insufficient privilege. Apply them from the Storage dashboard.';
end $$;

-- =====================================================================
-- End migration 023.
-- =====================================================================
