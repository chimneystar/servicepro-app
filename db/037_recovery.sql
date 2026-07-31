-- =====================================================================
--  037_recovery.sql — Trash / restore for soft-deleted records (ledger 6a.4)
--
--  `deleted_at` is written on customers, jobs, estimates and invoices, and
--  honoured on every read. Nothing in the product could LIST or RESTORE any of
--  them. The rows were still in the table; no screen could reach them. A
--  mis-click was, from the owner's point of view, permanent.
--
--  This migration adds the three things a trash screen needs and cannot fake:
--
--   1. WHO deleted it. There was no `deleted_by` column anywhere. The answer was
--      recoverable only by reading audit_log, so this adds the column, stamps it
--      with a trigger (no application path has to remember), and BACKFILLS it
--      from audit_log for everything already deleted.
--
--   2. Restore consistency, enforced by the database. The application checks the
--      same rules first so the user gets a readable reason, but a check in a
--      server action is a race and covers only that one caller. These triggers
--      are the authority:
--        * a job / estimate / invoice cannot be restored while the customer it
--          belongs to is still deleted (nor, for an invoice, while its job or
--          its originating estimate is);
--        * a customer erased to satisfy a completed privacy DELETION request can
--          never be restored — that erasure is a legal obligation, not a
--          mis-click, and an undo button on it is a compliance hole.
--
--   3. Role authority on restore. Deleting any of these four is owner/office.
--      `customers_update` is open to every org member, so without this a
--      technician could clear `deleted_at` directly against the API. Restore is
--      now owner/office at the database, matching deletion exactly.
--
--  Idempotent, and drops nothing: only `create ... if not exists`, `create or
--  replace function`, and `drop trigger if exists` immediately followed by the
--  create of that same trigger.
--
--  NOT VERIFIED AGAINST A LIVE POSTGRES — there is none on this machine. The SQL
--  is checked by inspection against db/schema.sql and by structural assertion in
--  tests/recovery.test.mjs.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. deleted_by
-- ---------------------------------------------------------------------
alter table public.customers add column if not exists deleted_by uuid references public.profiles(id) on delete set null;
alter table public.jobs      add column if not exists deleted_by uuid references public.profiles(id) on delete set null;
alter table public.estimates add column if not exists deleted_by uuid references public.profiles(id) on delete set null;
alter table public.invoices  add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

comment on column public.customers.deleted_by is 'Who soft-deleted this row. Stamped by trg_*_stamp_deleted_by; cleared on restore.';
comment on column public.jobs.deleted_by      is 'Who soft-deleted this row. Stamped by trg_*_stamp_deleted_by; cleared on restore.';
comment on column public.estimates.deleted_by is 'Who soft-deleted this row. Stamped by trg_*_stamp_deleted_by; cleared on restore.';
comment on column public.invoices.deleted_by  is 'Who soft-deleted this row. Stamped by trg_*_stamp_deleted_by; cleared on restore.';

-- ---------------------------------------------------------------------
-- 2. Stamp deleted_by automatically.
--    Deliberately a trigger and not application code: the four soft-delete call
--    sites live in three different files (lib/documents.ts, the migration
--    rollback, the privacy anonymiser) and any future fifth would forget.
-- ---------------------------------------------------------------------
create or replace function public.stamp_deleted_by()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    -- Resolved THROUGH profiles rather than taking auth.uid() directly: the
    -- column has a foreign key, and an actor with no profiles row would turn a
    -- working delete into a constraint violation. Attribution is worth less
    -- than the delete continuing to work, so it degrades to null.
    new.deleted_by := (select p.id from public.profiles p where p.id = auth.uid());
  elsif new.deleted_at is null and old.deleted_at is not null then
    new.deleted_by := null;                -- restored: the field no longer means anything
  end if;
  return new;
end $$;
revoke all on function public.stamp_deleted_by() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Restore authority + restore consistency.
--
--    A restore is exactly the transition (old.deleted_at is not null) ->
--    (new.deleted_at is null). Nothing else in this function fires.
--
--    Parent references are read through to_jsonb(new) rather than new.job_id so
--    one function body is correct for all three child tables without assuming a
--    column that only invoices has — the same defensive pattern as
--    guard_job_field_authority() in 023.
-- ---------------------------------------------------------------------
create or replace function public.guard_restore()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_parent_deleted timestamptz;
  v_parent_id      uuid;
