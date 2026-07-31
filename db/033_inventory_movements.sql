-- =====================================================================
--  ServicePro — Migration 033 (inventory movements + real purchase orders)
--  Run once in the Supabase SQL Editor, AFTER 030. Safe to re-run.
--  Drops nothing: every existing column, policy and trigger survives.
--
--  THE GAP (remediation plan 5.11 + 5.19)
--
--  1. `inventory_items.quantity` was a single mutable integer updated by a
--     read-then-write (`select quantity` … `update quantity = q + delta`).
--     Two adjustments in the same second lose one of them, and nothing anywhere
--     records WHO changed stock, WHEN, or WHY.
--  2. Nothing consumed stock. `app/(app)/jobs/[id]/actions.ts` contained the
--     string "inventory" exactly zero times, so a technician fitting a part
--     decremented nothing. Inventory drifted out of true within a week and job
--     cost excluded materials entirely.
--  3. A purchase order stored ONE line, its status never left 'draft', there was
--     no receive step, and receiving stock never touched `inventory_items` —
--     so the one event that legitimately increases stock was not wired to stock.
--
--  THE SHAPE OF THE FIX is the one migration 030 used for refunds:
--  an append-only ledger, a derived cache so existing readers keep working,
--  and a database-level guard so the rule cannot be skipped by talking to
--  PostgREST directly.
--
--  ---------------------------------------------------------------------
--  DECISION: MAY STOCK GO NEGATIVE?  Yes — but never silently.
--  ---------------------------------------------------------------------
--  Both extremes are wrong. Refusing negative stock outright means a technician
--  who has physically fitted a part cannot record it, so the ledger loses the
--  truth AND the part is still gone from the van: the count is wrong either way,
--  and now the job is uncosted too. Allowing it freely means the last unit can be
--  consumed twice by two technicians who each believe they took it, and nobody
--  ever finds out.
--
--  So: a movement that would drive stock below zero is REFUSED by default. The
--  check runs inside a BEFORE INSERT trigger that first takes a row lock on the
--  item (`select … for update`), so two technicians consuming the last unit at
--  the same instant are serialised and exactly one succeeds — the second is told
--  the truth, that there is none left.
--
--  The technician who really did fit the part then re-submits with
--  `allow_negative = true` and a reason. That records the consumption, drives
--  the balance negative, and flags the item for reconciliation. It is an
--  explicit, attributed, audited act — not drift. A negative quantity_milli is
--  what /inventory reads to raise its "needs a stock count" banner, and it stays
--  up until a counting adjustment clears it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Stock in milliunits, alongside the integer column everything reads.
--
--    Every other quantity in this product is integer milliunits (job_items.
--    qty_milli, estimate/invoice items) so 0.5 of a metre is exact.
--    `inventory_items.quantity` is a plain integer and is READ by
--    components/InventoryClient.tsx and the low-stock alert, so it stays — as a
--    DERIVED cache. quantity_milli is the precise value; quantity is its floor,
--    which is the conservative direction: 0.4 of a unit never reads as "1
--    available", and the low-stock alert fires early rather than late.
-- ---------------------------------------------------------------------
alter table public.inventory_items
  add column if not exists quantity_milli bigint not null default 0;

-- Tenant safety by construction (the pattern from 014/030): the ledger's
-- (item_id, organization_id) pair must reference a real (id, organization_id)
-- pair, so a movement cannot be attached to another tenant's item even if RLS
-- were misconfigured.
do $$ begin
  alter table public.inventory_items add constraint inventory_items_id_org_key unique (id, organization_id);
exception when duplicate_table then null; when duplicate_object then null; end $$;

-- Backfill BEFORE the guards exist: today's integer count becomes the milliunit
-- count. Idempotent — a second run matches no rows.
update public.inventory_items
   set quantity_milli = quantity::bigint * 1000
 where quantity_milli = 0 and quantity <> 0;

