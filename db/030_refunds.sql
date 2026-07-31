-- =====================================================================
--  ServicePro — Migration 030 (refunds)
--  Run once in the Supabase SQL Editor, AFTER 029. Safe to re-run.
--
--  THE GAP: `payments.refunded_minor` is READ in fourteen places — the open
--  balance, invoice paid-state, receipts, the reports, the commission report and
--  three dashboard figures all subtract it — but NOTHING IN THE PRODUCT HAS EVER
--  WRITTEN IT. There is no refund action, no route, no UI. The
--  `can_refund_payments` permission exists, is assignable on the Team screen,
--  and grants nothing.
--
--  The practical consequence: an overcharge cannot be corrected in-product at
--  all. The books permanently overstate revenue, and the only remedies are
--  editing a payment row by hand (which silently corrupts reporting and
--  commission) or refunding outside the system and leaving the records wrong.
--
--  A refund is TWO things: money moving back, and a record of why. This
--  migration builds the record — an append-only ledger, not a mutable counter —
--  and keeps `payments.refunded_minor` as a derived cache so the fourteen
--  existing readers keep working untouched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The ledger.
-- ---------------------------------------------------------------------
create table if not exists public.payment_refunds (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  payment_id             uuid not null references public.payments(id) on delete cascade,
  amount_minor           bigint not null check (amount_minor > 0),
  reason                 text not null,
  -- 'provider' = money returned through the card/ACH processor.
  -- 'manual'   = the business returned it themselves (Zelle, cheque, cash).
  --              Zelle and cheque refunds are inherently manual; the product
  --              cannot move that money, only record that it moved.
  method                 text not null default 'manual' check (method in ('provider','manual')),
  status                 text not null default 'completed'
                           check (status in ('pending','completed','failed')),
  provider               text,
  provider_refund_id     text,
  failure_reason         text,
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Idempotency: a provider refund must never be recorded twice on redelivery.
create unique index if not exists uq_payment_refunds_provider
  on public.payment_refunds (provider, provider_refund_id)
  where provider_refund_id is not null;

create index if not exists idx_payment_refunds_payment
  on public.payment_refunds (payment_id, created_at desc);
create index if not exists idx_payment_refunds_org
  on public.payment_refunds (organization_id, created_at desc);

-- Tenant safety by construction, matching migration 014's pattern.
do $$ begin
  alter table public.payment_refunds
    add constraint payment_refunds_payment_org_fk
    foreign key (payment_id, organization_id)
    references public.payments(id, organization_id) on delete cascade;
exception when duplicate_object then null; when undefined_object then
  raise notice 'payments has no (id, organization_id) unique key; composite FK skipped';
end $$;

do $$ begin
  alter table public.payments add constraint payments_id_org_key unique (id, organization_id);
exception when duplicate_table then null; when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. Keep payments.refunded_minor derived from the ledger.
--
--    The fourteen existing readers all use payments.refunded_minor. Rather than
--    change all of them, it becomes a cache maintained by trigger — so it can
--    never drift from the ledger, and a hand-edit of the column is overwritten
--    the next time a refund is recorded.
-- ---------------------------------------------------------------------
create or replace function public.sync_payment_refunded_total()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target uuid; total bigint;
begin
  target := coalesce(new.payment_id, old.payment_id);
  select coalesce(sum(amount_minor), 0) into total
    from public.payment_refunds
   where payment_id = target and status = 'completed';
  update public.payments set refunded_minor = total where id = target;
  return coalesce(new, old);
end $$;
revoke all on function public.sync_payment_refunded_total() from public, anon, authenticated;

drop trigger if exists trg_payment_refunds_sync on public.payment_refunds;
create trigger trg_payment_refunds_sync
after insert or update or delete on public.payment_refunds
for each row execute function public.sync_payment_refunded_total();

-- ---------------------------------------------------------------------
-- 3. A refund can never exceed what was actually collected.
--
--    Enforced in the database, not only in the action: an over-refund would make
--    creditedMinor() clamp to zero and silently understate revenue, and the
--    error would surface as a wrong number rather than a refusal.
-- ---------------------------------------------------------------------
create or replace function public.guard_refund_amount()
returns trigger language plpgsql security definer set search_path = '' as $$
declare collected bigint; already bigint;
begin
  if new.status <> 'completed' then return new; end if;

  select coalesce(p.base_amount_minor, p.amount_minor, 0) into collected
    from public.payments p where p.id = new.payment_id;

  select coalesce(sum(r.amount_minor), 0) into already
    from public.payment_refunds r
   where r.payment_id = new.payment_id
     and r.status = 'completed'
     and r.id <> new.id;

  if already + new.amount_minor > collected then
    raise exception 'refund_exceeds_payment'
      using errcode = 'check_violation',
            hint = format('This payment collected %s and %s has already been refunded.', collected, already);
  end if;
  return new;
end $$;
revoke all on function public.guard_refund_amount() from public, anon, authenticated;

drop trigger if exists trg_payment_refunds_guard on public.payment_refunds;
create trigger trg_payment_refunds_guard
before insert or update on public.payment_refunds
for each row execute function public.guard_refund_amount();

-- ---------------------------------------------------------------------
-- 4. Access. Refunding is a financial authority, so it is owner-only unless the
--    owner has explicitly granted can_refund_payments — the permission that has
--    existed since 017 and until now did nothing.
-- ---------------------------------------------------------------------
alter table public.payment_refunds enable row level security;

drop policy if exists payment_refunds_select on public.payment_refunds;
create policy payment_refunds_select on public.payment_refunds for select to authenticated
  using (organization_id = public.current_org_id()
         and public.current_user_role() in ('owner','office'));

drop policy if exists payment_refunds_write on public.payment_refunds;
create policy payment_refunds_write on public.payment_refunds for all to authenticated
  using (organization_id = public.current_org_id() and public.can_refund_payments())
  with check (organization_id = public.current_org_id() and public.can_refund_payments());

create or replace function public.can_refund_payments()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select true from public.profiles
      where id = auth.uid() and role = 'owner' and organization_id = public.current_org_id()),
    (select perm.can_refund_payments from public.profile_payment_permissions perm
      where perm.profile_id = auth.uid()),
    false)
$$;
revoke execute on function public.can_refund_payments() from public, anon;
grant  execute on function public.can_refund_payments() to authenticated;

grant select, insert, update on public.payment_refunds to authenticated;
grant all on public.payment_refunds to service_role;
revoke all on public.payment_refunds from anon;

-- Deleting a refund would rewrite financial history: no delete policy, and the
-- privilege is not granted. Corrections are made by recording a further entry.

-- ---------------------------------------------------------------------
-- 5. Audit trail on payments — the money table had none.
--
--    schema.sql attaches audit_trigger to jobs, invoices, estimates and
--    customers. `payments` was omitted, so a payment could be edited or deleted
--    with no forensic record at all. Refunds make that gap materially worse.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.audit_trigger()') is not null then
    drop trigger if exists trg_payments_audit on public.payments;
    create trigger trg_payments_audit
      after insert or update or delete on public.payments
      for each row execute function public.audit_trigger();

    drop trigger if exists trg_payment_refunds_audit on public.payment_refunds;
    create trigger trg_payment_refunds_audit
      after insert or update or delete on public.payment_refunds
      for each row execute function public.audit_trigger();
  else
    raise notice 'audit_trigger() not found; payment audit triggers skipped';
  end if;
end $$;

-- =====================================================================
-- End migration 030.
-- =====================================================================
