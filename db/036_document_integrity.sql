-- =====================================================================
--  ServicePro — Migration 036 (document integrity)
--  Run once in the Supabase SQL Editor, AFTER 035. Safe to re-run.
--  DROPS NOTHING. Every object is created, replaced or added conditionally.
--
--  Ledger items 6a.1, 6a.3, 6a.5 and 6a.6. Four defects, one family: a
--  financial record that could be changed after the customer had already been
--  shown it.
--
--  6a.1  There was NO way to correct or cancel an issued invoice. Editing it in
--        place rewrites a document the customer already holds; soft-deleting it
--        erases the number from the sequence. Both are unacceptable to an
--        accountant. This migration adds credit notes and void — the original
--        document, its figures and its NUMBER all survive.
--
--  6a.3  next_document_number() bumped a counter and returned it BEFORE the row
--        insert, so a failed insert burned a number permanently, and nothing
--        reconciled the counter with the numbers actually in use — /settings
--        lets an owner set the next number BACKWARDS, straight onto a number a
--        document already holds. Allocation is now max-aware and serialised,
--        and a burned number can be handed back by exact compare-and-set.
--
--  6a.5  updateInvoice had no status guard: a sent, signed or PAID invoice's
--        line items and total could still be rewritten. The guard is here in
--        the database as well as in the action, because the threat model on
--        this branch is PostgREST, not the UI.
--
--  6a.6  No version column existed anywhere in the schema. Two office users
--        editing the same estimate silently last-write-wins.
--
--  Shape follows db/030_refunds.sql: an append-only ledger, a derived cache so
--  existing readers keep working, and a database-level guard.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Dependency check. 030 supplies can_refund_payments(), which is the
--    authority a credit note is gated on — the same authority as a refund,
--    because both are money going back to the customer.
--
--    Failing loudly here is the point: a policy referencing a function that
--    does not exist would be created and then reject every write with a
--    cryptic error at 3am.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.can_refund_payments()') is null then
    raise exception
      'migration 030_refunds.sql must be applied before 036 (public.can_refund_payments() is missing)';
  end if;
  if to_regprocedure('public.current_org_id()') is null then
    raise exception 'public.current_org_id() is missing; apply db/schema.sql first';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. The columns. All additive, all defaulted, nothing dropped.
--
--    sent_at        — the product tracked "sent" NOWHERE. estimates had a
--                     'sent' status; invoices had no signal at all, which is
--                     exactly why an invoice could be silently repriced after
--                     the customer received it.
--    voided_at/_by/_reason — a void KEEPS the document and its number.
--    reopen_*       — the one audited exit from a lock (estimates only).
--    version        — 6a.6.
--    credited_minor — derived cache of the credit-note ledger (invoices only).
-- ---------------------------------------------------------------------
alter table public.estimates add column if not exists sent_at        timestamptz;
alter table public.estimates add column if not exists voided_at      timestamptz;
alter table public.estimates add column if not exists void_reason    text;
alter table public.estimates add column if not exists voided_by      uuid references public.profiles(id) on delete set null;
alter table public.estimates add column if not exists reopened_at    timestamptz;
alter table public.estimates add column if not exists reopened_by    uuid references public.profiles(id) on delete set null;
alter table public.estimates add column if not exists reopen_reason  text;
alter table public.estimates add column if not exists reopen_count   integer not null default 0;
alter table public.estimates add column if not exists version        integer not null default 1;

alter table public.invoices  add column if not exists sent_at        timestamptz;
alter table public.invoices  add column if not exists voided_at      timestamptz;
alter table public.invoices  add column if not exists void_reason    text;
alter table public.invoices  add column if not exists voided_by      uuid references public.profiles(id) on delete set null;
alter table public.invoices  add column if not exists version        integer not null default 1;
alter table public.invoices  add column if not exists credited_minor bigint not null default 0;

alter table public.organizations
  add column if not exists credit_note_counter integer not null default 1000;

create index if not exists idx_estimates_voided on public.estimates (organization_id)
  where voided_at is not null;
