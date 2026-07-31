-- =====================================================================
--  ServicePro — Migration 029 (online booking: business timezone)
--  Run once in the Supabase SQL Editor. Safe to re-run. Drops nothing.
--
--  THE BUG: booking_settings had no timezone at all, and the slot engine built
--  bare `new Date("2026-08-03T09:00:00")` values. A bare datetime literal with
--  no offset is resolved in the RUNTIME's zone — on Vercel that is UTC. So the
--  business's opening hours, its minimum-notice cutoff and its day boundaries
--  were all evaluated against the server's clock instead of its own.
--
--  For a business in UTC-6 that is a six-hour error in both directions:
--    * minimum notice: a 4-hour rule measured from the wrong instant offered
--      same-day arrival windows that had already passed;
--    * day boundaries: a slot near midnight was attributed to the wrong day,
--      so customers booked a date the business was not open.
--
--  The fix is to store the business's IANA zone here and resolve every
--  wall-clock <-> instant conversion through it (lib/core/booking.mjs).
--
--  Default is America/New_York: this deployment is a US business, and it is a
--  real zone with real DST rules rather than a fixed offset, so an org that
--  never touches the setting still gets correct DST behaviour.
-- =====================================================================

-- 1. The column. Additive, defaulted, NOT NULL, so no existing row breaks and
--    no code path can encounter a null zone.
alter table public.booking_settings
  add column if not exists timezone text not null default 'America/New_York';

-- 2. Repair any row that predates the default or was blanked out later.
update public.booking_settings
   set timezone = 'America/New_York'
 where timezone is null
    or btrim(timezone) = '';

-- 3. Shape constraint. Postgres cannot subquery pg_timezone_names inside a
--    CHECK, so this rejects the obviously-wrong (empty, spaces, absurd length)
--    and leaves true IANA validation to step 4. Added conditionally so re-runs
--    do not error on an already-present constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.booking_settings'::regclass
       and conname  = 'booking_settings_timezone_shape'
  ) then
    alter table public.booking_settings
      add constraint booking_settings_timezone_shape
      check (timezone ~ '^[A-Za-z0-9+_/-]{3,64}$');
  end if;
end $$;

-- 4. Real IANA validation. pg_timezone_names is the authority the server itself
--    uses, so a typo is refused at write time instead of silently degrading
--    every slot calculation for that organisation.
create or replace function public.assert_booking_timezone()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'unknown IANA timezone: %', new.timezone
      using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists trg_booking_settings_timezone on public.booking_settings;
create trigger trg_booking_settings_timezone
  before insert or update of timezone on public.booking_settings
  for each row execute function public.assert_booking_timezone();

-- =====================================================================
--  NOT IN THIS MIGRATION: polygon service areas.
--
--  service_areas.area_type allows 'polygon', but a polygon can only be tested
--  against a geocoded point and nothing in this product geocodes anything --
--  leads and customers store address text only, there is no PostGIS extension,
--  and Operations builds a "polygon" area by splitting a free-text box on
--  commas, so values_json is not even coordinate pairs. Adding geometry columns
--  here would imply an enforcement capability that still would not exist.
--
--  The application now treats a polygon-only configuration as UNEVALUABLE
--  rather than silently accepting every address, and says so on the settings
--  screen. See docs/REMEDIATION-PLAN.md item 4.8.
-- =====================================================================
