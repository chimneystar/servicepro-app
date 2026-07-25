-- =====================================================================
--  ServicePro — Migration 008 (v10 batch)
--  Run once in the Supabase SQL Editor, AFTER 007.
--
--  Adds:
--    1. Line items: title, description*, taxable flag, item photo
--    2. Item library (price_book): description, taxable, reuse fields
--    3. Payments: reference (check #, Zelle #, transfer #)
--    4. Organizations: document customization (accent color, per-type
--       terms, footer)
--    5. Legacy archive flags (imported old records kept separate)
--    6. Rebuilt public_document() so shared docs show titles, photos,
--       per-item tax and your custom branding.
--
--  Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Line items — title + taxable + photo (description already exists)
-- ---------------------------------------------------------------------
alter table public.estimate_items add column if not exists title      text;
alter table public.estimate_items add column if not exists taxable    boolean not null default true;
alter table public.estimate_items add column if not exists image_path text;
alter table public.invoice_items  add column if not exists title      text;
alter table public.invoice_items  add column if not exists taxable    boolean not null default true;
alter table public.invoice_items  add column if not exists image_path text;
alter table public.job_items      add column if not exists title      text;
alter table public.job_items      add column if not exists taxable    boolean not null default true;
alter table public.job_items      add column if not exists image_path text;

-- ---------------------------------------------------------------------
-- 2. Item library (reusable catalog)
-- ---------------------------------------------------------------------
alter table public.price_book add column if not exists description text;
alter table public.price_book add column if not exists taxable     boolean not null default true;
alter table public.price_book add column if not exists cost_minor  bigint not null default 0;
alter table public.price_book add column if not exists image_path  text;

-- ---------------------------------------------------------------------
-- 3. Payments — structured reference for non-card methods
-- ---------------------------------------------------------------------
alter table public.payments add column if not exists reference text;

-- ---------------------------------------------------------------------
-- 4. Organizations — document customization
-- ---------------------------------------------------------------------
alter table public.organizations add column if not exists accent_color    text not null default '#2563eb';
alter table public.organizations add column if not exists estimate_terms  text;
alter table public.organizations add column if not exists invoice_terms   text;
alter table public.organizations add column if not exists document_footer text;

-- ---------------------------------------------------------------------
-- 5. Legacy archive flags — imported old data stays separate
-- ---------------------------------------------------------------------
alter table public.customers add column if not exists archived   boolean not null default false;
alter table public.customers add column if not exists legacy_note text;
alter table public.estimates add column if not exists archived   boolean not null default false;
alter table public.invoices  add column if not exists archived   boolean not null default false;
create index if not exists idx_customers_archived on public.customers(organization_id, archived) where deleted_at is null;

-- ---------------------------------------------------------------------
-- 6. Rebuild public_document() with the new fields + branding
-- ---------------------------------------------------------------------
create or replace function public.public_document(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d record; kind text; org record; cust record; itms jsonb; terms text;
begin
  select * into d from public.estimates where public_token = p_token and deleted_at is null;
  if found then kind := 'estimate';
  else
    select * into d from public.invoices where public_token = p_token and deleted_at is null;
    if found then kind := 'invoice'; else return null; end if;
  end if;

  select * into org from public.organizations where id = d.organization_id;
  select name, phone, email, address, city, billing_address, billing_city
    into cust from public.customers where id = d.customer_id;

  if kind = 'estimate' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'title', title, 'description', description, 'qty_milli', qty_milli,
        'unit_price_minor', unit_price_minor, 'taxable', taxable, 'image_path', image_path) order by sort), '[]'::jsonb)
      into itms from public.estimate_items where estimate_id = d.id;
    terms := coalesce(org.estimate_terms, org.terms);
  else
    select coalesce(jsonb_agg(jsonb_build_object(
        'title', title, 'description', description, 'qty_milli', qty_milli,
        'unit_price_minor', unit_price_minor, 'taxable', taxable, 'image_path', image_path) order by sort), '[]'::jsonb)
      into itms from public.invoice_items where invoice_id = d.id;
    terms := coalesce(org.invoice_terms, org.terms);
  end if;

  return jsonb_build_object(
    'kind', kind, 'number', d.number, 'status', d.status, 'issue_date', d.issue_date,
    'notes', d.notes, 'discount_minor', d.discount_minor, 'tax_rate_bps', d.tax_rate_bps,
    'total_minor', d.total_minor, 'signer_name', d.signer_name, 'signed_at', d.signed_at,
    'currency', org.currency, 'tax_label', org.tax_label,
    'customer', jsonb_build_object('name', cust.name, 'phone', cust.phone, 'email', cust.email,
                                   'address', cust.address, 'city', cust.city,
                                   'billing_address', cust.billing_address, 'billing_city', cust.billing_city),
    'org', jsonb_build_object('name', org.name, 'tagline', org.tagline, 'logo_url', org.logo_url,
                              'address', org.address, 'city', org.city, 'phone', org.phone, 'email', org.email,
                              'accent_color', org.accent_color, 'terms', terms, 'footer', org.document_footer),
    'items', itms
  );
end $$;
grant execute on function public.public_document(uuid) to anon, authenticated;

-- =====================================================================
-- End migration 008 (v10).
-- =====================================================================
