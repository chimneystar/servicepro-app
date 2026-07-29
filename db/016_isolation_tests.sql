-- =====================================================================
--  ServicePro — Cross-tenant isolation TEST (run AFTER 014)
--  Run this in the Supabase SQL Editor to PROVE two businesses can never
--  be linked. It creates two throwaway orgs, asserts every cross-tenant
--  write is rejected, then deletes its own test data.
--
--  Success  -> you see:  NOTICE:  ✔ ALL ISOLATION TESTS PASSED
--  Failure  -> it raises: ISOLATION FAIL: ...
-- =====================================================================
do $$
declare orgA uuid; orgB uuid; custA uuid; custB uuid; jobA uuid; invA uuid;
begin
  insert into public.organizations(name) values ('__ISO_TEST_A__') returning id into orgA;
  insert into public.organizations(name) values ('__ISO_TEST_B__') returning id into orgB;
  insert into public.customers(organization_id, name, phone) values (orgA, 'Cust A', '111') returning id into custA;
  insert into public.customers(organization_id, name, phone) values (orgB, 'Cust B', '222') returning id into custB;

  -- 1. Composite FK: a job in Org A referencing Org B's customer must FAIL.
  begin
    insert into public.jobs(organization_id, customer_id, service, scheduled_date) values (orgA, custB, 'x', current_date);
    raise exception 'ISOLATION FAIL: cross-tenant JOB insert was allowed';
  exception when foreign_key_violation then null; end;

  -- 2. Composite FK: an invoice in Org A referencing Org B's customer must FAIL.
  begin
    insert into public.invoices(organization_id, number, customer_id, total_minor) values (orgA, 999999, custB, 100);
    raise exception 'ISOLATION FAIL: cross-tenant INVOICE insert was allowed';
  exception when foreign_key_violation then null; end;

  -- 3. Trigger: a message in Org A referencing Org B's customer must FAIL.
  begin
    insert into public.messages(organization_id, customer_id, type, body) values (orgA, custB, 'manual', 'x');
    raise exception 'ISOLATION FAIL: cross-tenant MESSAGE insert was allowed';
  exception when check_violation then null; end;

  -- 4. Same-org writes MUST succeed.
  insert into public.jobs(organization_id, customer_id, service, scheduled_date) values (orgA, custA, 'ok', current_date) returning id into jobA;
  insert into public.invoices(organization_id, number, customer_id, total_minor) values (orgA, 999998, custA, 100) returning id into invA;

  -- 5. Trigger: payment in Org B referencing Org A's invoice must FAIL.
  begin
    insert into public.payments(organization_id, invoice_id, amount_minor) values (orgB, invA, 100);
    raise exception 'ISOLATION FAIL: cross-tenant PAYMENT insert was allowed';
  exception when check_violation then null; end;

  -- Clean up all test rows (children first).
  delete from public.payments where organization_id in (orgA, orgB);
  delete from public.invoices where organization_id in (orgA, orgB);
  delete from public.jobs      where organization_id in (orgA, orgB);
  delete from public.customers where organization_id in (orgA, orgB);
  delete from public.organizations where id in (orgA, orgB);

  raise notice '✔ ALL ISOLATION TESTS PASSED (test data removed)';
end $$;
