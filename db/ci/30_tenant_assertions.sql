-- =====================================================================
--  ServicePro — CI assertions: tenant isolation and timesheet privacy
--
--  db/016_isolation_tests.sql proves the FOREIGN KEYS and org-guard triggers
--  reject cross-tenant references. It runs as the superuser, so it says nothing
--  about RLS. This file is the other half: it proves the POLICIES refuse a
--  logged-in user of tenant A who reaches for tenant B's rows.
--
--  Tenant A's OWNER is used for the cross-tenant attempts on purpose — the
--  most privileged identity inside a tenant. If the owner cannot cross the
--  boundary, nobody below them can.
--
--  Every assertion proves both directions: the cross-tenant action is refused
--  AND the identical same-tenant action still succeeds.
-- =====================================================================

set client_min_messages = notice;
begin;

-- =====================================================================
--  Tenant A owner vs tenant B data
-- =====================================================================
select set_config('request.jwt.claim.sub', 'aaaa0000-0000-4000-8000-000000000002', false);
set role authenticated;

-- ---------- READ ----------
select ci.assert((select count(*) from public.customers
                   where id = 'bbbb0000-0000-4000-8000-000000000006') = 0,
                 'tenant A CANNOT read tenant B customers');
select ci.assert((select count(*) from public.customers
                   where id = 'aaaa0000-0000-4000-8000-000000000006') = 1,
                 'tenant A CAN read its own customers');

select ci.assert((select count(*) from public.jobs
                   where id = 'bbbb0000-0000-4000-8000-000000000007') = 0,
                 'tenant A CANNOT read tenant B jobs');
select ci.assert((select count(*) from public.jobs
                   where id = 'aaaa0000-0000-4000-8000-000000000007') = 1,
                 'tenant A CAN read its own jobs');

select ci.assert((select count(*) from public.invoices
                   where id = 'bbbb0000-0000-4000-8000-000000000008') = 0,
                 'tenant A CANNOT read tenant B invoices');
select ci.assert((select count(*) from public.invoices
                   where id = 'aaaa0000-0000-4000-8000-000000000008') = 1,
                 'tenant A CAN read its own invoices');

select ci.assert((select count(*) from public.payments
                   where id = 'bbbb0000-0000-4000-8000-000000000009') = 0,
                 'tenant A CANNOT read tenant B payments');
select ci.assert((select count(*) from public.payments
                   where id = 'aaaa0000-0000-4000-8000-000000000009') = 1,
                 'tenant A CAN read its own payments');

-- ---------- WRITE (update) ----------
select ci.assert(
  ci.attempt($q$update public.customers set name = 'PWNED'
              where id = 'bbbb0000-0000-4000-8000-000000000006'$q$) <= 0,
  'tenant A CANNOT update tenant B customers');
select ci.assert(
  ci.attempt($q$update public.customers set name = 'Customer A (edited)'
              where id = 'aaaa0000-0000-4000-8000-000000000006'$q$) = 1,
  'tenant A CAN update its own customers');

select ci.assert(
  ci.attempt($q$update public.jobs set service = 'PWNED'
              where id = 'bbbb0000-0000-4000-8000-000000000007'$q$) <= 0,
  'tenant A CANNOT update tenant B jobs');
select ci.assert(
  ci.attempt($q$update public.jobs set service = 'Service A (edited)'
              where id = 'aaaa0000-0000-4000-8000-000000000007'$q$) = 1,
  'tenant A CAN update its own jobs');

select ci.assert(
  ci.attempt($q$update public.invoices set total_minor = 1
              where id = 'bbbb0000-0000-4000-8000-000000000008'$q$) <= 0,
  'tenant A CANNOT update tenant B invoices');
select ci.assert(
  ci.attempt($q$update public.invoices set total_minor = 11000
              where id = 'aaaa0000-0000-4000-8000-000000000008'$q$) = 1,
  'tenant A CAN update its own invoices');

select ci.assert(
  ci.attempt($q$update public.payments set amount_minor = 1
              where id = 'bbbb0000-0000-4000-8000-000000000009'$q$) <= 0,
  'tenant A CANNOT update tenant B payments');
select ci.assert(
  ci.attempt($q$update public.payments set amount_minor = 10500
              where id = 'aaaa0000-0000-4000-8000-000000000009'$q$) = 1,
  'tenant A CAN update its own payments');

-- ---------- WRITE (insert into the other tenant) ----------
select ci.assert(
  ci.attempt($q$insert into public.customers (organization_id, name, phone)
              values ('bbbb0000-0000-4000-8000-000000000001', 'Planted', '999')$q$) <= 0,
  'tenant A CANNOT insert a customer into tenant B');
select ci.assert(
  ci.attempt($q$insert into public.customers (organization_id, name, phone)
              values ('aaaa0000-0000-4000-8000-000000000001', 'Legitimate', '333')$q$) = 1,
  'tenant A CAN insert a customer into its own tenant');

select ci.assert(
  ci.attempt($q$insert into public.invoices (organization_id, number, customer_id, total_minor)
              values ('bbbb0000-0000-4000-8000-000000000001', 900002,
                      'bbbb0000-0000-4000-8000-000000000006', 500)$q$) <= 0,
  'tenant A CANNOT insert an invoice into tenant B');