create index if not exists idx_invoices_voided  on public.invoices  (organization_id)
  where voided_at is not null;

-- Deliberately NOT backfilled. An estimate already in status 'sent' is locked
-- by the status alone (see guard_document_lock below), and inventing a sent_at
-- timestamp for a document nobody can prove was sent would be fabricating
-- evidence on a record this branch exists to make trustworthy.

-- ---------------------------------------------------------------------
-- 2. 6a.3 — the unique constraint on the number.
--
--    db/schema.sql DOES declare `unique (organization_id, number)` inline on
--    both tables, so a database built from that baseline already has it. But it
--    is a table-level constraint inside `create table if not exists`, which is
--    skipped entirely if the table was created by anything else — and no
--    migration ever asserted it afterwards. This adds it only when no unique
--    constraint over exactly (organization_id, number) exists, so a database
--    that already has one does NOT end up with a second redundant index.
--
--    Note what is NOT done: no `where deleted_at is null`. A soft-deleted
--    document keeps its number. Freeing it would let a second document be
--    issued under a number a customer already has on paper, which is the one
--    outcome sequential numbering exists to prevent.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['estimates','invoices'] loop
    if not exists (
      select 1
        from pg_constraint con
        join pg_class c  on c.oid = con.conrelid
        join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public' and c.relname = t and con.contype = 'u'
         and (select array_agg(a.attname::text order by a.attname)
                from unnest(con.conkey) ck
                join pg_attribute a on a.attrelid = con.conrelid and a.attnum = ck)
             = array['number','organization_id']
    ) then
      execute format('alter table public.%I add constraint %I unique (organization_id, number)',
                     t, t || '_org_number_key');
      raise notice 'added unique(organization_id, number) on public.%', t;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. 6a.3 — safe allocation.