-- ---------------------------------------------------------------------
-- 2. The ledger.
--
--    qty_milli is SIGNED: a receipt is positive, a consumption is negative, an
--    adjustment is either. Stock is therefore sum(qty_milli) — one definition,
--    no separate in/out columns to disagree with each other.
-- ---------------------------------------------------------------------
create table if not exists public.inventory_movements (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  item_id                uuid not null references public.inventory_items(id) on delete cascade,
  -- 'receipt'     = stock arrived (purchase order received, vendor delivery).
  -- 'consumption' = stock left because work consumed it (a part fitted on a job).
  -- 'adjustment'  = a correction: stocktake, breakage, opening balance, return.
  kind                   text not null check (kind in ('receipt','consumption','adjustment')),
  qty_milli              bigint not null check (qty_milli <> 0),
  unit_cost_minor        bigint not null default 0 check (unit_cost_minor >= 0),
  reason                 text not null check (length(btrim(reason)) > 0),
  -- Deliberate acknowledgement that this movement takes stock below zero.
  allow_negative         boolean not null default false,
  job_id                 uuid references public.jobs(id) on delete set null,
  job_item_id            uuid references public.job_items(id) on delete set null,
  purchase_order_item_id uuid references public.purchase_order_items(id) on delete set null,
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  -- A receipt can only add, a consumption can only remove. Only an adjustment
  -- may go either way, which is exactly what "adjustment" means.
  constraint inventory_movements_kind_sign check (
    (kind = 'receipt' and qty_milli > 0)
    or (kind = 'consumption' and qty_milli < 0)
    or kind = 'adjustment'
  ),
  -- Overriding the stock check requires saying why, in more than a keystroke.
  constraint inventory_movements_override_reason check (
    allow_negative = false or length(btrim(reason)) >= 3
  )
);

do $$ begin
  alter table public.inventory_movements
    add constraint inventory_movements_item_org_fk
    foreign key (item_id, organization_id)
    references public.inventory_items(id, organization_id) on delete cascade;
exception when duplicate_object then null; when undefined_object then
  raise notice 'inventory_items has no (id, organization_id) unique key; composite FK skipped';
end $$;

create index if not exists idx_inventory_movements_item
  on public.inventory_movements (item_id, created_at desc);
create index if not exists idx_inventory_movements_org
  on public.inventory_movements (organization_id, created_at desc);
create index if not exists idx_inventory_movements_job
  on public.inventory_movements (job_id) where job_id is not null;
create index if not exists idx_inventory_movements_po_item
  on public.inventory_movements (purchase_order_item_id) where purchase_order_item_id is not null;

-- Cross-tenant guards for the nullable references, using the 014 helper.
do $$
declare r record;
begin
  if to_regprocedure('public.assert_child_org()') is null then
    raise notice 'assert_child_org() not found; cross-tenant triggers skipped';
    return;
  end if;
  for r in select * from (values
    ('inventory_movements','inventory_movements_job_org_guard','jobs','job_id'),
    ('inventory_movements','inventory_movements_job_item_org_guard','job_items','job_item_id'),
    ('inventory_movements','inventory_movements_po_item_org_guard','purchase_order_items','purchase_order_item_id'),
    ('purchase_order_items','purchase_items_inventory_org_guard','inventory_items','inventory_item_id')
  ) as t(tbl,trg,parent,fkcol) loop
    execute format('drop trigger if exists %I on public.%I;', r.trg, r.tbl);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.assert_child_org(%L,%L);', r.trg, r.tbl, r.parent, r.fkcol);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. quantity / quantity_milli become DERIVED, maintained by trigger.
