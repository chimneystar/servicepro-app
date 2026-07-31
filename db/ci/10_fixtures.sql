-- =====================================================================
--  ServicePro — CI fixtures: two tenants and five identities
--
--  Runs as the superuser, so RLS is bypassed and these rows are pure setup,
--  never an assertion. Every id is a fixed literal so the assertion files can
--  be read and checked by eye without variable plumbing.
--
--    TENANT A  aaaa0000-…-0001        TENANT B  bbbb0000-…-0001
--      owner   aaaa0000-…-0002          owner   bbbb0000-…-0002
--      office  aaaa0000-…-0003
--      tech 1  aaaa0000-…-0004
--      tech 2  aaaa0000-…-0005
--
--  Impersonation in the assertion files is:
--      select set_config('request.jwt.claim.sub', '<user uuid>', false);
--      set role authenticated;
--  which is exactly the state a PostgREST request arrives in.
-- =====================================================================

set client_min_messages = notice;

-- Migration 013 relocates btree_gist into a new `extensions` schema. Nothing
-- below needs it, but make it reachable so a later migration that does cannot
-- fail for a reason unrelated to security.
do $$ begin execute 'grant usage on schema extensions to public'; exception when others then null; end $$;

-- ---------------------------------------------------------------------
-- Identities
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaa0000-0000-4000-8000-000000000002', 'owner-a@ci.test'),
  ('aaaa0000-0000-4000-8000-000000000003', 'office-a@ci.test'),
  ('aaaa0000-0000-4000-8000-000000000004', 'tech-a1@ci.test'),
  ('aaaa0000-0000-4000-8000-000000000005', 'tech-a2@ci.test'),
  ('aaaa0000-0000-4000-8000-00000000000e', 'invitee-forged@ci.test'),
  ('aaaa0000-0000-4000-8000-00000000000f', 'invitee-genuine@ci.test'),
  ('bbbb0000-0000-4000-8000-000000000002', 'owner-b@ci.test')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------
insert into public.organizations (id, name) values
  ('aaaa0000-0000-4000-8000-000000000001', 'CI Tenant A'),
  ('bbbb0000-0000-4000-8000-000000000001', 'CI Tenant B')
on conflict (id) do nothing;

-- commission_pct is seeded non-zero for the technicians so that "a tech cannot
-- change their own commission" has a value to fail to change.
insert into public.profiles (id, organization_id, full_name, role, commission_pct) values
  ('aaaa0000-0000-4000-8000-000000000002', 'aaaa0000-0000-4000-8000-000000000001', 'Owner A',  'owner',  0),
  ('aaaa0000-0000-4000-8000-000000000003', 'aaaa0000-0000-4000-8000-000000000001', 'Office A', 'office', 0),
  ('aaaa0000-0000-4000-8000-000000000004', 'aaaa0000-0000-4000-8000-000000000001', 'Tech A1',  'tech',  10),
  ('aaaa0000-0000-4000-8000-000000000005', 'aaaa0000-0000-4000-8000-000000000001', 'Tech A2',  'tech',  10),
  ('bbbb0000-0000-4000-8000-000000000002', 'bbbb0000-0000-4000-8000-000000000001', 'Owner B',  'owner',  0)
on conflict (id) do nothing;

-- NOTE: invitee-forged and invitee-genuine deliberately have NO profile row.
-- accept_invitation() short-circuits for anyone who already belongs to an org.

-- ---------------------------------------------------------------------
-- Business data, one matching set per tenant
-- ---------------------------------------------------------------------
insert into public.customers (id, organization_id, name, phone) values
  ('aaaa0000-0000-4000-8000-000000000006', 'aaaa0000-0000-4000-8000-000000000001', 'Customer A', '111'),
  ('bbbb0000-0000-4000-8000-000000000006', 'bbbb0000-0000-4000-8000-000000000001', 'Customer B', '222')
on conflict (id) do nothing;

-- JOB A is assigned to tech A1, which is what makes the technician-scoped
-- jobs_select / jobs_update policies reachable at all.
insert into public.jobs (id, organization_id, customer_id, assigned_to, service, scheduled_date) values
  ('aaaa0000-0000-4000-8000-000000000007', 'aaaa0000-0000-4000-8000-000000000001',
   'aaaa0000-0000-4000-8000-000000000006', 'aaaa0000-0000-4000-8000-000000000004', 'Service A', current_date),
  ('bbbb0000-0000-4000-8000-000000000007', 'bbbb0000-0000-4000-8000-000000000001',
   'bbbb0000-0000-4000-8000-000000000006', 'bbbb0000-0000-4000-8000-000000000002', 'Service B', current_date)
on conflict (id) do nothing;

insert into public.invoices (id, organization_id, number, customer_id, total_minor) values
  ('aaaa0000-0000-4000-8000-000000000008', 'aaaa0000-0000-4000-8000-000000000001', 900001,
   'aaaa0000-0000-4000-8000-000000000006', 10000),
  ('bbbb0000-0000-4000-8000-000000000008', 'bbbb0000-0000-4000-8000-000000000001', 900001,
   'bbbb0000-0000-4000-8000-000000000006', 20000)
on conflict (id) do nothing;

