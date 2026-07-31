-- =====================================================================
--  ServicePro — Migration 042: a VOIDED document cannot be signed.
--
--  THE DEFECT — found by executing db/ci/ against a real Postgres for the
--  first time (remediation ledger 0.6).
--
--  Migration 036 §11 rewrote public.approve_document() for one reason: to add
--  `and voided_at is null` to both of its UPDATEs, so that a document the
--  business had voided could not still be approved and signed from the
--  customer's old public link. Its own header says so:
--
--      "Body copied verbatim from migration 023 §6 — including the sign-once
--       guard, which must not be lost — with `voided_at is null` added to both
--       updates."
--
--  Migration 038 §? then replaced approve_document() again, this time as a thin
--  wrapper delegating to the new approve_document_with_evidence(), so that the
--  sign-once guard would "exist in exactly one place". It carried
--  `signed_at is null` across — with a comment saying "023 §6's guard,
--  preserved verbatim" — and it did NOT carry `voided_at is null` across.
--  Migration 036's guard, two migrations old, was silently reverted. Every
--  static check in the repository passed on it: both files are valid SQL, both
--  contain a sign-once guard, and no test called the function.
--
--  WHAT THAT MEANT IN PRODUCTION. approve_document() is granted to `anon` and
--  approve_document_with_evidence() is the primary signing path used by
--  app/p/[token]/actions.ts. Both funnel through the same UPDATE. So anyone
--  holding the public link to an estimate or invoice the business had VOIDED —
--  wrongly priced, job cancelled, replaced by a corrected document — could
--  still open that link and sign it. The row came back with
--  status = 'approved', signed_at stamped, the signature stored, and voided_at
--  still set: a document that is simultaneously void and signed-and-approved.
--  Verified by running it, as anon, against the real policies:
--  tests/rls-assertions-can-fail.test.mjs and db/ci/40_document_assertions.sql.
--
--  The trg_estimates_lock / trg_invoices_lock triggers from 036 do not cover
--  this. They guard the MONEY columns (customer_id, discount_minor,
--  tax_rate_bps, total_minor, issue_date, deposit_minor); signed_at,
--  signer_name, signature_data and status are not in that list, deliberately,
--  because signing a document is a legitimate update to a locked one.
--  The predicate inside approve_document was the only guard, and it was gone.
--
--  THE FIX. Restore `and voided_at is null` in approve_document_with_evidence,
--  which is where 038 chose to make the guard live. approve_document() already
--  delegates and needs no change, so the guard stays in exactly one place —
--  which was 038's correct intention.
--
--  Everything else in this function is byte-for-byte migration 038. Only the
--  two `and voided_at is null` lines are new.
-- =====================================================================

create or replace function public.approve_document_with_evidence(
  p_token uuid, p_name text, p_sig text,
  p_ip text default null, p_ip_source text default null, p_ip_trusted boolean default false,
  p_user_agent text default null, p_device text default null, p_sig_sha256 text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n int;
  kind text;
  doc_id uuid;
  org_id uuid;
  clean_name text := left(coalesce(nullif(trim(p_name), ''), 'Customer'), 120);
  clean_sig  text := left(coalesce(p_sig, ''), 400000);
  ip_value inet := public.safe_inet(p_ip);
  ua_value text := left(nullif(btrim(coalesce(p_user_agent, '')), ''), 400);
  capture_mode text := case when p_ip is not null or p_user_agent is not null then 'server' else 'none' end;
begin
  -- 023 §6's guard, preserved verbatim: sign once. Re-signing destroyed the
  -- original evidence and wrote ~800 KB of audit rows per call.
  -- 036 §11's guard, RESTORED here after 038 dropped it: a voided document is
  -- not a document anyone may sign.
  update public.estimates
     set status = case when status in ('draft','sent') then 'approved'::estimate_status else status end,
         signer_name = clean_name,
         signed_at = now(),
         signature_data = clean_sig,
         signature_ip = ip_value,
         signature_user_agent = ua_value
   where public_token = p_token and deleted_at is null
     and signed_at is null
     and voided_at is null
  returning id, organization_id into doc_id, org_id;
  get diagnostics n = row_count;
  if n > 0 then kind := 'estimate'; end if;

  if n = 0 then
    update public.invoices
       set signer_name = clean_name,
           signed_at = now(),
           signature_data = clean_sig,
           signature_ip = ip_value,
           signature_user_agent = ua_value
     where public_token = p_token and deleted_at is null
       and signed_at is null
       and voided_at is null
    returning id, organization_id into doc_id, org_id;
    get diagnostics n = row_count;
    if n > 0 then kind := 'invoice'; end if;
  end if;

  if n = 0 then return jsonb_build_object('ok', false); end if;

  insert into public.document_signature_events
    (organization_id, document_type, document_id, signer_name, signature_bytes, signature_sha256,
     capture, ip, ip_source, ip_trusted, user_agent, device_label)
  values (org_id, kind, doc_id, clean_name, length(clean_sig), left(nullif(btrim(coalesce(p_sig_sha256, '')), ''), 64),
          capture_mode, ip_value, left(nullif(btrim(coalesce(p_ip_source, '')), ''), 60),
          coalesce(p_ip_trusted, false), ua_value, left(nullif(btrim(coalesce(p_device, '')), ''), 80));

  return jsonb_build_object('ok', true, 'kind', kind, 'id', doc_id, 'capture', capture_mode);
end $$;

-- Grants unchanged from 038. Service role only: if the browser could call this
-- it could dictate its own IP address, and forged evidence is worse than none.
revoke all on function public.approve_document_with_evidence(uuid, text, text, text, text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.approve_document_with_evidence(uuid, text, text, text, text, boolean, text, text, text) to service_role;

comment on function public.approve_document_with_evidence(uuid, text, text, text, text, boolean, text, text, text) is
  'Sign a document once, from the server, with evidence. Refuses an already-signed document (023 §6) and a VOIDED one (036 §11, dropped by 038 and restored by 042). Do not remove either guard.';

-- =====================================================================
-- End migration 042.
-- =====================================================================
