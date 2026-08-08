-- =====================================================================
--  ServicePro — Migration 043
--  Deleting a job type withdraws it from the public booking page.
--
--  WHY
--  ---
--  `booking_services.job_type_id` is `references job_types(id) ON DELETE SET
--  NULL` (migration 020). Deleting a job type therefore does not withdraw its
--  bookable service — it orphans it, leaving the row `active` with no job type.
--
--  The owner's settings screen and the customer's booking page then disagree,
--  and each is individually reasonable:
--
--    * `BookingSettingsForm` builds its list from JOB TYPES and looks up a
--      matching service, so an orphan matches nothing and is invisible.
--    * `public_booking_info_v2` selects `from booking_services where
--      organization_id = ... and active`, never mentioning job_types — so the
--      orphan is still advertised. `/api/booking/[org]/slots` and `/submit`
--      likewise accept it by id, both on the service-role client.
--
--  So the owner deletes a job type to stop offering that work, watches it
--  vanish from their settings, and customers can still book it — with no way
--  for the owner to find or withdraw it.
--
--  THE FIX, AND WHY THIS ONE
--  -------------------------
--  Deactivate the service when its job type goes. All three read paths already
--  filter on `active`, so one trigger closes the menu, the slot lookup and the
--  submission together — rather than three separate filters that must each be
--  remembered. A fourth read path added tomorrow inherits it.
--
--  Rejected: `on delete cascade`. It would also work and needs no trigger, but
--  it destroys the service's configured duration, price and translations on a
--  deletion the owner may not have meant. Deactivating is reversible; deleting
--  is not, and nothing here is urgent enough to justify discarding their setup.
--
--  Rejected: filtering `job_type_id is not null` in the RPC. It fixes the menu
--  and leaves /slots and /submit accepting the orphan by id — the shape of bug
--  this project keeps producing, where one of several readers is brought into
--  line and the others are not.
--
--  Tests: tests/booking-orphan-services.test.mjs
-- =====================================================================

create or replace function public.deactivate_orphaned_booking_services()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- BEFORE DELETE, so job_type_id still points at the row being removed; the
  -- FK's SET NULL has not run yet.
  update public.booking_services
     set active = false
   where job_type_id = old.id
     and active;
  return old;
end $$;

drop trigger if exists trg_job_types_withdraw_booking on public.job_types;
create trigger trg_job_types_withdraw_booking
  before delete on public.job_types
  for each row execute function public.deactivate_orphaned_booking_services();

-- Existing orphans: a database that has already lost a job type is still
-- advertising the service. `job_type_id is null` can only mean this — every
-- creation path sets it (app/onboarding/page.tsx, db/041) and
-- (organization_id, job_type_id) is unique.
update public.booking_services
   set active = false
 where job_type_id is null
   and active;
