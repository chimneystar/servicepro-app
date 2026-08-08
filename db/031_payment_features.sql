-- =====================================================================
--  ServicePro — Migration 031 (tips, deposits, schedules, ACH holds)
--  Run once in the Supabase SQL Editor, AFTER 030. Safe to re-run.
--  Additive only: this migration DROPS NOTHING and rewrites no existing row.
--
--  Five settings and two tables existed and did nothing. This migration adds
--  the columns and the one server-side rule the application halves need.
--
--   5.2 TIPS               payment_settings.tips_enabled and
--                          suggested_tip_percents were stored; payments.tip_minor
--                          was READ when a receipt rendered and WRITTEN BY
--                          NOTHING. A checkout has to carry the tip from the
--                          moment it is chosen to the moment it is charged, so
--                          payment_requests gains tip_minor.
--
--   5.4 ACH HOLD           payment_settings.ach_hold_until_settled and the
--                          profile_payment_permissions.can_override_ach_holds
--                          permission were both read by nothing. A release now
--                          has somewhere to be recorded.
--
--   5.5 SCHEDULES          payment_schedules / payment_milestones had composite
--                          tenant keys, RLS, indexes and a milestone_id column
--                          on payment_requests — and zero application
--                          references. They need a uniqueness rule and a
--                          release record before they can be written safely.
--
--   5.6 DEFAULT DEPOSIT    payment_settings.default_deposit_type/_bps/_minor
--                          was saved by /settings/payments and READ BY NO
--                          DOCUMENT CODE. Applied here as a BEFORE INSERT rule
--                          on estimates so it holds for every path that creates
--                          one — the estimate form, a duplicate, and the online
--                          booking deposit — rather than for whichever call
--                          site someone remembered.
--
--   5.7 BOOKING DEPOSIT    booking_settings.payment_mode / deposit_value were
--                          surfaced as copy and charged nothing. The booking
--                          deposit is raised as a real estimate, so the lead
--                          needs to point at it, and the service-role booking
--                          endpoint needs a way to allocate a document number
--                          (next_document_number() requires current_org_id(),
--                          which is null for service_role).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tips ride on the checkout session, not on the balance.
--
--    payment_requests.amount_minor is what the card is charged. With a tip that
--    is balance + tip, and the split has to survive the round trip to Helcim,
--    so the tip is stored alongside rather than inferred afterwards. The
--    payment row keeps base_amount_minor = balance, which is what every
--    collected-money reader in the product sums — so a tip is never revenue,
--    never reduces an invoice balance, and (via guard_refund_amount in 030) is
--    never refundable as the business's money.
-- ---------------------------------------------------------------------
alter table public.payment_requests add column if not exists tip_minor bigint not null default 0;

do $$ begin
  alter table public.payment_requests add constraint payment_requests_tip_check
    check (tip_minor >= 0 and tip_minor <= amount_minor);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. The organisation default deposit, applied where it cannot be forgotten.
--
--    deposit_minor is `not null default 0`, so 0 on insert means "the caller did
--    not ask for a deposit" and is the only signal available. An explicit
--    deposit is left exactly as given.
--
--    This is a BEFORE INSERT trigger and not application code because
--    lib/documents.ts is the single insert path for BOTH estimates and
--    invoices and does not return the new row's id, so an after-the-fact
--    application update would have to guess which estimate it had just made.
-- ---------------------------------------------------------------------
create or replace function public.apply_default_estimate_deposit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cfg public.payment_settings%rowtype; computed bigint;
begin
  if coalesce(new.deposit_minor, 0) <> 0 then return new; end if;
  if coalesce(new.total_minor, 0) <= 0 then return new; end if;

  select * into cfg from public.payment_settings
   where organization_id = new.organization_id;
  if not found then return new; end if;

  if cfg.default_deposit_type = 'percent' then
    -- Integer, half-up. Mirrors defaultDepositMinor() in lib/core/deposits.mjs.
    computed := (new.total_minor * least(coalesce(cfg.default_deposit_bps, 0), 10000) + 5000) / 10000;
  elsif cfg.default_deposit_type = 'fixed' then
    computed := coalesce(cfg.default_deposit_minor, 0);
  else
    return new;
  end if;

  -- A deposit larger than the document can never be settled.
  new.deposit_minor := least(greatest(coalesce(computed, 0), 0), new.total_minor);
  return new;
end $$;
revoke all on function public.apply_default_estimate_deposit() from public, anon, authenticated;

drop trigger if exists trg_estimates_default_deposit on public.estimates;
create trigger trg_estimates_default_deposit
before insert on public.estimates
for each row execute function public.apply_default_estimate_deposit();

-- ---------------------------------------------------------------------
-- 3. One schedule per document.
--
--    Nothing has ever written these tables, so there is no existing data to
--    conflict; the index is still created defensively inside a block so a
--    hand-seeded duplicate cannot abort the whole migration.
-- ---------------------------------------------------------------------
do $$ begin
  create unique index if not exists uq_payment_schedules_estimate
    on public.payment_schedules (estimate_id) where estimate_id is not null;
