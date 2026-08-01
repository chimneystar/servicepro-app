import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/pg.mjs";

// ---------------------------------------------------------------------------
// Deleting a job type must stop customers booking it.
//
// THE DEFECT. `booking_services.job_type_id` is `references job_types(id) ON
// DELETE SET NULL` (db/020:32). Deleting a job type therefore does not remove
// its bookable service — it orphans it, leaving the row `active` with a null
// job type.
//
// The two views of that row then disagree, and each is individually reasonable:
//
//   - The owner's settings screen (BookingSettingsForm) builds its list from
//     JOB TYPES and looks up a matching service, so an orphan matches nothing
//     and is invisible.
//   - The public booking menu (`public_booking_info_v2`, db/020:145) selects
//     `from booking_services where organization_id = ... and active`, with no
//     reference to job_types at all — so the orphan is still offered, and
//     /api/booking/[org]/slots and /submit will still accept it, both using the
//     service-role client.
//
// The result is the worst shape a settings screen can have: the owner deletes a
// job type to stop offering that work, watches it disappear from their
// settings, and customers can still see and book it — with no way for the owner
// to find or remove it.
//
// A null job_type_id can only arise this way. Every creation path sets it
// (onboarding/page.tsx:144, db/041:399) and `(organization_id, job_type_id)` is
// unique, so a null is by definition the residue of a deleted job type and can
// be treated as one.
//
// Fixed in db/043_booking_orphan_services.sql.
// ---------------------------------------------------------------------------

const ORG = "aaaaaaaa-0000-0000-0000-00000000000b";

async function orgWithBookableService(db) {
  await db.exec(`
    insert into public.organizations (id, name) values ('${ORG}', 'Bookable Co');
    -- A trigger already creates the booking_settings row with the organisation,
    -- so this only has to make sure booking is switched on.
    insert into public.booking_settings (organization_id, enabled)
      values ('${ORG}', true)
      on conflict (organization_id) do update set enabled = true;
    insert into public.job_types (organization_id, name, name_en)
      values ('${ORG}', 'Chimney Sweep', 'Chimney Sweep');
    -- A job type already brings its bookable service with it (migration 041's
    -- sync), so this upserts rather than inserts: the point of the fixture is a
    -- service that IS offered, however it came to exist.
    insert into public.booking_services
      (organization_id, job_type_id, name_en, duration_min, price_minor, active)
    select '${ORG}', jt.id, 'Chimney Sweep', 60, 0, true
      from public.job_types jt where jt.organization_id = '${ORG}'
      on conflict (organization_id, job_type_id)
      do update set active = true, name_en = excluded.name_en;
  `);
}

const publicMenu = async (db) => {
  const { rows } = await db.query(`select public.public_booking_info_v2('${ORG}'::uuid) as info`);
  const info = rows[0].info;
  return info?.services ?? [];
};

test("a live job type is offered on the public booking page", async () => {
  // The control. Without this, a fix that emptied the menu entirely would pass
  // the real test below while destroying the product.
  const { db } = await freshDatabase();
  await orgWithBookableService(db);

  const services = await publicMenu(db);
  assert.equal(services.length, 1, "the business's one bookable service must be offered");
  assert.equal(services[0].name_en, "Chimney Sweep");
});

test("deleting the job type withdraws it from the public booking page", async () => {
  const { db } = await freshDatabase();
  await orgWithBookableService(db);

  await db.exec(`delete from public.job_types where organization_id = '${ORG}';`);

  // The row survives, orphaned and still active — that is the FK doing what it
  // says, and is not itself the bug.
  const { rows: orphans } = await db.query(
    `select job_type_id, active from public.booking_services where organization_id = '${ORG}'`,
  );
  assert.equal(orphans.length, 1, "on delete set null keeps the row");
  assert.equal(orphans[0].job_type_id, null);

  // The bug is that the customer can still book it.
  const services = await publicMenu(db);
  assert.deepEqual(
    services,
    [],
    "a service whose job type was deleted must not still be offered to customers — " +
      "the owner cannot see it in settings, so they cannot withdraw it either",
  );
});

test("the owner's settings screen and the public menu agree on what is offered", async () => {
  // The invariant behind both tests above, stated directly: the public menu is
  // exactly the set of services reachable from a live job type, which is what
  // BookingSettingsForm renders.
  const { db } = await freshDatabase();
  await orgWithBookableService(db);
  await db.exec(`
    insert into public.job_types (organization_id, name, name_en)
      values ('${ORG}', 'Gutter Clean', 'Gutter Clean');
  `);

  const { rows: settingsView } = await db.query(`
    select bs.name_en
      from public.booking_services bs
      join public.job_types jt on jt.id = bs.job_type_id
     where bs.organization_id = '${ORG}' and bs.active
     order by bs.name_en
  `);
  const menu = (await publicMenu(db)).map((s) => s.name_en).sort();

  assert.deepEqual(
    menu,
    settingsView.map((r) => r.name_en),
    "what a customer can book must equal what the owner can see and control",
  );
});
