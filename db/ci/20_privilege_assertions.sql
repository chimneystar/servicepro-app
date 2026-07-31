-- =====================================================================
--  ServicePro — CI assertions: privilege escalation (audit §2.1 and §2.12)
--
--  Every assertion proves BOTH directions. A suite that only ever checks that
--  something is refused would pass against a database where nothing works at
--  all, which is the failure mode these tests exist to prevent. So each
--  forbidden action is paired with the legitimate action it must not have
--  broken.
--
--  ci.attempt() returns the number of rows the statement changed, or -1 if the
--  database refused it. Both zero and -1 are refusals, because an RLS USING
--  clause refuses silently (0 rows) while a WITH CHECK clause or a guard
--  trigger refuses loudly (42501). Requiring "<= 0" covers both without
--  pretending to know which mechanism migration 023 happened to use.
--
--  The whole file runs inside one transaction and ends with ROLLBACK, so it is
--  re-runnable and leaves no residue for the next file.
-- =====================================================================

set client_min_messages = notice;
begin;

-- ---------------------------------------------------------------------
-- Setup done as the superuser: an invitation the office user can read, and
-- two invitations that model the §2.12 chain. The forged one is inserted here
-- rather than through the policy precisely BECAUSE migration 023 now blocks an
-- office user from writing it — the point of assertion 16 is that even if such
-- a row exists (legacy data, a future policy regression, any other path),
-- accepting it still cannot mint an owner.
-- ---------------------------------------------------------------------
insert into public.invitations (organization_id, email, role, token, invited_by) values
  ('aaaa0000-0000-4000-8000-000000000001', 'existing-invite@ci.test', 'tech',
   'ci-token-existing', 'aaaa0000-0000-4000-8000-000000000002'),
  ('aaaa0000-0000-4000-8000-000000000001', 'invitee-forged@ci.test',  'owner',
   'ci-token-forged',   'aaaa0000-0000-4000-8000-000000000003'),   -- issued by OFFICE
  ('aaaa0000-0000-4000-8000-000000000001', 'invitee-genuine@ci.test', 'owner',
   'ci-token-genuine',  'aaaa0000-0000-4000-8000-000000000002');   -- issued by OWNER


-- =====================================================================
--  §2.1 — a technician promoting themselves to owner
-- =====================================================================
select set_config('request.jwt.claim.sub', 'aaaa0000-0000-4000-8000-000000000004', false);
set role authenticated;

-- FORBIDDEN: the exploit from the audit, verbatim.
--   PATCH /rest/v1/profiles?id=eq.<self>  {"role":"owner"}
select ci.assert(
  ci.attempt($q$update public.profiles set role = 'owner'
              where id = 'aaaa0000-0000-4000-8000-000000000004'$q$) <= 0,
  'tech CANNOT change their own profiles.role to owner');

select ci.assert(
  (select role::text from public.profiles where id = 'aaaa0000-0000-4000-8000-000000000004') = 'tech',
  'tech role is still tech after the escalation attempt');

-- LEGITIMATE: the same policy must still let a member edit their own
-- presentation fields, or the fix is a denial of service.
select ci.assert(
  ci.attempt($q$update public.profiles set full_name = 'Tech A1 Renamed'
              where id = 'aaaa0000-0000-4000-8000-000000000004'$q$) = 1,
  'tech CAN still edit their own full_name');

select ci.assert(
  (select full_name from public.profiles where id = 'aaaa0000-0000-4000-8000-000000000004') = 'Tech A1 Renamed',
  'the legitimate full_name edit really landed');

-- FORBIDDEN: payroll manipulation, independent of the role bug.
select ci.assert(
  ci.attempt($q$update public.profiles set commission_pct = 90
              where id = 'aaaa0000-0000-4000-8000-000000000004'$q$) <= 0,
  'tech CANNOT change their own commission_pct');

select ci.assert(
  (select commission_pct from public.profiles where id = 'aaaa0000-0000-4000-8000-000000000004') = 10,
  'commission_pct is unchanged after the payroll attempt');

-- FORBIDDEN: promoting a colleague instead of oneself.
select ci.assert(
  ci.attempt($q$update public.profiles set role = 'owner'
              where id = 'aaaa0000-0000-4000-8000-000000000005'$q$) <= 0,
  'tech CANNOT promote another member to owner');

select ci.assert(
  (select role::text from public.profiles where id = 'aaaa0000-0000-4000-8000-000000000005') = 'tech',
  'the colleague is still a tech');

-- FORBIDDEN: walking into the other tenant.
select ci.assert(
  ci.attempt($q$update public.profiles set organization_id = 'bbbb0000-0000-4000-8000-000000000001'
              where id = 'aaaa0000-0000-4000-8000-000000000004'$q$) <= 0,
  'tech CANNOT move their own profile into another organisation');