--
--    security definer because a technician has no UPDATE privilege on
--    inventory_items (010's inventory_write policy is owner/office) yet their
--    consumption must still move the cache. Same reasoning as 030's
--    sync_payment_refunded_total.
-- ---------------------------------------------------------------------
create or replace function public.sync_inventory_quantity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target uuid; total bigint;
begin
  target := coalesce(new.item_id, old.item_id);
  select coalesce(sum(m.qty_milli), 0) into total
    from public.inventory_movements m where m.item_id = target;
  perform set_config('servicepro.inventory_sync', 'on', true);
  update public.inventory_items
     set quantity_milli = total,
         quantity       = floor(total::numeric / 1000)::integer,
         updated_at     = now()
   where id = target;
  perform set_config('servicepro.inventory_sync', 'off', true);
  return coalesce(new, old);
end $$;
revoke all on function public.sync_inventory_quantity() from public, anon, authenticated;

drop trigger if exists trg_inventory_movements_sync on public.inventory_movements;
create trigger trg_inventory_movements_sync
after insert or update or delete on public.inventory_movements
for each row execute function public.sync_inventory_quantity();

-- A hand-edited quantity would be exactly the drift this migration exists to
-- stop, so the column refuses to be written by anything but the sync above.
create or replace function public.guard_inventory_quantity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('servicepro.inventory_sync', true), 'off') = 'on' then
    return new;
  end if;
  if new.quantity_milli is distinct from old.quantity_milli
     or new.quantity is distinct from old.quantity then
    raise exception 'inventory_quantity_is_derived'
      using errcode = 'check_violation',
            hint = 'Stock is the sum of inventory_movements. Insert a movement instead of writing the quantity column.';
  end if;
  return new;
end $$;
revoke all on function public.guard_inventory_quantity() from public, anon, authenticated;

drop trigger if exists trg_inventory_items_quantity_guard on public.inventory_items;
create trigger trg_inventory_items_quantity_guard
before update on public.inventory_items
for each row execute function public.guard_inventory_quantity();

-- Creating an item WITH stock is legitimate ("I already have 12 of these").
-- It becomes an opening-balance movement so the ledger is still the whole
-- story, and the existing insert path keeps working unchanged.
create or replace function public.seed_inventory_opening_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare opening bigint;
begin
  opening := case when new.quantity_milli <> 0 then new.quantity_milli
                  else coalesce(new.quantity, 0)::bigint * 1000 end;
  if opening = 0 then return new; end if;
  insert into public.inventory_movements
    (organization_id, item_id, kind, qty_milli, unit_cost_minor, reason, allow_negative, created_by)
  values
    (new.organization_id, new.id, 'adjustment', opening, coalesce(new.cost_minor, 0),
     'Opening stock', opening < 0, auth.uid());
  return new;
end $$;
revoke all on function public.seed_inventory_opening_stock() from public, anon, authenticated;

drop trigger if exists trg_inventory_items_opening_stock on public.inventory_items;
create trigger trg_inventory_items_opening_stock
after insert on public.inventory_items
for each row execute function public.seed_inventory_opening_stock();

-- ---------------------------------------------------------------------
-- 4. The stock guard — the concurrency-safe half.
--
--    `for update` on the item row is the serialisation point. Two transactions
--    consuming the last unit cannot both read "1 available": the second blocks
--    until the first commits and then sees 0. The available figure itself is
--    summed from the LEDGER, not from the cache, so even a corrupted cache
--    cannot authorise a consumption the ledger does not support.
-- ---------------------------------------------------------------------
create or replace function public.guard_inventory_movement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare item_org uuid; available bigint;
begin
  select i.organization_id into item_org
    from public.inventory_items i where i.id = new.item_id for update;
  if item_org is null then
    raise exception 'inventory_item_not_found' using errcode = 'foreign_key_violation';
  end if;
  if item_org <> new.organization_id then
    raise exception 'cross-tenant inventory movement blocked' using errcode = 'check_violation';
  end if;

  select coalesce(sum(m.qty_milli), 0) into available
    from public.inventory_movements m where m.item_id = new.item_id;

  if available + new.qty_milli < 0 and not coalesce(new.allow_negative, false) then
    raise exception 'insufficient_stock'
      using errcode = 'check_violation',
            detail = available::text,
            hint = format('%s milliunits in stock, %s requested.', available, abs(new.qty_milli));
  end if;
  return new;
end $$;
revoke all on function public.guard_inventory_movement() from public, anon, authenticated;

drop trigger if exists trg_inventory_movements_guard on public.inventory_movements;
create trigger trg_inventory_movements_guard
before insert on public.inventory_movements
for each row execute function public.guard_inventory_movement();

