-- =====================================================================
--  ServicePro — Migration 004 (client share + e-signature approval)
--  Run once in the Supabase SQL Editor, after 003.
--
--  Adds a public share token + signature fields to estimates & invoices,
--  and two SECURITY DEFINER functions the (logged-out) customer uses via a
--  public link: read the document, and approve/sign it. No customer login.
-- =====================================================================

alter table public.estimates add column if not exists public_token uuid not null default gen_random_uuid();
alter table public.estimates add column if not exists signer_name text;
alter table public.estimates add column if not exists signed_at timestamptz;
alter table public.estimates add column if not exists signature_data text;

alter table public.invoices  add column if not exists public_token uuid not null default gen_random_uuid();
alter table public.invoices  add column if not exists signer_name text;
alter table public.invoices  add column if not exists signed_at timestamptz;
alter table public.invoices  add column if not exists signature_data text;

do $$ begin
  alter table public.estimates add constraint estimates_public_token_key unique (public_token);
exception when duplicate_table then null; when duplicate_object then null; end $$;
do $$ begin
  alter table public.invoices add constraint invoices_public_token_key unique (public_token);
exception when duplicate_table then null; when duplicate_object then null; end $$;

-- Read one document by its public token (customer-facing). Bypasses RLS on
-- purpose but only ever returns the single row matching the opaque token.
create or replace function public.public_document(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d record; kind text; org record; cust_name text; itms jsonb;
begin
  select * into d from public.estimates where public_token = p_token and deleted_at is null;
  if found then kind := 'estimate';
  else
    select * into d from public.invoices where public_token = p_token and deleted_at is null;
    if found then kind := 'invoice'; else return null; end if;
  end if;

  select * into org from public.organizations where id = d.organization_id;
  select name into cust_name from public.customers where id = d.customer_id;

  if kind = 'estimate' then
    select coalesce(jsonb_agg(jsonb_build_object('description', description, 'qty_milli', qty_milli, 'unit_price_minor', unit_price_minor) order by sort), '[]'::jsonb)
      into itms from public.estimate_items where estimate_id = d.id;
  else
    select coalesce(jsonb_agg(jsonb_build_object('description', description, 'qty_milli', qty_milli, 'unit_price_minor', unit_price_minor) order by sort), '[]'::jsonb)
      into itms from public.invoice_items where invoice_id = d.id;
  end if;

  return jsonb_build_object(
    'kind', kind, 'number', d.number, 'status', d.status, 'issue_date', d.issue_date,
    'notes', d.notes, 'discount_minor', d.discount_minor, 'tax_rate_bps', d.tax_rate_bps,
    'total_minor', d.total_minor, 'signer_name', d.signer_name, 'signed_at', d.signed_at,
    'currency', org.currency, 'tax_label', org.tax_label,
    'customer', jsonb_build_object('name', cust_name),
    'org', jsonb_build_object('name', org.name, 'tagline', org.tagline, 'logo_url', org.logo_url,
                              'address', org.address, 'city', org.city, 'phone', org.phone, 'email', org.email, 'terms', org.terms),
    'items', itms
  );
end $$;
grant execute on function public.public_document(uuid) to anon, authenticated;

-- Approve + sign a document via its public token.
create or replace function public.approve_document(p_token uuid, p_name text, p_sig text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.estimates
     set status = case when status in ('draft','sent') then 'approved'::estimate_status else status end,
         signer_name = left(coalesce(nullif(trim(p_name), ''), 'Customer'), 120),
         signed_at = now(), signature_data = left(coalesce(p_sig, ''), 400000)
   where public_token = p_token and deleted_at is null;
  get diagnostics n = row_count;
  if n > 0 then return true; end if;

  update public.invoices
     set signer_name = left(coalesce(nullif(trim(p_name), ''), 'Customer'), 120),
         signed_at = now(), signature_data = left(coalesce(p_sig, ''), 400000)
   where public_token = p_token and deleted_at is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;
grant execute on function public.approve_document(uuid, text, text) to anon, authenticated;

-- =====================================================================
-- End migration 004.
-- =====================================================================