select ci.assert(
  ci.attempt($q$insert into public.invoices (organization_id, number, customer_id, total_minor)
              values ('aaaa0000-0000-4000-8000-000000000001', 900002,
                      'aaaa0000-0000-4000-8000-000000000006', 500)$q$) = 1,
  'tenant A CAN insert an invoice into its own tenant');

-- ---------- Tenant B is byte-for-byte untouched ----------
reset role;
select ci.assert(
  (select name from public.customers where id = 'bbbb0000-0000-4000-8000-000000000006') = 'Customer B',
  'tenant B customer name survived every attempt');
select ci.assert(
  (select service from public.jobs where id = 'bbbb0000-0000-4000-8000-000000000007') = 'Service B',
  'tenant B job survived every attempt');
select ci.assert(
  (select total_minor from public.invoices where id = 'bbbb0000-0000-4000-8000-000000000008') = 20000,
  'tenant B invoice total survived every attempt');
select ci.assert(
  (select amount_minor from public.payments where id = 'bbbb0000-0000-4000-8000-000000000009') = 20000,
  'tenant B payment amount survived every attempt');
select ci.assert(
  (select count(*) from public.customers
     where organization_id = 'bbbb0000-0000-4000-8000-000000000001') = 1,
  'nothing was planted in tenant B');

-- ---------- The mirror image, so this is not a one-way accident ----------
select set_config('request.jwt.claim.sub', 'bbbb0000-0000-4000-8000-000000000002', false);
set role authenticated;

select ci.assert((select count(*) from public.customers
                   where id = 'aaaa0000-0000-4000-8000-000000000006') = 0,
                 'tenant B CANNOT read tenant A customers');
select ci.assert((select count(*) from public.customers
                   where id = 'bbbb0000-0000-4000-8000-000000000006') = 1,
                 'tenant B CAN read its own customers');
select ci.assert(
  ci.attempt($q$update public.invoices set total_minor = 1
              where id = 'aaaa0000-0000-4000-8000-000000000008'$q$) <= 0,
  'tenant B CANNOT update tenant A invoices');


-- =====================================================================
--  Timesheet privacy — audit §2.20: "techs can rewrite colleagues'
--  timesheets". Migration 023 §4 narrows job_time_entries to owner/office or
--  user_id = auth.uid().
-- =====================================================================
reset role;
select set_config('request.jwt.claim.sub', 'aaaa0000-0000-4000-8000-000000000004', false);
set role authenticated;

select ci.assert(
  (select count(*) from public.job_time_entries
     where id = 'aaaa0000-0000-4000-8000-00000000000d') = 0,
  'tech CANNOT read another technician job_time_entries row');
select ci.assert(
  (select count(*) from public.job_time_entries
     where id = 'aaaa0000-0000-4000-8000-00000000000c') = 1,
  'tech CAN read their own job_time_entries row');

select ci.assert(
  ci.attempt($q$update public.job_time_entries set ended_at = now()
              where id = 'aaaa0000-0000-4000-8000-00000000000d'$q$) <= 0,
  'tech CANNOT close another technician time entry');
select ci.assert(
  ci.attempt($q$update public.job_time_entries set ended_at = now()
              where id = 'aaaa0000-0000-4000-8000-00000000000c'$q$) = 1,
  'tech CAN close their own time entry');

-- A CLOSED entry on purpose: migration 023 also adds a unique index over
-- (job_id, user_id) WHERE ended_at is null, and an open forged row would trip
-- that index instead of the policy — turning a security assertion into a
-- constraint accident. Backdating a colleague's completed hours is the more
-- realistic fraud anyway.
select ci.assert(
  ci.attempt($q$insert into public.job_time_entries
                (organization_id, job_id, user_id, started_at, ended_at)
              values ('aaaa0000-0000-4000-8000-000000000001',
                      'aaaa0000-0000-4000-8000-000000000007',
                      'aaaa0000-0000-4000-8000-000000000005',
                      now() - interval '9 hours', now() - interval '1 hour')$q$) <= 0,
  'tech CANNOT forge a time entry in a colleague name');

reset role;
select ci.assert(
  (select ended_at is null from public.job_time_entries
     where id = 'aaaa0000-0000-4000-8000-00000000000d'),
  'the colleague time entry is still open');
select ci.assert(
  (select count(*) from public.job_time_entries
     where user_id = 'aaaa0000-0000-4000-8000-000000000005') = 1,
  'no forged entry was written for the colleague');

-- Management must still see the whole team, or the narrowing broke payroll.
select set_config('request.jwt.claim.sub', 'aaaa0000-0000-4000-8000-000000000002', false);
set role authenticated;
select ci.assert(
  (select count(*) from public.job_time_entries
     where organization_id = 'aaaa0000-0000-4000-8000-000000000001') = 2,
  'owner CAN still read every technician time entry');

reset role;
select set_config('request.jwt.claim.sub', '', false);
rollback;

do $$ begin raise notice 'tenant + timesheet assertions complete'; end $$;
