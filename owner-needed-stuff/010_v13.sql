-- =====================================================================
--  ServicePro — Migration 010 (v13 batch: portal, texting, inventory)
--  Run once in the Supabase SQL Editor, AFTER 009. Safe to re-run.
--
--  Adds:
--    1. Customer portal (magic-link) token + read-only portal function
--    2. Inventory / materials tracking
--    3. Two-way SMS: direction + from_phone on the message log
--    4. deposit_minor exposed on shared estimates (deposit feature)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Customer portal magic-link token
-- ---------------------------------------------------------------------
alter table public.customers add column if not exists portal_token uuid not null default gen_random_uuid();
do $$ begin
  alter table public.customers add constraint customers_portal_token_key unique (portal_token);
exception when duplicate_table then null; when duplicate_object then null; end $$;

-- Read-only portal payload for a customer (anon, via opaque token).
create or replace function public.public_customer_portal(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cust record; org record; ests jsonb; invs jsonb; jbs jsonb;
begin
  select * into cust from public.customers where portal_token = p_token and deleted_at is null;
  if not found then return null; end if;
  select name, tagline, logo_url, accent_color, phone, email, currency into org from public.organizations where id = cust.organization_id;

  select coalesce(jsonb_agg(jsonb_build_object('number', number, 'status', status, 'total_minor', total_minor,
    'issue_date', issue_date, 'token', public_token) order by number desc), '[]'::jsonb)
    into ests from public.estimates where customer_id = cust.id and deleted_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('number', number, 'status', status, 'total_minor', total_minor,
    'issue_date', issue_date, 'token', public_token) order by number desc), '[]'::jsonb)
    into invs from public.invoices where customer_id = cust.id and deleted_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('service', service, 'status', status, 'date', scheduled_date) order by scheduled_date desc), '[]'::jsonb)
    into jbs from public.jobs where customer_id = cust.id and deleted_at is null;

  return jsonb_build_object(
    'customer', jsonb_build_object('name', cust.name, 'phone', cust.phone, 'email', cust.email),
    'org', jsonb_build_object('name', org.name, 'tagline', org.tagline, 'logo_url', org.logo_url,
                              'accent_color', org.accent_color, 'phone', org.phone, 'email', org.email, 'currency', org.currency),
    'estimates', ests, 'invoices', invs, 'jobs', jbs
  );
end $$;
grant execute on function public.public_customer_portal(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Inventory / materials
-- ---------------------------------------------------------------------
create table if not exists public.inventory_items (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  name                 text not null,
  sku                  text,
  unit                 text default 'unit',
  quantity             integer not null default 0,
  low_stock_threshold  integer not null default 0,
  cost_minor           bigint not null default 0 check (cost_minor >= 0),
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_inventory_org on public.inventory_items(organization_id);

alter table public.inventory_items enable row level security;
drop policy if exists inventory_select on public.inventory_items;
create policy inventory_select on public.inventory_items for select
  using (organization_id = public.current_org_id());
drop policy if exists inventory_write on public.inventory_items;
create policy inventory_write on public.inventory_items for all
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))
  with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));

-- ---------------------------------------------------------------------
-- 3. Two-way SMS: message direction + sender
-- ---------------------------------------------------------------------
alter table public.sms_messages add column if not exists direction  text not null default 'outbound' check (direction in ('inbound','outbound'));
alter table public.sms_messages add column if not exists from_phone text;

-- ---------------------------------------------------------------------
-- 4. Expose the estimate deposit on the shared document
-- ---------------------------------------------------------------------
create or replace function public.public_document(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d record; kind text; org record; cust record; itms jsonb; terms text; dep bigint;
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
    dep := coalesce(d.deposit_minor, 0);
  else
    select coalesce(jsonb_agg(jsonb_build_object(
        'title', title, 'description', description, 'qty_milli', qty_milli,
        'unit_price_minor', unit_price_minor, 'taxable', taxable, 'image_path', image_path) order by sort), '[]'::jsonb)
      into itms from public.invoice_items where invoice_id = d.id;
    terms := coalesce(org.invoice_terms, org.terms);
    dep := 0;
  end if;

  return jsonb_build_object(
    'kind', kind, 'number', d.number, 'status', d.status, 'issue_date', d.issue_date,
    'notes', d.notes, 'discount_minor', d.discount_minor, 'tax_rate_bps', d.tax_rate_bps,
    'total_minor', d.total_minor, 'deposit_minor', dep, 'signer_name', d.signer_name, 'signed_at', d.signed_at,
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
-- End migration 010 (v13).
-- =====================================================================
