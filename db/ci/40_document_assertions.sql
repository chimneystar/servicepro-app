-- =====================================================================
--  ServicePro — CI assertions: approve_document signs exactly once
--
--  Audit finding: approve_document() could be called repeatedly on the same
--  public token, each call overwriting signer_name, signature_data and
--  signed_at. The customer's original e-signature — the only evidence the
--  business has that the work was authorised — was destroyed by whoever held
--  the link last. Migration 023 §6 adds `and signed_at is null`.
--
--  Run as `anon`, because that is who actually calls this: the document is
--  opened from a public link by someone with no account.
--
--  Both directions: the first signature must succeed and the second must be
--  refused WITHOUT changing anything. A guard that refused every signature
--  would break the product while passing a one-sided test.
-- =====================================================================

set client_min_messages = notice;
begin;

-- A second unsigned estimate, to prove the guard is per-document rather than
-- a global "no more signing" switch.
insert into public.estimates (id, organization_id, number, customer_id, status, total_minor, public_token)
values ('aaaa0000-0000-4000-8000-0000000000a1', 'aaaa0000-0000-4000-8000-000000000001', 900003,
        'aaaa0000-0000-4000-8000-000000000006', 'sent', 5000,
        'aaaa0000-0000-4000-8000-0000000000b1');

select ci.assert(
  (select signed_at is null and status::text = 'sent'
     from public.estimates where id = 'aaaa0000-0000-4000-8000-00000000000a'),
  'the estimate under test starts unsigned and in status sent');

-- ---------------------------------------------------------------------
-- 1. The legitimate first signature.
-- ---------------------------------------------------------------------
set role anon;

select ci.assert(
  public.approve_document('aaaa0000-0000-4000-8000-00000000000b', 'First Signer', 'signature-one') is true,
  'approve_document SIGNS an unsigned estimate (returns true)');

reset role;

select ci.assert(
  (select signer_name from public.estimates where id = 'aaaa0000-0000-4000-8000-00000000000a') = 'First Signer',
  'the first signer name was recorded');
select ci.assert(
  (select signature_data from public.estimates where id = 'aaaa0000-0000-4000-8000-00000000000a') = 'signature-one',
  'the first signature image was recorded');
select ci.assert(
  (select signed_at is not null from public.estimates where id = 'aaaa0000-0000-4000-8000-00000000000a'),
  'signed_at was stamped');
select ci.assert(
  (select status::text from public.estimates where id = 'aaaa0000-0000-4000-8000-00000000000a') = 'approved',
  'the estimate moved to approved');

-- Remember the exact timestamp so the second call can be shown not to move it.
select set_config('ci.first_signed_at',
                  (select signed_at::text from public.estimates
                     where id = 'aaaa0000-0000-4000-8000-00000000000a'),
                  false);

-- ---------------------------------------------------------------------
-- 2. The forbidden second signature.
-- ---------------------------------------------------------------------
set role anon;

select ci.assert(
  public.approve_document('aaaa0000-0000-4000-8000-00000000000b', 'Attacker', 'signature-two') is false,
  'approve_document REFUSES to re-sign an already-signed estimate (returns false)');

reset role;

select ci.assert(
  (select signer_name from public.estimates where id = 'aaaa0000-0000-4000-8000-00000000000a') = 'First Signer',
  'the original signer name was NOT overwritten');
select ci.assert(
  (select signature_data from public.estimates where id = 'aaaa0000-0000-4000-8000-00000000000a') = 'signature-one',
  'the original signature image was NOT overwritten');
select ci.assert(
  (select signed_at::text from public.estimates where id = 'aaaa0000-0000-4000-8000-00000000000a')
    = current_setting('ci.first_signed_at'),
  'signed_at was NOT moved by the second call');

-- ---------------------------------------------------------------------
-- 3. A DIFFERENT unsigned document still signs — the guard is per document.
-- ---------------------------------------------------------------------
set role anon;

select ci.assert(
  public.approve_document('aaaa0000-0000-4000-8000-0000000000b1', 'Second Customer', 'signature-three') is true,
  'a different unsigned estimate can still be signed');

reset role;

select ci.assert(
  (select signer_name from public.estimates where id = 'aaaa0000-0000-4000-8000-0000000000a1') = 'Second Customer',
  'the second document recorded its own signer');

-- ---------------------------------------------------------------------
-- 4. An unknown token signs nothing at all.
-- ---------------------------------------------------------------------
set role anon;
select ci.assert(
  public.approve_document('00000000-0000-4000-8000-0000000000ff', 'Nobody', 'x') is false,
  'approve_document returns false for an unknown token');
reset role;

select set_config('request.jwt.claim.sub', '', false);
rollback;

do $$ begin raise notice 'document signing assertions complete'; end $$;