-- Append-only. A wrong movement is corrected by recording the opposite one,
-- never by rewriting history. The single exception is the cascade when the item
-- itself is deleted, which the audit log still records.
create or replace function public.guard_inventory_movement_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE'
     and not exists (select 1 from public.inventory_items i where i.id = old.item_id) then
    return old;
  end if;
  raise exception 'inventory_movements_append_only'
    using errcode = 'check_violation',
          hint = 'Record a correcting movement instead of editing or deleting this one.';
end $$;
revoke all on function public.guard_inventory_movement_immutable() from public, anon, authenticated;

drop trigger if exists trg_inventory_movements_immutable on public.inventory_movements;
create trigger trg_inventory_movements_immutable
before update or delete on public.inventory_movements
for each row execute function public.guard_inventory_movement_immutable();

-- ---------------------------------------------------------------------
-- 5. Access.
--
--    Technicians must be able to record what they fitted — that is the whole
--    point of 5.11 — but only consumption, only as themselves. Receiving stock
--    and adjusting counts stay with owner/office.
--    Unit costs are management information (023 §5), so a technician reads back
--    only their own movements.
-- ---------------------------------------------------------------------
alter table public.inventory_movements enable row level security;

drop policy if exists inventory_movements_select on public.inventory_movements;
create policy inventory_movements_select on public.inventory_movements for select to authenticated
  using (organization_id = public.current_org_id()
         and (public.current_user_role() in ('owner','office') or created_by = auth.uid()));

drop policy if exists inventory_movements_insert on public.inventory_movements;
create policy inventory_movements_insert on public.inventory_movements for insert to authenticated
  with check (organization_id = public.current_org_id()
              and (public.current_user_role() in ('owner','office')
                   -- A technician may record what they fitted, and may put back
                   -- what they did not use (a positive adjustment tied to a job).
                   -- They cannot receive purchases or write stock up out of thin
                   -- air: an adjustment with no job attached is refused.
                   or (created_by = auth.uid()
                       and (kind = 'consumption'
                            or (kind = 'adjustment' and qty_milli > 0 and job_id is not null)))));

-- No update and no delete policy, and the privileges are not granted: the
-- ledger is append-only at the privilege level as well as by trigger.
grant select, insert on public.inventory_movements to authenticated;
grant all on public.inventory_movements to service_role;
revoke all on public.inventory_movements from anon;

-- ---------------------------------------------------------------------
-- 6. Opening balances for stock that already exists.
--
--    Every item currently holding stock gets one 'Opening balance (migrated)'
--    movement, so sum(ledger) = quantity from the first moment the ledger
--    exists. Without this the first consumption would be refused on an item
--    that visibly has stock.
-- ---------------------------------------------------------------------
insert into public.inventory_movements
  (organization_id, item_id, kind, qty_milli, unit_cost_minor, reason, allow_negative)
select i.organization_id, i.id, 'adjustment', i.quantity_milli, coalesce(i.cost_minor, 0),
       'Opening balance (migrated)', i.quantity_milli < 0
  from public.inventory_items i
 where i.quantity_milli <> 0
   and not exists (select 1 from public.inventory_movements m where m.item_id = i.id);

-- ---------------------------------------------------------------------
-- 7. Purchase orders: multi-line, integer quantities, a real lifecycle.
--
--    `purchase_order_items.quantity` is numeric(12,3) — a float quantity in a
--    product where every other quantity is integer milliunits. It stays (nothing
--    is dropped, and it may have external readers) but becomes a derived mirror
--    of the new qty_milli, maintained by trigger in both directions so an old
--    writer that still sends `quantity` is translated rather than lost.
-- ---------------------------------------------------------------------
alter table public.purchase_order_items
  add column if not exists qty_milli          bigint  not null default 0,
  add column if not exists received_qty_milli bigint  not null default 0,
  add column if not exists sort               integer not null default 0,
  add column if not exists inventory_item_id  uuid references public.inventory_items(id) on delete set null;

