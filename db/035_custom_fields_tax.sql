-- =====================================================================
--  ServicePro — Migration 035 (custom fields + jurisdictional tax)
--  Run once in the Supabase SQL Editor, AFTER 034. Safe to re-run.
--
--  Ledger 5.10 and 5.16. Both are tables that exist with nothing behind them.
--
--  5.10 — CUSTOM FIELDS. `custom_field_definitions` and `custom_field_values`
--  were created by migration 019 and have never been referenced by a single
--  line of application code. This migration does not create them; it closes the
--  hole that would have opened the moment anything did write to them:
--  `custom_field_values.entity_id` is polymorphic with NO foreign key and NO
--  organisation guard (audit finding F21), so it can point at any row in the
--  database — another tenant's customer, a payment, anything. 019's
--  `custom_values_definition_org_guard` only checks the DEFINITION. Nothing has
--  ever checked the ENTITY, and nothing has ever checked that a "customer"
--  definition is not hanging off a job.
--
--  5.16 — JURISDICTIONAL TAX. `tax_jurisdictions` and `customer_tax_exemptions`
--  are display-only: every document is priced with the single flat
--  `organizations.tax_rate_bps`. Two things are needed to change that safely:
--
--    (a) An OPT-IN switch. Turning jurisdictional tax on for every existing
--        business the day this deploys would silently change the tax on every
--        new document. `organizations.tax_mode` defaults to 'flat', which is
--        exactly today's behaviour, and an owner opts in on /finance.
--
--    (b) A way for the person writing the estimate to READ the rates.
--        Migration 022 restricted `tax_jurisdictions` and
--        `customer_tax_exemptions` to members with `payments.manage`. An office
--        user with `estimates.manage` and no finance access would have read an
--        EMPTY jurisdiction list and priced the document at 0% tax without any
--        error — a silent undercharge. `document_tax_context()` is a security
--        definer function that returns only what pricing needs: the rates, the
--        effective dates, and whether an exemption is live. It never returns a
--        certificate number or a document URL, and it is scoped to
--        `current_org_id()`, so it cannot be aimed at another tenant.
--
--  The arithmetic is NOT in here. Rates are combined and applied by
--  `lib/core/money.mjs`, which is integer-exact and unit-tested.
--
--  Nothing in this migration drops a table, a column or a policy.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Custom fields: the entity reference must resolve, match, and belong.
-- ---------------------------------------------------------------------
create or replace function public.assert_custom_field_entity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  def_entity_type text;
  def_org         uuid;
  entity_org      uuid;
begin
  select d.entity_type, d.organization_id
    into def_entity_type, def_org
    from public.custom_field_definitions d
   where d.id = new.definition_id;

  if def_entity_type is null then
    raise exception 'custom field value references a definition that does not exist'
      using errcode = 'foreign_key_violation';
  end if;

  if def_org is distinct from new.organization_id then
    raise exception 'cross-tenant reference blocked: custom_field_values.definition_id'
      using errcode = 'check_violation';
  end if;

  -- A "customer" definition must not be hanging off a job, and vice versa.
  if def_entity_type <> new.entity_type then
    raise exception 'custom field entity_type % does not match its definition (%)',
      new.entity_type, def_entity_type using errcode = 'check_violation';
  end if;

  if new.entity_type = 'customer' then
    select c.organization_id into entity_org from public.customers c where c.id = new.entity_id;
  elsif new.entity_type = 'job' then
    select j.organization_id into entity_org from public.jobs j where j.id = new.entity_id;
  else
    raise exception 'unsupported custom field entity_type: %', new.entity_type
      using errcode = 'check_violation';
  end if;

  -- Audit F21: entity_id had no foreign key, so it accepted any uuid at all.
  if entity_org is null then
    raise exception 'custom field value points at a % that does not exist', new.entity_type
      using errcode = 'foreign_key_violation';
  end if;

  if entity_org <> new.organization_id then
    raise exception 'cross-tenant reference blocked: custom_field_values.entity_id -> %', new.entity_type
      using errcode = 'check_violation';
  end if;

  return new;
end $$;
revoke execute on function public.assert_custom_field_entity() from public, anon, authenticated;

drop trigger if exists custom_field_values_entity_guard on public.custom_field_values;
create trigger custom_field_values_entity_guard
before insert or update on public.custom_field_values
for each row execute function public.assert_custom_field_entity();

-- Reading every field on one customer/job, and listing the definitions to show.
create index if not exists idx_custom_field_values_entity
  on public.custom_field_values (organization_id, entity_type, entity_id);
create index if not exists idx_custom_field_definitions_lookup
  on public.custom_field_definitions (organization_id, entity_type, active, sort);

-- ---------------------------------------------------------------------
-- 2. Tax: opt in to jurisdictions. 'flat' is the behaviour every existing
--    organisation already has, so this column changes nothing by itself.
-- ---------------------------------------------------------------------
alter table public.organizations
  add column if not exists tax_mode text not null default 'flat';

do $$ begin
  alter table public.organizations
    add constraint organizations_tax_mode_check check (tax_mode in ('flat','jurisdictions'));
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_tax_jurisdictions_window
  on public.tax_jurisdictions (organization_id, active, effective_from, effective_to);
create index if not exists idx_tax_exemptions_customer
  on public.customer_tax_exemptions (organization_id, customer_id, active);

-- ---------------------------------------------------------------------
-- 3. document_tax_context(customer) — the pricing inputs, and only those.
--
--    Security definer because migration 022 gated `tax_jurisdictions` and
--    `customer_tax_exemptions` behind `payments.manage`, which the person
--    writing an estimate need not have. Without this, that person would price
--    at 0% tax and nothing would say so. What comes back is rates, effective
--    dates and a validity window — never a certificate number, a document URL,
--    a reason or a verifier.
-- ---------------------------------------------------------------------
create or replace function public.document_tax_context(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  org          uuid := public.current_org_id();
  v_tax_mode   text;
  v_rate_bps   integer;
  v_rules      jsonb;
  v_exemptions jsonb;
  v_customer   boolean;
begin
  if org is null then
    raise exception 'no organization in context' using errcode = 'insufficient_privilege';
  end if;

  select o.tax_mode, o.tax_rate_bps
    into v_tax_mode, v_rate_bps
    from public.organizations o
   where o.id = org;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', j.id, 'name', j.name, 'rate_bps', j.rate_bps, 'applies_to', j.applies_to,
           'active', j.active, 'effective_from', j.effective_from, 'effective_to', j.effective_to
         ) order by j.rate_bps desc), '[]'::jsonb)
    into v_rules
    from public.tax_jurisdictions j
   where j.organization_id = org;

  select exists (
    select 1 from public.customers c where c.id = p_customer and c.organization_id = org
  ) into v_customer;

  if v_customer then
    select coalesce(jsonb_agg(jsonb_build_object('active', e.active, 'expires_on', e.expires_on)), '[]'::jsonb)
      into v_exemptions
      from public.customer_tax_exemptions e
     where e.organization_id = org and e.customer_id = p_customer;
  else
    v_exemptions := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'tax_mode',      coalesce(v_tax_mode, 'flat'),
    'tax_rate_bps',  coalesce(v_rate_bps, 0),
    'customer_found', coalesce(v_customer, false),
    'jurisdictions', coalesce(v_rules, '[]'::jsonb),
    'exemptions',    coalesce(v_exemptions, '[]'::jsonb)
  );
end $$;
revoke execute on function public.document_tax_context(uuid) from public, anon;
grant  execute on function public.document_tax_context(uuid) to authenticated, service_role;

-- =====================================================================
-- End migration 035.
-- =====================================================================
