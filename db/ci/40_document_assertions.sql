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

-- ---------------------------------------------------------------------
-- 5. A VOIDED document cannot be signed.
--
--     Migration 036 §11 added `voided_at is null` for exactly this. Migration
--     038 replaced the function with a wrapper delegating to
--     approve_document_with_evidence, carried the sign-once guard across, and
--     did not carry this one — so from 038 until migration 042 anyone holding
--     the public link to a document the business had VOIDED could still sign it
--     into an approved, signed document. Nothing caught it, because nothing
--     had ever called the function; the whole of db/ci had never been run.
--
--     Both directions, as always: the voided document must be refused and the
--     live one beside it must still sign, or the guard is just an outage.
-- ---------------------------------------------------------------------
insert into public.estimates (id, organization_id, number, customer_id, status, total_minor, public_token)
values ('aaaa0000-0000-4000-8000-0000000000a2', 'aaaa0000-0000-4000-8000-000000000001', 900004,
        'aaaa0000-0000-4000-8000-000000000006', 'sent', 7000,
        'aaaa0000-0000-4000-8000-0000000000b2');
update public.estimates set voided_at = now(), void_reason = 'priced wrong'
 where id = 'aaaa0000-0000-4000-8000-0000000000a2';

insert into public.invoices (id, organization_id, number, customer_id, total_minor, public_token)
values ('aaaa0000-0000-4000-8000-0000000000a3', 'aaaa0000-0000-4000-8000-000000000001', 900005,
        'aaaa0000-0000-4000-8000-000000000006', 7000,
        'aaaa0000-0000-4000-8000-0000000000b3');
update public.invoices set voided_at = now(), void_reason = 'cancelled'
 where id = 'aaaa0000-0000-4000-8000-0000000000a3';

select ci.assert(
  (select voided_at is not null and signed_at is null from public.estimates
     where id = 'aaaa0000-0000-4000-8000-0000000000a2'),
  'fixture: the estimate under test is voided and unsigned');

set role anon;
select ci.assert(
  public.approve_document('aaaa0000-0000-4000-8000-0000000000b2', 'Opportunist', 'sig-void') is false,
  'approve_document REFUSES to sign a VOIDED estimate');
select ci.assert(
  public.approve_document('aaaa0000-0000-4000-8000-0000000000b3', 'Opportunist', 'sig-void') is false,
  'approve_document REFUSES to sign a VOIDED invoice');
reset role;

select ci.assert(
  (select signed_at is null and signer_name is null and status::text = 'sent'
     from public.estimates where id = 'aaaa0000-0000-4000-8000-0000000000a2'),
  'the voided estimate was not signed, approved or stamped');
select ci.assert(
  (select signed_at is null and signer_name is null
     from public.invoices where id = 'aaaa0000-0000-4000-8000-0000000000a3'),
  'the voided invoice was not signed');

-- The same call, on the SAME kind of document that is simply not voided, must
-- still work — otherwise 042 is an outage dressed as a fix.
insert into public.estimates (id, organization_id, number, customer_id, status, total_minor, public_token)
values ('aaaa0000-0000-4000-8000-0000000000a4', 'aaaa0000-0000-4000-8000-000000000001', 900006,
        'aaaa0000-0000-4000-8000-000000000006', 'sent', 7000,
        'aaaa0000-0000-4000-8000-0000000000b4');
set role anon;
select ci.assert(
  public.approve_document('aaaa0000-0000-4000-8000-0000000000b4', 'Real Customer', 'sig-live') is true,
  'a live estimate beside the voided one still signs');
reset role;
select ci.assert(
  (select signer_name from public.estimates where id = 'aaaa0000-0000-4000-8000-0000000000a4') = 'Real Customer',
  'the live signature really landed');

select set_config('request.jwt.claim.sub', '', false);
rollback;

do $$ begin raise notice 'document signing assertions complete'; end $$;