do $$ begin
  alter table public.purchase_order_items add constraint purchase_order_items_qty_nonneg check (qty_milli >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.purchase_order_items add constraint purchase_order_items_received_nonneg check (received_qty_milli >= 0);
exception when duplicate_object then null; end $$;

update public.purchase_order_items
   set qty_milli = round(quantity * 1000)::bigint
 where qty_milli = 0 and quantity <> 0;
update public.purchase_order_items
   set received_qty_milli = round(received_quantity * 1000)::bigint
 where received_qty_milli = 0 and received_quantity <> 0;

create index if not exists idx_purchase_order_items_order
  on public.purchase_order_items (purchase_order_id, sort);

create or replace function public.sync_purchase_order_item_qty()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.qty_milli = 0 and coalesce(new.quantity, 0) <> 0 then
      new.qty_milli := round(new.quantity * 1000)::bigint;
    end if;
    if new.received_qty_milli = 0 and coalesce(new.received_quantity, 0) <> 0 then
      new.received_qty_milli := round(new.received_quantity * 1000)::bigint;
    end if;
  else
    if new.qty_milli is not distinct from old.qty_milli
       and new.quantity is distinct from old.quantity then
      new.qty_milli := round(new.quantity * 1000)::bigint;
    end if;
    if new.received_qty_milli is not distinct from old.received_qty_milli
       and new.received_quantity is distinct from old.received_quantity then
      new.received_qty_milli := round(new.received_quantity * 1000)::bigint;
    end if;
  end if;
  new.quantity          := new.qty_milli::numeric / 1000;
  new.received_quantity := new.received_qty_milli::numeric / 1000;
  return new;
end $$;

drop trigger if exists trg_purchase_order_items_qty on public.purchase_order_items;
create trigger trg_purchase_order_items_qty
before insert or update on public.purchase_order_items
for each row execute function public.sync_purchase_order_item_qty();

-- The PO total is the sum of its lines, computed the way lib/core/money.mjs
-- computes every other line total (qty_milli * unit_cost_minor / 1000, rounded
-- half-up). It used to be whatever the single-line create action wrote once and
-- nothing ever corrected.
create or replace function public.sync_purchase_order_total()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target uuid; total bigint;
begin
  target := coalesce(new.purchase_order_id, old.purchase_order_id);
  select coalesce(sum(round(i.qty_milli::numeric * i.unit_cost_minor / 1000)), 0)::bigint into total
    from public.purchase_order_items i where i.purchase_order_id = target;
  update public.purchase_orders set total_minor = total, updated_at = now() where id = target;
  return coalesce(new, old);
end $$;
revoke all on function public.sync_purchase_order_total() from public, anon, authenticated;

drop trigger if exists trg_purchase_order_items_total on public.purchase_order_items;
create trigger trg_purchase_order_items_total
after insert or update or delete on public.purchase_order_items
for each row execute function public.sync_purchase_order_total();

-- Lifecycle timestamps. The status column already allowed five values; nothing
-- ever moved it off 'draft', and there was no record of when it moved.
alter table public.purchase_orders
  add column if not exists ordered_at   timestamptz,
  add column if not exists received_at  timestamptz,
  add column if not exists cancelled_at timestamptz;

-- Legal transitions, enforced at the database so a direct PostgREST update
-- cannot jump a received PO back to draft.
create or replace function public.guard_purchase_order_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if not (
       (old.status = 'draft'              and new.status in ('ordered','cancelled'))
    or (old.status = 'ordered'            and new.status in ('partially_received','received','cancelled'))
    or (old.status = 'partially_received' and new.status in ('received','cancelled'))
  ) then
    raise exception 'purchase_order_status_transition_not_allowed'
      using errcode = 'check_violation',
            hint = format('%s cannot become %s.', old.status, new.status);
  end if;
  if new.status = 'ordered'   and new.ordered_at   is null then new.ordered_at   := now(); end if;
  if new.status = 'received'  and new.received_at  is null then new.received_at  := now(); end if;
  if new.status = 'cancelled' and new.cancelled_at is null then new.cancelled_at := now(); end if;
  return new;
end $$;

drop trigger if exists trg_purchase_orders_status on public.purchase_orders;
create trigger trg_purchase_orders_status
before update on public.purchase_orders
for each row execute function public.guard_purchase_order_status();

-- ---------------------------------------------------------------------
-- 8. Receiving — the step that closes the loop with the ledger.
--
--    One statement, one transaction: lock the line, add to what was received,
--    write the inventory receipt, advance the PO status. Doing this from the
--    application in three round trips would let a double-click receive twice
--    and leave the PO status disagreeing with its lines.
--
--    security definer, so it checks the caller's organisation and role itself
--    rather than relying on the RLS of the tables it touches.
-- ---------------------------------------------------------------------
create or replace function public.receive_purchase_order_line(
  p_line uuid,
  p_qty_milli bigint
) returns table (line_received_qty_milli bigint, po_status text)
language plpgsql security definer set search_path = '' as $$
declare line public.purchase_order_items%rowtype;
        po   public.purchase_orders%rowtype;
        outstanding bigint;
        next_status text;
begin
  if p_qty_milli is null or p_qty_milli <= 0 then
    raise exception 'receive_quantity_must_be_positive' using errcode = 'check_violation';
  end if;

  select * into line from public.purchase_order_items where id = p_line for update;
  if not found then
    raise exception 'purchase_order_line_not_found' using errcode = 'no_data_found';
  end if;
  if line.organization_id is distinct from public.current_org_id()
     or public.current_user_role() not in ('owner','office') then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;

  select * into po from public.purchase_orders where id = line.purchase_order_id for update;
  if po.status in ('received','cancelled') then
    raise exception 'purchase_order_closed'
      using errcode = 'check_violation', hint = format('This PO is already %s.', po.status);
  end if;
  -- A walk-in purchase is often received without anyone having pressed
  -- "ordered" first. Advance it rather than refusing the real-world case; the
  -- transition draft -> ordered is legal and gets its timestamp.
  if po.status = 'draft' then
    update public.purchase_orders set status = 'ordered' where id = po.id;
  end if;

  update public.purchase_order_items
     set received_qty_milli = line.received_qty_milli + p_qty_milli
   where id = line.id;

  if line.inventory_item_id is not null then
    insert into public.inventory_movements
      (organization_id, item_id, kind, qty_milli, unit_cost_minor, reason,
       purchase_order_item_id, created_by)
    values
      (line.organization_id, line.inventory_item_id, 'receipt', p_qty_milli,
       line.unit_cost_minor, format('Received on %s', po.po_number), line.id, auth.uid());
  end if;

  select coalesce(sum(greatest(i.qty_milli - i.received_qty_milli, 0)), 0) into outstanding
    from public.purchase_order_items i where i.purchase_order_id = po.id;

  next_status := case when outstanding = 0 then 'received' else 'partially_received' end;
  update public.purchase_orders set status = next_status where id = po.id and status <> next_status;

  return query
    select i.received_qty_milli, o.status
      from public.purchase_order_items i
      join public.purchase_orders o on o.id = i.purchase_order_id
     where i.id = line.id;
end $$;
revoke execute on function public.receive_purchase_order_line(uuid, bigint) from public, anon;
grant  execute on function public.receive_purchase_order_line(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Audit trail. Stock is money in a shed, and neither table had one.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.audit_trigger()') is not null then
    -- INSERT and DELETE only: every UPDATE to inventory_items is the derived
    -- quantity being resynced, which the movement's own audit row already
    -- explains. What is worth recording is an item appearing or disappearing —
    -- deletion cascades the ledger away, so it must leave a trace.
    drop trigger if exists trg_inventory_items_audit on public.inventory_items;
    create trigger trg_inventory_items_audit
      after insert or delete on public.inventory_items
      for each row execute function public.audit_trigger();

    drop trigger if exists trg_inventory_movements_audit on public.inventory_movements;
    create trigger trg_inventory_movements_audit
      after insert or update or delete on public.inventory_movements
      for each row execute function public.audit_trigger();

    drop trigger if exists trg_purchase_orders_audit on public.purchase_orders;
    create trigger trg_purchase_orders_audit
      after insert or update or delete on public.purchase_orders
      for each row execute function public.audit_trigger();
  else
    raise notice 'audit_trigger() not found; inventory audit triggers skipped';
  end if;
end $$;

-- =====================================================================
-- End migration 033.
-- =====================================================================