insert into public.payments (id, organization_id, invoice_id, amount_minor) values
  ('aaaa0000-0000-4000-8000-000000000009', 'aaaa0000-0000-4000-8000-000000000001',
   'aaaa0000-0000-4000-8000-000000000008', 10000),
  ('bbbb0000-0000-4000-8000-000000000009', 'bbbb0000-0000-4000-8000-000000000001',
   'bbbb0000-0000-4000-8000-000000000008', 20000)
on conflict (id) do nothing;

-- An unsigned estimate with a known public token, for the approve_document
-- sign-once assertions.
insert into public.estimates (id, organization_id, number, customer_id, status, total_minor, public_token) values
  ('aaaa0000-0000-4000-8000-00000000000a', 'aaaa0000-0000-4000-8000-000000000001', 900001,
   'aaaa0000-0000-4000-8000-000000000006', 'sent', 10000,
   'aaaa0000-0000-4000-8000-00000000000b')
on conflict (id) do nothing;

-- Two OPEN time entries on the same job, one per technician. Different
-- user_ids, so migration 023's uq_job_time_entries_one_open (job_id, user_id)
-- WHERE ended_at is null is satisfied by both.
insert into public.job_time_entries (id, organization_id, job_id, user_id, started_at, ended_at) values
  ('aaaa0000-0000-4000-8000-00000000000c', 'aaaa0000-0000-4000-8000-000000000001',
   'aaaa0000-0000-4000-8000-000000000007', 'aaaa0000-0000-4000-8000-000000000004', now() - interval '2 hours', null),
  ('aaaa0000-0000-4000-8000-00000000000d', 'aaaa0000-0000-4000-8000-000000000001',
   'aaaa0000-0000-4000-8000-000000000007', 'aaaa0000-0000-4000-8000-000000000005', now() - interval '2 hours', null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Fixtures must actually exist, or every "forbidden" assertion below would
-- pass vacuously against an empty table.
-- ---------------------------------------------------------------------
select ci.assert((select count(*) from public.profiles
                   where organization_id in ('aaaa0000-0000-4000-8000-000000000001',
                                             'bbbb0000-0000-4000-8000-000000000001')) = 5,
                 'fixture: 5 profiles across 2 tenants');
select ci.assert((select count(*) from public.customers
                   where id in ('aaaa0000-0000-4000-8000-000000000006',
                                'bbbb0000-0000-4000-8000-000000000006')) = 2,
                 'fixture: 2 customers, one per tenant');
select ci.assert((select count(*) from public.jobs
                   where id in ('aaaa0000-0000-4000-8000-000000000007',
                                'bbbb0000-0000-4000-8000-000000000007')) = 2,
                 'fixture: 2 jobs, one per tenant');
select ci.assert((select count(*) from public.invoices
                   where id in ('aaaa0000-0000-4000-8000-000000000008',
                                'bbbb0000-0000-4000-8000-000000000008')) = 2,
                 'fixture: 2 invoices, one per tenant');
select ci.assert((select count(*) from public.payments
                   where id in ('aaaa0000-0000-4000-8000-000000000009',
                                'bbbb0000-0000-4000-8000-000000000009')) = 2,
                 'fixture: 2 payments, one per tenant');
select ci.assert((select count(*) from public.job_time_entries
                   where id in ('aaaa0000-0000-4000-8000-00000000000c',
                                'aaaa0000-0000-4000-8000-00000000000d')) = 2,
                 'fixture: 2 open time entries, one per technician');
select ci.assert((select signed_at is null from public.estimates
                   where id = 'aaaa0000-0000-4000-8000-00000000000a'),
                 'fixture: estimate starts unsigned');

-- ---------------------------------------------------------------------
-- The harness itself must work. If impersonation silently did nothing, every
-- test below would run as the superuser, RLS would be bypassed, and the whole
-- suite would be theatre.
-- ---------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'aaaa0000-0000-4000-8000-000000000004', false);
set role authenticated;

select ci.assert(auth.uid() = 'aaaa0000-0000-4000-8000-000000000004',
                 'harness: auth.uid() returns the impersonated user');
select ci.assert(public.current_org_id() = 'aaaa0000-0000-4000-8000-000000000001',
                 'harness: current_org_id() resolves from the impersonated profile');
select ci.assert(public.current_user_role()::text = 'tech',
                 'harness: current_user_role() resolves from the impersonated profile');
select ci.assert(current_user = 'authenticated',
                 'harness: statements run as the authenticated role, so RLS applies');
-- The single most important check in this file: if impersonation silently did
-- not take effect, this select would return tenant B's organisation and every
-- "cannot" assertion downstream would be meaningless.
select ci.assert((select count(*) from public.organizations
                   where id = 'bbbb0000-0000-4000-8000-000000000001') = 0,
                 'harness: RLS is ENFORCED for the impersonated role (tenant B is invisible)');
select ci.assert((select count(*) from public.organizations
                   where id = 'aaaa0000-0000-4000-8000-000000000001') = 1,
                 'harness: the impersonated role can see its own tenant');

reset role;
select set_config('request.jwt.claim.sub', '', false);

do $$ begin raise notice 'fixtures loaded'; end $$;