begin
  if old.deleted_at is null or new.deleted_at is not null then
    return new;                            -- not a restore
  end if;

  -- Role authority: restore is exactly as privileged as delete was.
  -- coalesce, so an actor whose role cannot be resolved is refused rather than
  -- slipping through on a NULL comparison — `null not in (...)` is NULL, and
  -- `if NULL then` does nothing at all.
  if auth.uid() is not null
     and coalesce(public.current_user_role()::text, '') not in ('owner','office') then
    raise exception 'restore_denied'
      using errcode = 'insufficient_privilege',
            hint = 'Restoring a deleted record is owner/office, the same as deleting it.';
  end if;

  if tg_table_name = 'customers' then
    -- A privacy erasure is not a mis-click.
    if exists (
      select 1 from public.privacy_requests p
       where p.customer_id = new.id
         and p.request_type = 'deletion'
         and p.status = 'completed'
    ) then
      raise exception 'restore_privacy_erased'
        using errcode = 'check_violation',
              hint = 'This customer was erased to satisfy a privacy deletion request.';
    end if;
    return new;
  end if;

  -- Children: every parent must be live, or the restored row appears in the
  -- ledger attached to something no screen can open.
  v_parent_id := (to_jsonb(new) ->> 'customer_id')::uuid;
  if v_parent_id is not null then
    select c.deleted_at into v_parent_deleted from public.customers c where c.id = v_parent_id;
    if v_parent_deleted is not null then
      raise exception 'restore_parent_deleted'
        using errcode = 'check_violation', hint = 'Restore the customer first.';
    end if;
  end if;

  if tg_table_name = 'invoices' then
    v_parent_id := (to_jsonb(new) ->> 'job_id')::uuid;
    if v_parent_id is not null then
      select j.deleted_at into v_parent_deleted from public.jobs j where j.id = v_parent_id;
      if v_parent_deleted is not null then
        raise exception 'restore_parent_deleted'
          using errcode = 'check_violation', hint = 'Restore the job first.';
      end if;
    end if;

    -- invoices.estimate_id (migration 024) has no FK constraint, so this is the
    -- only place the relationship is enforced at all.
    v_parent_id := (to_jsonb(new) ->> 'estimate_id')::uuid;
    if v_parent_id is not null then
      select e.deleted_at into v_parent_deleted from public.estimates e where e.id = v_parent_id;
      if v_parent_deleted is not null then
        raise exception 'restore_parent_deleted'
          using errcode = 'check_violation', hint = 'Restore the estimate first.';
      end if;
    end if;
  end if;

  return new;
end $$;
revoke all on function public.guard_restore() from public, anon, authenticated;

-- Attach both triggers to all four tables.
-- Name ordering matters: triggers of the same timing fire alphabetically, so
-- trg_<t>_guard_restore runs before trg_<t>_stamp_deleted_by, and a refused
-- restore never reaches the stamp.
do $$
declare t text;
begin
  foreach t in array array['customers','jobs','estimates','invoices'] loop
    execute format('drop trigger if exists trg_%1$s_guard_restore on public.%1$I;', t);
    execute format('create trigger trg_%1$s_guard_restore before update on public.%1$I for each row execute function public.guard_restore();', t);
    execute format('drop trigger if exists trg_%1$s_stamp_deleted_by on public.%1$I;', t);
    execute format('create trigger trg_%1$s_stamp_deleted_by before update on public.%1$I for each row execute function public.stamp_deleted_by();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. Backfill deleted_by from audit_log.
--    audit_trigger() has recorded every UPDATE on these four tables since the
--    baseline schema, so the actor who set deleted_at is already on disk. A
--    trash screen that says "deleted by — unknown" for every historical row
--    would be answering the question badly when the answer exists.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['customers','jobs','estimates','invoices'] loop
    execute format($f$
      update public.%1$I tgt
         set deleted_by = src.actor
        from (
          select distinct on (row_id) row_id, actor
            from public.audit_log
           where table_name = %1$L
             and action = 'UPDATE'
             and (old_data ->> 'deleted_at') is null
             and (new_data ->> 'deleted_at') is not null
           order by row_id, at desc
        ) src
       where tgt.id = src.row_id
         and tgt.deleted_at is not null
         and tgt.deleted_by is null
         and src.actor is not null
         and exists (select 1 from public.profiles p where p.id = src.actor)
    $f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Indexes for the trash screen.
--    Every existing index on these tables is partial on `deleted_at is null` —
--    i.e. deliberately excludes exactly the rows this screen lists. Without
--    these, opening the trash is a sequential scan of the whole table.
-- ---------------------------------------------------------------------
create index if not exists idx_customers_trash on public.customers (organization_id, deleted_at desc) where deleted_at is not null;
create index if not exists idx_jobs_trash      on public.jobs      (organization_id, deleted_at desc) where deleted_at is not null;
create index if not exists idx_estimates_trash on public.estimates (organization_id, deleted_at desc) where deleted_at is not null;
create index if not exists idx_invoices_trash  on public.invoices  (organization_id, deleted_at desc) where deleted_at is not null;

-- =====================================================================
-- End of 037_recovery.sql
-- =====================================================================