--
--    THE DECISION, recorded so it cannot drift: GAPS ARE ACCEPTED, NUMBERS ARE
--    NEVER REUSED.
--
--    A reused number puts two different documents bearing the same number into
--    two different customers' hands and no filing can untangle that afterwards.
--    A gap is only a question, and this migration makes the question
--    answerable: voiding PRESERVES the number and the row, so the ordinary
--    cause of a missing number ("we cancelled that one") appears in the
--    sequence as a void rather than as nothing at all.
--
--    Gaps are also made rare rather than merely tolerated:
--      * allocation takes a row lock on the organisation, so two concurrent
--        creates cannot read the same counter;
--      * the number is the greater of the stored counter and the highest number
--        ACTUALLY IN USE, so the /settings next-number override can no longer
--        walk the counter back onto an issued number;
--      * a burned number is handed back by release_document_number() below,
--        but only by exact compare-and-set.
-- ---------------------------------------------------------------------
create or replace function public.allocate_document_number(p_org uuid, p_kind text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer; used integer;
begin
  -- Serialise every allocation for this organisation. Without this both
  -- sessions read the same counter and the loser's insert dies on the unique
  -- constraint with a raw 23505 the operator cannot act on.
  perform 1 from public.organizations where id = p_org for update;
  if not found then raise exception 'unknown organization'; end if;

  if p_kind = 'invoice' then
    select coalesce(max(number), 0) into used from public.invoices where organization_id = p_org;
    select greatest(invoice_counter, used) + 1 into n from public.organizations where id = p_org;
    update public.organizations set invoice_counter = n where id = p_org;
  elsif p_kind = 'estimate' then
    select coalesce(max(number), 0) into used from public.estimates where organization_id = p_org;
    select greatest(estimate_counter, used) + 1 into n from public.organizations where id = p_org;
    update public.organizations set estimate_counter = n where id = p_org;
  elsif p_kind = 'credit_note' then
    select coalesce(max(number), 0) into used from public.credit_notes where organization_id = p_org;
    select greatest(credit_note_counter, used) + 1 into n from public.organizations where id = p_org;
    update public.organizations set credit_note_counter = n where id = p_org;
  else
    raise exception 'unknown document kind';
  end if;

  if n is null then raise exception 'unknown organization'; end if;
  return n;
end $$;
revoke all on function public.allocate_document_number(uuid, text) from public, anon, authenticated;
grant execute on function public.allocate_document_number(uuid, text) to service_role;

-- The staff-facing entry point keeps its signature, its grants and its
-- organisation check from schema.sql / 013; only the body changes.
create or replace function public.next_document_number(p_org uuid, p_kind text)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if p_org is null or p_org is distinct from public.current_org_id() then
    raise exception 'forbidden';
  end if;
  return public.allocate_document_number(p_org, p_kind);
end $$;
revoke execute on function public.next_document_number(uuid, text) from public, anon;
grant  execute on function public.next_document_number(uuid, text) to authenticated;

-- Hand a burned number back — and ONLY when the counter still stands exactly
-- where this allocation left it and nothing has taken the number. If anyone
-- else allocated in between, rolling back would issue our number twice, so the
-- gap is kept instead. Returns whether the number was actually released.
create or replace function public.release_document_number(p_org uuid, p_kind text, p_number integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare released integer := 0;
begin
  if p_org is null or p_number is null or p_number < 1 then return false; end if;
  if public.current_org_id() is not null and p_org is distinct from public.current_org_id() then
    raise exception 'forbidden';
  end if;

  if p_kind = 'invoice' then
    update public.organizations set invoice_counter = p_number - 1
      where id = p_org and invoice_counter = p_number
        and not exists (select 1 from public.invoices
                         where organization_id = p_org and number = p_number);
  elsif p_kind = 'estimate' then
    update public.organizations set estimate_counter = p_number - 1
      where id = p_org and estimate_counter = p_number
        and not exists (select 1 from public.estimates
                         where organization_id = p_org and number = p_number);
  elsif p_kind = 'credit_note' then
    update public.organizations set credit_note_counter = p_number - 1
      where id = p_org and credit_note_counter = p_number
        and not exists (select 1 from public.credit_notes
                         where organization_id = p_org and number = p_number);
  else
    return false;
  end if;

  get diagnostics released = row_count;
  return released > 0;
end $$;
revoke execute on function public.release_document_number(uuid, text, integer) from public, anon;
grant  execute on function public.release_document_number(uuid, text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. 6a.1 — the credit-note ledger.
--
--    A credit note is a document in its own right: dated, numbered, reasoned
--    and permanent. It reduces what the customer owes WITHOUT touching the
--    invoice that created the debt, which is the whole point — the invoice the
--    customer received stays byte-for-byte what they received.
--
--    Append-only in the way that matters: there is no delete policy and no
--    delete privilege. A credit note issued in error is CANCELLED (a status
--    change carrying its own reason), never removed, so the credit-note
--    sequence has no holes either.
-- ---------------------------------------------------------------------
create table if not exists public.credit_notes (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  invoice_id        uuid not null references public.invoices(id) on delete cascade,
  number            integer not null,
  amount_minor      bigint not null check (amount_minor > 0),
  reason            text not null check (length(btrim(reason)) >= 5),
  status            text not null default 'issued' check (status in ('issued','cancelled')),
  issue_date        date not null default current_date,
  cancelled_at      timestamptz,
  cancelled_by      uuid references public.profiles(id) on delete set null,
  cancel_reason     text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, number)
);

create index if not exists idx_credit_notes_invoice
  on public.credit_notes (invoice_id, created_at desc);
create index if not exists idx_credit_notes_org
  on public.credit_notes (organization_id, created_at desc);

-- Tenant safety by construction, matching migration 014's pattern: the credit
-- note and the invoice it corrects must belong to the same organisation.
do $$ begin
  alter table public.credit_notes
    add constraint credit_notes_invoice_org_fk
    foreign key (invoice_id, organization_id)
    references public.invoices(id, organization_id) on delete cascade;
exception when duplicate_object then null; when undefined_object then
  raise notice 'invoices has no (id, organization_id) unique key; composite FK skipped';
end $$;

-- ---------------------------------------------------------------------
-- 5. invoices.credited_minor is a DERIVED cache of the ledger.
--
--    Same reasoning as payments.refunded_minor in 030: readers get one column,
--    the column can never drift from the ledger, and a hand-edit is overwritten
--    the next time a credit note moves.
-- ---------------------------------------------------------------------
create or replace function public.sync_invoice_credited_total()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target uuid; total bigint;
begin
  target := coalesce(new.invoice_id, old.invoice_id);
  select coalesce(sum(amount_minor), 0) into total
    from public.credit_notes
   where invoice_id = target and status = 'issued';
  update public.invoices set credited_minor = total where id = target;
  return coalesce(new, old);
end $$;
revoke all on function public.sync_invoice_credited_total() from public, anon, authenticated;

drop trigger if exists trg_credit_notes_sync on public.credit_notes;
create trigger trg_credit_notes_sync
after insert or update or delete on public.credit_notes
for each row execute function public.sync_invoice_credited_total();

-- ---------------------------------------------------------------------
-- 6. A credit note can never exceed the invoice it corrects.
--
--    Enforced in the database, not only in the action: over-crediting would
--    drive the receivable negative and every downstream reader would report
--    revenue the business never had.
-- ---------------------------------------------------------------------
create or replace function public.guard_credit_note_amount()
returns trigger language plpgsql security definer set search_path = '' as $$
declare billed bigint; already bigint; voided timestamptz;
begin
  if new.status <> 'issued' then return new; end if;

  select i.total_minor, i.voided_at into billed, voided
    from public.invoices i where i.id = new.invoice_id;
  if billed is null then raise exception 'invoice_not_found'; end if;

  if voided is not null then
    raise exception 'invoice_voided'
      using errcode = 'check_violation',
            hint = 'This invoice was voided; there is nothing left to credit.';
  end if;

  select coalesce(sum(c.amount_minor), 0) into already
    from public.credit_notes c
   where c.invoice_id = new.invoice_id
     and c.status = 'issued'
     and c.id <> new.id;

  if already + new.amount_minor > billed then
    raise exception 'credit_exceeds_invoice'
      using errcode = 'check_violation',
            hint = format('This invoice is for %s and %s has already been credited.', billed, already);
  end if;
  return new;
end $$;
revoke all on function public.guard_credit_note_amount() from public, anon, authenticated;

drop trigger if exists trg_credit_notes_guard on public.credit_notes;
create trigger trg_credit_notes_guard
before insert or update on public.credit_notes
for each row execute function public.guard_credit_note_amount();

-- ---------------------------------------------------------------------
-- 7. Access to the ledger. Issuing a credit note gives money back, so it is
--    the same authority as a refund: owner, or the can_refund_payments()
--    permission granted from the Team screen.
-- ---------------------------------------------------------------------
alter table public.credit_notes enable row level security;

drop policy if exists credit_notes_select on public.credit_notes;
create policy credit_notes_select on public.credit_notes for select to authenticated
  using (organization_id = public.current_org_id()
         and public.current_user_role() in ('owner','office'));

drop policy if exists credit_notes_write on public.credit_notes;
create policy credit_notes_write on public.credit_notes for all to authenticated
  using (organization_id = public.current_org_id() and public.can_refund_payments())
  with check (organization_id = public.current_org_id() and public.can_refund_payments());

grant select, insert, update on public.credit_notes to authenticated;
grant all on public.credit_notes to service_role;
revoke all on public.credit_notes from anon;

-- Deleting a credit note would rewrite financial history: no delete policy, and
-- the privilege is not granted. Corrections are made by cancelling the note.

do $$
begin
  if to_regprocedure('public.audit_trigger()') is not null then
    drop trigger if exists trg_credit_notes_audit on public.credit_notes;
    create trigger trg_credit_notes_audit
      after insert or update or delete on public.credit_notes
      for each row execute function public.audit_trigger();
  else
    raise notice 'audit_trigger() not found; credit-note audit trigger skipped';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. 6a.6 — optimistic concurrency.
--
--    Every update bumps the version. The application sends the version it
--    loaded in the WHERE clause, so a second writer's update matches zero rows
--    and is TOLD, instead of quietly winning.
-- ---------------------------------------------------------------------
create or replace function public.bump_document_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.version := coalesce(old.version, 0) + 1;
  return new;
end $$;

drop trigger if exists trg_estimates_version on public.estimates;
create trigger trg_estimates_version before update on public.estimates
for each row execute function public.bump_document_version();

drop trigger if exists trg_invoices_version on public.invoices;
create trigger trg_invoices_version before update on public.invoices
for each row execute function public.bump_document_version();

-- ---------------------------------------------------------------------
-- 9. 6a.5 — lock the financially material fields once the customer has it.
--
--    The list below is the SAME list as MATERIAL_FIELDS in
--    lib/core/documents.mjs, and tests/document-integrity.test.mjs asserts the
--    two agree. Everything else — internal notes, the status transitions, the
--    void marker itself, the derived credited_minor cache — still changes
--    freely, because none of those is a figure the customer relied on.
--
--    `number` is immutable ALWAYS, locked or not: renumbering an issued
--    document is the same harm as reusing a number.
-- ---------------------------------------------------------------------
-- One definition of "locked", callable from every guard below and directly
-- assertable in the CI database. It mirrors documentLock() in
-- lib/core/documents.mjs branch for branch, including the precedence order —
-- two guards that disagree about when a document is locked would be worse than
-- one guard, because each would appear to cover the other.
--
-- `collected money` is deliberately NOT a parameter: the database cannot see
-- settled payments from a row trigger without a join per statement, and for an
-- invoice `paid` already covers it. The server action adds the collected-money
-- check on top (a paid estimate deposit locks the estimate).
create or replace function public.document_lock_code(
  p_kind text, p_status text, p_signed_at timestamptz, p_sent_at timestamptz,
  p_paid_at timestamptz, p_voided_at timestamptz)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_voided_at is not null or p_status = 'void'                                then 'voided'
    when p_kind = 'invoice'  and (p_status = 'paid' or p_paid_at is not null)        then 'paid'
    when p_signed_at is not null                                                     then 'signed'
    when p_kind = 'estimate' and p_status in ('approved','rejected')                 then 'decided'
    when p_sent_at is not null or (p_kind = 'estimate' and p_status = 'sent')        then 'sent'
    else null
  end
$$;
grant execute on function public.document_lock_code(text, text, timestamptz, timestamptz, timestamptz, timestamptz)
  to authenticated, service_role;

create or replace function public.guard_document_lock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  kind      text;
  old_paid  timestamptz;
  new_paid  timestamptz;
  old_code  text;
  new_code  text;
  cols      text[] := array['customer_id','discount_minor','tax_rate_bps',
                            'total_minor','issue_date','deposit_minor'];
  o jsonb; n jsonb; c text;
begin
  if new.number is distinct from old.number then
    raise exception 'document_number_immutable'
      using errcode = 'check_violation',
            hint = 'A document number can never be changed once issued.';
  end if;

  if TG_TABLE_NAME = 'invoices' then
    kind := 'invoice'; old_paid := old.paid_at; new_paid := new.paid_at;
  else
    kind := 'estimate'; old_paid := null; new_paid := null;
  end if;

  old_code := public.document_lock_code(kind, old.status::text, old.signed_at, old.sent_at, old_paid, old.voided_at);
  new_code := public.document_lock_code(kind, new.status::text, new.signed_at, new.sent_at, new_paid, new.voided_at);

  -- Coming OUT of a lock is the interesting direction. Without this, clearing
  -- sent_at — or simply setting an approved estimate back to 'draft' through
  -- the status dropdown, which the product already allowed — would unlock the
  -- document in one statement and rewrite its figures in the next.
  --
  -- 'paid' is deliberately EXEMPT. Un-marking an invoice paid is a legitimate,
  -- pre-existing operation (the Mark due button, and refundInvoicePayment in
  -- lib/payments/refunds.ts, which sets status back to 'unpaid' after a full
  -- refund); refusing it here would break a working path to no purpose. An
  -- invoice that was also SENT stays locked by sent_at regardless, and the
  -- money-collected leg of the lock is checked in the server action, which —
  -- unlike a row trigger — can see the settled payments.
  --
  -- What is left has exactly one exit: reopening an unsigned estimate that was
  -- sent, approved or rejected, with a fresh reason recorded in the SAME
  -- statement. An estimate is a negotiation and re-quoting is ordinary
  -- business. A signed or voided document has no exit, and an invoice has none
  -- at all — it is corrected with a credit note or a void.
  if old_code is not null and new_code is null and old_code <> 'paid' then
    if kind <> 'estimate' or old_code not in ('sent','decided') then
      raise exception 'document_unlock_refused'
        using errcode = 'check_violation',
              hint = format('A %s document cannot be unlocked. Correct it with a credit note or a void.', old_code);
    end if;
    if length(btrim(coalesce(new.reopen_reason, ''))) < 5
       or new.reopen_reason is not distinct from old.reopen_reason then
      raise exception 'document_reopen_refused'
        using errcode = 'check_violation',
              hint = 'Reopening a sent, approved or rejected estimate requires a new reason of at least 5 characters.';
    end if;
  end if;

  if old_code is null then return new; end if;

  o := to_jsonb(old); n := to_jsonb(new);
  foreach c in array cols loop
    if jsonb_exists(o, c) and ((n -> c) is distinct from (o -> c)) then
      raise exception 'document_locked'
        using errcode = 'check_violation',
              hint = format('%s is locked (%s); %s may not be changed. Correct it with a credit note or a void.',
                            TG_TABLE_NAME, old_code, c);
    end if;
  end loop;

  return new;
end $$;
revoke all on function public.guard_document_lock() from public, anon, authenticated;

drop trigger if exists trg_estimates_lock on public.estimates;
create trigger trg_estimates_lock before update on public.estimates
for each row execute function public.guard_document_lock();

drop trigger if exists trg_invoices_lock on public.invoices;
create trigger trg_invoices_lock before update on public.invoices
for each row execute function public.guard_document_lock();

-- The line items are where the money actually lives. Locking the parent's
-- total while leaving the items writable would let the printed document and its
-- stored total disagree, which is worse than either alone.
create or replace function public.guard_document_items_lock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent uuid; code text;
begin
  if TG_TABLE_NAME = 'invoice_items' then
    parent := case when TG_OP = 'DELETE' then old.invoice_id else new.invoice_id end;
    select public.document_lock_code('invoice', i.status::text, i.signed_at, i.sent_at, i.paid_at, i.voided_at)
      into code from public.invoices i where i.id = parent;
  else
    parent := case when TG_OP = 'DELETE' then old.estimate_id else new.estimate_id end;
    select public.document_lock_code('estimate', e.status::text, e.signed_at, e.sent_at, null, e.voided_at)
      into code from public.estimates e where e.id = parent;
  end if;

  -- No parent row: this is a cascade from deleting the document itself, which
  -- must still work. `code` is null there, which reads as "not locked".
  if code is not null then
    raise exception 'document_locked'
      using errcode = 'check_violation',
            hint = format('The line items of a %s document cannot be changed. Correct it with a credit note or a void.', code);
  end if;
  return case when TG_OP = 'DELETE' then old else new end;
end $$;
revoke all on function public.guard_document_items_lock() from public, anon, authenticated;

drop trigger if exists trg_estimate_items_lock on public.estimate_items;
create trigger trg_estimate_items_lock before insert or update or delete on public.estimate_items
for each row execute function public.guard_document_items_lock();

drop trigger if exists trg_invoice_items_lock on public.invoice_items;
create trigger trg_invoice_items_lock before insert or update or delete on public.invoice_items
for each row execute function public.guard_document_items_lock();

-- ---------------------------------------------------------------------
-- 10. A voided document cannot take money.
--
--     Without this the void would be cosmetic: the customer's /p/<token> link
--     is served by public_document() and paid through payment_requests, and
--     neither knew anything about voiding. This closes it at the database, so
--     it holds for every payment path — card, ACH, Zelle and cheque — without
--     the checkout code having to remember.
-- ---------------------------------------------------------------------
create or replace function public.guard_payment_request_document()
returns trigger language plpgsql security definer set search_path = '' as $$
declare blocked boolean := false;
begin
  if new.invoice_id is not null then
    select (i.voided_at is not null or i.status::text = 'void' or i.deleted_at is not null)
      into blocked from public.invoices i where i.id = new.invoice_id;
  elsif new.estimate_id is not null then
    select (e.voided_at is not null or e.deleted_at is not null)
      into blocked from public.estimates e where e.id = new.estimate_id;
  end if;

  if coalesce(blocked, false) then
    raise exception 'document_voided'
      using errcode = 'check_violation',
            hint = 'This document has been voided or deleted and can no longer be paid.';
  end if;
  return new;
end $$;
revoke all on function public.guard_payment_request_document() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.payment_requests') is not null then
    drop trigger if exists trg_payment_requests_document_guard on public.payment_requests;
    create trigger trg_payment_requests_document_guard
      before insert on public.payment_requests
      for each row execute function public.guard_payment_request_document();
  else
    raise notice 'payment_requests not found; void payment guard skipped';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 11. A voided document cannot be signed either.
--
--     Body copied verbatim from migration 023 §6 — including the sign-once
--     guard, which must not be lost — with `voided_at is null` added to both
--     updates. Parameter names are unchanged because PostgreSQL refuses to
--     rename input parameters in CREATE OR REPLACE.
-- ---------------------------------------------------------------------
create or replace function public.approve_document(p_token uuid, p_name text, p_sig text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.estimates
     set status = case when status in ('draft','sent') then 'approved'::estimate_status else status end,
         signer_name = left(coalesce(nullif(trim(p_name), ''), 'Customer'), 120),
         signed_at = now(), signature_data = left(coalesce(p_sig, ''), 400000)
   where public_token = p_token and deleted_at is null
     and signed_at is null           -- <<< sign once; re-signing destroyed evidence (023)
     and voided_at is null;          -- <<< 036: a voided document cannot be approved
  get diagnostics n = row_count;
  if n > 0 then return true; end if;

  update public.invoices
     set signer_name = left(coalesce(nullif(trim(p_name), ''), 'Customer'), 120),
         signed_at = now(), signature_data = left(coalesce(p_sig, ''), 400000)
   where public_token = p_token and deleted_at is null
     and signed_at is null           -- <<< sign once (023)
     and voided_at is null;          -- <<< 036
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.approve_document(uuid, text, text) from public;
grant  execute on function public.approve_document(uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 12. What the customer's public link is allowed to learn about a correction.
--
--     public_document() is NOT replaced here — reproducing its whole body to
--     add one key is a needless risk to a function the /p screen depends on,
--     and an invoice void already reaches it through `status = 'void'`. This
--     companion returns only the correction state, so the public screen can be
--     taught to stop presenting a voided or credited document as live. It
--     returns no amounts a token holder cannot already see.
-- ---------------------------------------------------------------------
create or replace function public.public_document_correction(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select voided_at, void_reason, total_minor, 0::bigint as credited_minor, version
    into d from public.estimates where public_token = p_token and deleted_at is null;
  if not found then
    select voided_at, void_reason, total_minor, credited_minor, version
      into d from public.invoices where public_token = p_token and deleted_at is null;
    if not found then return null; end if;
  end if;

  return jsonb_build_object(
    'voided', d.voided_at is not null,
    'voided_at', d.voided_at,
    'void_reason', d.void_reason,
    'credited_minor', d.credited_minor,
    'billed_minor', greatest(d.total_minor - d.credited_minor, 0),
    'version', d.version
  );
end $$;
revoke execute on function public.public_document_correction(uuid) from public;
grant  execute on function public.public_document_correction(uuid) to anon, authenticated;

-- =====================================================================
-- End migration 036.
-- =====================================================================
