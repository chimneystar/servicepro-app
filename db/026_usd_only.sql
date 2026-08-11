-- =====================================================================
--  ServicePro — Migration 026 (currency consistency)
--  Run once in the Supabase SQL Editor, AFTER 025. Safe to re-run.
--
--  THE PROBLEM: organizations.currency permitted ('USD','ILS','EUR') and both
--  onboarding and settings offered all three — but the payment layer is USD-only
--  end to end:
--    * lib/payments/server.ts refuses a non-USD document outright for Helcim
--      card and ACH ("currency_not_supported").
--    * payment_requests.currency is `check (currency = 'USD')` (migration 017),
--      so the manual Zelle/cheque path violates a constraint and surfaces a raw
--      Postgres error.
--
--  So an organisation that picked ILS or EUR got a business that looked fully
--  configured and had NO working payment method at all.
--
--  DECISION (owner, 2026-07-31): this deployment invoices in USD. Rather than
--  leave a trap in the setup screen, the choice is removed and the database
--  agrees with the payment layer.
--
--  NOTE: currency and LANGUAGE are independent. organizations.locale still
--  supports 'he', and the Hebrew interface is unaffected — a Hebrew-speaking
--  business billing in USD is a supported combination and stays supported.
--
--  REVERSIBILITY: if non-USD is wanted later, the work is to make the payment
--  layer multi-currency FIRST (Helcim account per currency, drop the
--  payment_requests CHECK, decide on rounding and formatting per currency), and
--  only then widen this constraint. Widening it alone would restore the trap.
-- =====================================================================

-- Any organisation already on a currency payments cannot serve is moved to USD.
-- Their stored amounts are integer minor units and are NOT rescaled — no
-- conversion is implied or performed, and none would be correct to invent here.
do $$
declare affected integer;
begin
  select count(*) into affected from public.organizations where currency <> 'USD';
  if affected > 0 then
    raise notice 'CURRENCY: % organisation(s) were set to a currency the payment layer cannot serve; moving them to USD. Amounts are unchanged — review them if any real invoices exist.', affected;
    update public.organizations set currency = 'USD' where currency <> 'USD';
  end if;
end $$;

alter table public.organizations drop constraint if exists organizations_currency_check;
alter table public.organizations
  add constraint organizations_currency_check check (currency = 'USD');

comment on column public.organizations.currency is
  'USD only. The payment layer (Helcim + manual) is USD-only; see '
  'db/026_usd_only.sql before widening this. Language is separate: '
  'organizations.locale still supports he/en.';

-- =====================================================================
-- End migration 026.
-- =====================================================================
