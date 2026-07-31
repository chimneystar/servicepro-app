-- =====================================================================
--  ServicePro — Migration 024 (deposit crediting)
--  Run once in the Supabase SQL Editor, AFTER 023. Safe to re-run.
--
--  THE BUG THIS FIXES — customers were being billed twice.
--
--  When an estimate is converted to an invoice, convertEstimateToInvoice copies
--  total_minor verbatim and records NO link back to the estimate: the invoices
--  table simply had no estimate_id column. Deposits, meanwhile, are stored on
--  payments.estimate_id.
--
--  openBalance() and refreshInvoicePaidState() both look up payments by
--  invoice_id alone, so a deposit paid against the estimate is invisible to the
--  invoice. A customer who paid a 30% deposit was then asked for 100% of the
--  job, on a public payment page, with no screen anywhere that would reveal it.
--
--  This migration adds the missing link. The application changes that consume it
--  are in the same commit (lib/payments/server.ts, estimates/actions.ts,
--  invoices/[id]/page.tsx).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The missing relationship.
-- ---------------------------------------------------------------------
alter table public.invoices add column if not exists estimate_id uuid;

comment on column public.invoices.estimate_id is
  'The estimate this invoice was converted from, if any. Load-bearing: deposits '
  'are recorded against payments.estimate_id, and the open balance for this '
  'invoice credits them via this column. See lib/payments/server.ts openBalance().';

-- Tenant safety by construction rather than by trigger: estimates already has
-- the composite unique key (id, organization_id) from migration 014, and a
-- composite FK is MATCH SIMPLE, so it is simply not enforced while estimate_id
-- is NULL — which is the normal case for a directly-created invoice.
do $$ begin
  alter table public.invoices
    add constraint invoices_estimate_org_fk
    foreign key (estimate_id, organization_id)
    references public.estimates(id, organization_id)
    on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists idx_invoices_estimate on public.invoices(estimate_id)
  where estimate_id is not null;

-- ---------------------------------------------------------------------
-- 2. Backfill existing conversions.
--
--    Conversions before this migration left no link at all, so it has to be
--    reconstructed. The only safe signal is an exact match on customer, org and
--    total, restricted to estimates that carried a deposit — because those are
--    the only ones where the missing link could have caused an overcharge.
--
--    Deliberately conservative: ambiguous matches (more than one candidate
--    estimate) are left alone rather than guessed. A wrong link would credit a
--    payment to the wrong invoice, which is worse than the status quo.
-- ---------------------------------------------------------------------
with candidate as (
  select i.id as invoice_id,
         (array_agg(e.id order by e.created_at desc))[1] as estimate_id,
         count(*) as matches
    from public.invoices i
    join public.estimates e
      on e.organization_id = i.organization_id
     and e.customer_id     = i.customer_id
     and e.total_minor     = i.total_minor
     and e.deleted_at is null
     and coalesce(e.deposit_minor, 0) > 0
     and e.status = 'approved'
   where i.estimate_id is null
     and i.deleted_at is null
   group by i.id
)
update public.invoices i
   set estimate_id = c.estimate_id
  from candidate c
 where i.id = c.invoice_id
   and c.matches = 1;   -- unambiguous only

-- ---------------------------------------------------------------------
-- 3. Report what could not be reconstructed, so it can be reconciled by hand
--    rather than silently forgotten.
-- ---------------------------------------------------------------------
do $$
declare unlinked integer; exposed integer;
begin
  select count(*) into unlinked
    from public.invoices i
   where i.estimate_id is null and i.deleted_at is null
     and exists (select 1 from public.estimates e
                  where e.organization_id = i.organization_id
                    and e.customer_id = i.customer_id
                    and coalesce(e.deposit_minor,0) > 0
                    and e.deleted_at is null);

  select count(*) into exposed
    from public.payments p
   where p.estimate_id is not null
     and p.invoice_id is null
     and p.normalized_status in ('settled','partially_refunded');

  if unlinked > 0 then
    raise notice 'DEPOSIT BACKFILL: % invoice(s) could not be linked unambiguously and may need manual reconciliation.', unlinked;
  end if;
  raise notice 'DEPOSIT BACKFILL: % settled deposit payment(s) exist against estimates; these now credit their linked invoice.', exposed;
end $$;

-- =====================================================================
-- End migration 024.
-- =====================================================================