select ci.assert(
  (select organization_id from public.profiles where id = 'aaaa0000-0000-4000-8000-000000000004')
    = 'aaaa0000-0000-4000-8000-000000000001',
  'the tech is still in tenant A');


-- =====================================================================
--  The owner must still be able to administer the organisation. Without
--  these, migration 023 could have "passed" by locking the table entirely.
-- =====================================================================
reset role;
select set_config('request.jwt.claim.sub', 'aaaa0000-0000-4000-8000-000000000002', false);
set role authenticated;

select ci.assert(
  ci.attempt($q$update public.profiles set commission_pct = 25
              where id = 'aaaa0000-0000-4000-8000-000000000004'$q$) = 1,
  'owner CAN still set a technician commission_pct');

select ci.assert(
  (select commission_pct from public.profiles where id = 'aaaa0000-0000-4000-8000-000000000004') = 25,
  'the owner commission change really landed');

select ci.assert(
  ci.attempt($q$update public.profiles set role = 'office'
              where id = 'aaaa0000-0000-4000-8000-000000000005'$q$) = 1,
  'owner CAN still change a member role');

select ci.assert(
  (select role::text from public.profiles where id = 'aaaa0000-0000-4000-8000-000000000005') = 'office',
  'the owner role change really landed');


-- =====================================================================
--  §2.12 — the invitation chain
-- =====================================================================

-- The OFFICE user first. Migration 023 narrows invitation writes to owner, so
-- an office user cannot mint any invitation at all — but they must not lose
-- their read of the team's pending invitations.
reset role;
select set_config('request.jwt.claim.sub', 'aaaa0000-0000-4000-8000-000000000003', false);
set role authenticated;

select ci.assert(
  ci.attempt($q$insert into public.invitations (organization_id, email, role, token, invited_by)
              values ('aaaa0000-0000-4000-8000-000000000001', 'escalate@ci.test', 'owner',
                      'ci-token-office-owner', 'aaaa0000-0000-4000-8000-000000000003')$q$) <= 0,
  'office user CANNOT insert an invitation with role = owner');

select ci.assert(
  (select count(*) from public.invitations where token = 'ci-token-office-owner') = 0,
  'no owner-level invitation was written by the office user');

select ci.assert(
  (select count(*) from public.invitations
     where organization_id = 'aaaa0000-0000-4000-8000-000000000001') >= 1,
  'office user CAN still read the team invitation list');

-- The OWNER can still invite. Otherwise team management is broken.
reset role;
select set_config('request.jwt.claim.sub', 'aaaa0000-0000-4000-8000-000000000002', false);
set role authenticated;

select ci.assert(
  ci.attempt($q$insert into public.invitations (organization_id, email, role, token, invited_by)
              values ('aaaa0000-0000-4000-8000-000000000001', 'newtech@ci.test', 'tech',
                      'ci-token-owner-tech', 'aaaa0000-0000-4000-8000-000000000002')$q$) = 1,
  'owner CAN still issue an invitation');

select ci.assert(
  (select count(*) from public.invitations where token = 'ci-token-owner-tech') = 1,
  'the owner invitation really landed');

-- Second gate: acceptance re-checks who issued an owner-level invite.
-- The invitee has no profile yet, which is the state accept_invitation() acts on.
reset role;
select set_config('request.jwt.claim.sub', 'aaaa0000-0000-4000-8000-00000000000e', false);
set role authenticated;

select ci.assert(
  ci.refusal($q$select public.accept_invitation()$q$) = '42501',
  'accept_invitation() REFUSES an owner-level invite that an office user issued');

reset role;
select ci.assert(
  (select count(*) from public.profiles where id = 'aaaa0000-0000-4000-8000-00000000000e') = 0,
  'the forged invitee gained no profile at all');

-- LEGITIMATE: the same call, on an owner-level invite an owner actually issued,
-- must still work — otherwise ownership transfer is impossible.
select set_config('request.jwt.claim.sub', 'aaaa0000-0000-4000-8000-00000000000f', false);
set role authenticated;

select ci.assert(
  public.accept_invitation() = 'aaaa0000-0000-4000-8000-000000000001',
  'accept_invitation() ACCEPTS an owner-level invite that an owner issued');

reset role;
select ci.assert(
  (select role::text from public.profiles where id = 'aaaa0000-0000-4000-8000-00000000000f') = 'owner',
  'the genuine invitee is now an owner of tenant A');

reset role;
select set_config('request.jwt.claim.sub', '', false);
rollback;

do $$ begin raise notice 'privilege assertions complete'; end $$;