exception when unique_violation then
  raise notice 'payment_schedules already holds two schedules for one estimate; unique index skipped';
end $$;

do $$ begin
  create unique index if not exists uq_payment_schedules_invoice
    on public.payment_schedules (invoice_id) where invoice_id is not null;
exception when unique_violation then
  raise notice 'payment_schedules already holds two schedules for one invoice; unique index skipped';
end $$;

-- The office review queue asks "which milestones are waiting on the bank?".
create index if not exists idx_payment_milestones_org_status
  on public.payment_milestones (organization_id, status, due_at);

-- ---------------------------------------------------------------------
-- 4. Recording an ACH hold release.
--
--    can_override_ach_holds has been assignable on the team screen since 017 and
--    granted nothing. Releasing early is a financial decision with a named
--    author, so it is written down on the milestone as well as in audit_log.
-- ---------------------------------------------------------------------
alter table public.payment_milestones add column if not exists released_by uuid references public.profiles(id) on delete set null;
alter table public.payment_milestones add column if not exists released_at timestamptz;
alter table public.payment_milestones add column if not exists release_reason text;

do $$
begin
  if to_regprocedure('public.assert_child_org()') is not null then
    drop trigger if exists payment_milestones_releaser_org_guard on public.payment_milestones;
    create trigger payment_milestones_releaser_org_guard before insert or update on public.payment_milestones
      for each row execute function public.assert_child_org('profiles', 'released_by');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. The booking deposit's estimate, linked back to the lead that caused it.
--
--    Without the link the release step (create the customer and job once the
--    deposit clears) would have to match a lead to an estimate by name, which
--    is exactly the kind of guess that produces a job for the wrong customer.
-- ---------------------------------------------------------------------
alter table public.leads add column if not exists deposit_estimate_id uuid references public.estimates(id) on delete set null;
create index if not exists idx_leads_deposit_estimate
  on public.leads (deposit_estimate_id) where deposit_estimate_id is not null;

do $$
begin
  if to_regprocedure('public.assert_child_org()') is not null then
    drop trigger if exists leads_deposit_estimate_org_guard on public.leads;
    create trigger leads_deposit_estimate_org_guard before insert or update on public.leads
      for each row execute function public.assert_child_org('estimates', 'deposit_estimate_id');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. Document numbering for the unauthenticated booking endpoint.
--
--    next_document_number() raises 'forbidden' unless p_org = current_org_id(),
--    which is null under service_role — correct for the staff path, useless for
--    the public booking endpoint that must mint an estimate for a deposit. This
--    is the same counter, reachable only by service_role, so a browser cannot
--    burn an organisation's numbering.
-- ---------------------------------------------------------------------
create or replace function public.allocate_document_number(p_org uuid, p_kind text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_kind = 'invoice' then
    update public.organizations set invoice_counter = invoice_counter + 1
     where id = p_org returning invoice_counter into n;
  elsif p_kind = 'estimate' then
    update public.organizations set estimate_counter = estimate_counter + 1
     where id = p_org returning estimate_counter into n;
  else
    raise exception 'unknown document kind';
  end if;
  if n is null then raise exception 'unknown organization'; end if;
  return n;
end $$;
revoke all on function public.allocate_document_number(uuid, text) from public, anon, authenticated;
grant execute on function public.allocate_document_number(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 7. Hot path for the hold: "is any ACH still in flight for this document?"
-- ---------------------------------------------------------------------
create index if not exists idx_payments_in_flight
  on public.payments (organization_id, normalized_status)
  where normalized_status = 'processing';

-- ---------------------------------------------------------------------
-- 8. Tip choices for an opaque public document token.
--
--    payment_settings is readable only by an authenticated owner or office
--    member, which is correct — it holds the Zelle and cheque payout details.
--    A customer paying through /p/<token> is anonymous, so the two fields the
--    tip control needs are exposed through their own tiny SECURITY DEFINER
--    function rather than by widening the settings policy or by duplicating the
--    whole public_payment_options function to add two keys.
--
--    It returns nothing else. No payout details, no processor state, no amount.
-- ---------------------------------------------------------------------
create or replace function public.public_tip_options(p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_enabled boolean; v_percents integer[];
begin
  select organization_id into v_org from public.estimates
   where public_token = p_token and deleted_at is null;
  if v_org is null then
    select organization_id into v_org from public.invoices
     where public_token = p_token and deleted_at is null;
  end if;
  if v_org is null then return null; end if;

  select tips_enabled, suggested_tip_percents into v_enabled, v_percents
    from public.payment_settings where organization_id = v_org;
  if not found or not coalesce(v_enabled, false) then
    return jsonb_build_object('enabled', false, 'percents', jsonb_build_array());
  end if;
  return jsonb_build_object('enabled', true, 'percents', to_jsonb(coalesce(v_percents, array[15,20,25])));
end $$;

revoke execute on function public.public_tip_options(uuid) from public;
grant execute on function public.public_tip_options(uuid) to anon, authenticated;

-- =====================================================================
-- End migration 031.
-- =====================================================================
