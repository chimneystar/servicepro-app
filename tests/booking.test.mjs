import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BOOKING_TIMEZONE,
  addMinutes,
  buildBookingSlots,
  evaluateServiceArea,
  matchesServiceArea,
  normalizePhone,
  resolveTimeZone,
  serviceAreaEnforcementGaps,
} from "../lib/core/booking.mjs";

const hours = {
  "1": ["08:00", "17:00"],
  "2": ["08:00", "17:00"],
  "3": ["08:00", "17:00"],
  "4": ["08:00", "17:00"],
  "5": ["08:00", "17:00"],
  "6": null,
  "7": null,
};
const allDay = {
  "1": ["00:00", "23:59"],
  "2": ["00:00", "23:59"],
  "3": ["00:00", "23:59"],
  "4": ["00:00", "23:59"],
  "5": ["00:00", "23:59"],
  "6": ["00:00", "23:59"],
  "7": ["00:00", "23:59"],
};

// Every `now` below is written as an explicit UTC instant (trailing Z) and every
// case names its zone. Nothing here reads the machine's local time, so these
// assertions hold identically on a UTC CI box and a UTC-6 laptop.
const base = {
  intervalMin: 60,
  arrivalWindowMin: 120,
  minNoticeHours: 0,
  maxDaysAhead: 90,
  capacity: 1,
  busy: [],
};
const at = (iso) => new Date(iso).getTime();

test("booking slots respect business hours and service duration", () => {
  const slots = buildBookingSlots({
    ...base,
    date: "2026-08-03",
    hours,
    durationMin: 90,
    timeZone: "America/Chicago",
    now: at("2026-08-01T13:00:00Z"),
  });
  assert.equal(slots[0].start, "08:00");
  assert.equal(slots.at(-1).start, "15:00");
  assert.equal(slots[0].label, "08:00–10:00");
});

test("a full-capacity overlap removes the slot", () => {
  const slots = buildBookingSlots({
    ...base,
    date: "2026-08-03",
    hours,
    durationMin: 60,
    arrivalWindowMin: 60,
    busy: [{ start: "09:00", end: "10:00" }],
    timeZone: "America/Chicago",
    now: at("2026-08-01T13:00:00Z"),
  });
  assert.equal(
    slots.some((slot) => slot.start === "09:00"),
    false,
  );
  assert.equal(
    slots.some((slot) => slot.start === "10:00"),
    true,
  );
});

test("team capacity keeps a slot until every technician is busy", () => {
  const slots = buildBookingSlots({
    ...base,
    date: "2026-08-03",
    hours,
    durationMin: 60,
    arrivalWindowMin: 60,
    capacity: 2,
    busy: [{ start: "09:00", end: "10:00" }],
    timeZone: "America/Chicago",
    now: at("2026-08-01T13:00:00Z"),
  });
  assert.equal(
    slots.some((slot) => slot.start === "09:00"),
    true,
  );
});

test("booking helpers normalize common values", () => {
  assert.equal(normalizePhone("+1 (512) 555-0199"), "5125550199");
  assert.equal(addMinutes("09:30", 90), "11:00");
});

// ---------------------------------------------------------------------------
// Timezone. THE REGRESSION: slot times were built with bare
// `new Date("2026-08-03T09:00:00")`, resolved in the SERVER's zone. On Vercel
// (UTC) a UTC-5/-6 business got its minimum-notice cutoff and its day
// boundaries hours out.
// ---------------------------------------------------------------------------

test("minimum notice is measured in the business's zone, not the server's", () => {
  // 14:00 UTC == 09:00 in Chicago (CDT, UTC-5) on this date. With a 4-hour
  // notice rule the earliest bookable arrival is 13:00 local.
  const input = {
    ...base,
    date: "2026-08-03",
    hours,
    durationMin: 60,
    minNoticeHours: 4,
    timeZone: "America/Chicago",
    now: at("2026-08-03T14:00:00Z"),
  };
  const slots = buildBookingSlots(input);
  // REJECTS what is already too soon...
  assert.equal(
    slots.some((slot) => slot.start === "09:00"),
    false,
    "09:00 local is now — must not be offered",
  );
  assert.equal(
    slots.some((slot) => slot.start === "12:00"),
    false,
    "12:00 local is inside the 4h notice window",
  );
  // ...and ACCEPTS what genuinely clears the rule.
  assert.equal(slots[0].start, "13:00", "13:00 local is exactly 4h out and must be offered");

  // The same instant read as UTC (what the server did before this fix) believes
  // local time is 14:00, so the 4h rule pushes past the 17:00 close and the day
  // collapses to nothing. Same clock, same settings, opposite answer — which is
  // exactly the error a Vercel deployment was serving.
  assert.equal(buildBookingSlots({ ...input, timeZone: "UTC" }).length, 0);
});

test("the same instant produces different cutoffs in different zones", () => {
  const shared = {
    ...base,
    date: "2026-08-03",
    hours,
    durationMin: 60,
    minNoticeHours: 2,
    now: at("2026-08-03T15:00:00Z"),
  };
  // 15:00 UTC is 11:00 New York, 10:00 Chicago, 08:00 Los Angeles.
  assert.equal(buildBookingSlots({ ...shared, timeZone: "America/New_York" })[0].start, "13:00");
  assert.equal(buildBookingSlots({ ...shared, timeZone: "America/Chicago" })[0].start, "12:00");
  assert.equal(buildBookingSlots({ ...shared, timeZone: "America/Los_Angeles" })[0].start, "10:00");
});

test("the day boundary is the business's midnight, not the server's", () => {
  // 03:00 UTC on the 4th is still 21:00 on the 3rd in Chicago. The business's
  // "today" is the 3rd, so the 3rd must still be bookable (daysAhead 0) — the
  // old server-local maths called it yesterday and returned nothing.
  const today = buildBookingSlots({
    ...base,
    date: "2026-08-03",
    hours: allDay,
    durationMin: 30,
    maxDaysAhead: 0,
    timeZone: "America/Chicago",
    now: at("2026-08-04T03:00:00Z"),
  });
  assert.ok(today.length > 0, "the business's current day must still be bookable");
  // And the 4th is tomorrow there, so a 0-day horizon must refuse it.
  const tomorrow = buildBookingSlots({
    ...base,
    date: "2026-08-04",
    hours: allDay,
    durationMin: 30,
    maxDaysAhead: 0,
    timeZone: "America/Chicago",
    now: at("2026-08-04T03:00:00Z"),
  });
  assert.equal(tomorrow.length, 0, "tomorrow must be outside a 0-day horizon");
});

test("a past day is refused even when the server has not reached midnight", () => {
  // 23:00 UTC on the 3rd is already the 4th in Tokyo.
  assert.equal(
    buildBookingSlots({
      ...base,
      date: "2026-08-03",
      hours: allDay,
      durationMin: 30,
      timeZone: "Asia/Tokyo",
      now: at("2026-08-03T23:00:00Z"),
    }).length,
    0,
  );
  assert.ok(
    buildBookingSlots({
      ...base,
      date: "2026-08-04",
      hours: allDay,
      durationMin: 30,
      timeZone: "Asia/Tokyo",
      now: at("2026-08-03T23:00:00Z"),
    }).length > 0,
  );
});

test("DST transitions resolve to the correct real instant", () => {
  // US spring-forward 2026-03-08: 02:00 local does not exist in New York.
  // 12:00 UTC that morning is 08:00 EDT (UTC-4), not 07:00 EST.
  const spring = buildBookingSlots({
    ...base,
    date: "2026-03-09",
    hours,
    durationMin: 60,
    minNoticeHours: 1,
    timeZone: "America/New_York",
    now: at("2026-03-09T12:00:00Z"),
  });
  assert.equal(spring[0].start, "09:00", "08:00 EDT + 1h notice => 09:00");
  // Phoenix never observes DST, so the same instant is 05:00 there and the
  // whole day is still open.
  const phoenix = buildBookingSlots({
    ...base,
    date: "2026-03-09",
    hours,
    durationMin: 60,
    minNoticeHours: 1,
    timeZone: "America/Phoenix",
    now: at("2026-03-09T12:00:00Z"),
  });
  assert.equal(phoenix[0].start, "08:00");
});

test("an unknown or missing timezone falls back instead of throwing", () => {
  assert.equal(resolveTimeZone("Mars/Olympus_Mons"), DEFAULT_BOOKING_TIMEZONE);
  assert.equal(resolveTimeZone(""), DEFAULT_BOOKING_TIMEZONE);
  assert.equal(resolveTimeZone(null), DEFAULT_BOOKING_TIMEZONE);
  assert.equal(resolveTimeZone("America/Chicago"), "America/Chicago");
  assert.equal(DEFAULT_BOOKING_TIMEZONE, "America/New_York");
  // Booking must keep working (docs/FEATURE-INVENTORY.md) rather than 500.
  const slots = buildBookingSlots({
    ...base,
    date: "2026-08-03",
    hours,
    durationMin: 60,
    timeZone: "Not/AZone",
    now: at("2026-08-01T13:00:00Z"),
  });
  assert.ok(slots.length > 0);
});

test("a malformed date yields no slots rather than an invalid instant", () => {
  for (const date of ["", "not-a-date", "2026-13-01", "2026-02-31", "20260803"]) {
    assert.equal(
      buildBookingSlots({
        ...base,
        date,
        hours,
        durationMin: 60,
        timeZone: "America/Chicago",
        now: at("2026-08-01T13:00:00Z"),
      }).length,
      0,
      date,
    );
  }
});

// ---------------------------------------------------------------------------
// Service areas. THE REGRESSION: polygon areas were filtered out and the filter
// then returned true on an empty list, so an org whose areas were ALL polygons
// showed "enforce service area" as ON and accepted every address on earth.
// ---------------------------------------------------------------------------

const zipAndCity = [
  { area_type: "zip", values_json: ["78701", "78702"], active: true },
  { area_type: "city", values_json: ["Lakeway"], active: true },
];

test("service areas match ZIP or city", () => {
  assert.equal(matchesServiceArea("78701", "Austin", zipAndCity), true);
  assert.equal(matchesServiceArea("00000", "lakeway", zipAndCity), true);
  assert.equal(matchesServiceArea("00000", "Dallas", zipAndCity), false);
});

test("evaluateServiceArea reports match and outside for checkable areas", () => {
  assert.equal(evaluateServiceArea("78701", "Austin", zipAndCity), "match");
  assert.equal(evaluateServiceArea("00000", "Dallas", zipAndCity), "outside");
  // No areas configured at all is an open service area, not a refusal.
  assert.equal(evaluateServiceArea("00000", "Dallas", []), "match");
  // Inactive areas are ignored, so an org that deactivated everything stays open.
  assert.equal(
    evaluateServiceArea("00000", "Dallas", [
      { area_type: "zip", values_json: ["78701"], active: false },
    ]),
    "match",
  );
});

test("a polygon-only configuration is unevaluable, never a silent accept", () => {
  const polygonsOnly = [
    { area_type: "polygon", values_json: ["whatever the owner typed"], active: true },
  ];
  assert.equal(evaluateServiceArea("00000", "Nowhere", polygonsOnly), "unevaluable");
  assert.equal(evaluateServiceArea("78701", "Austin", polygonsOnly), "unevaluable");
});

test("polygons never widen a configuration that has checkable areas", () => {
  const mixed = [...zipAndCity, { area_type: "polygon", values_json: ["anything"], active: true }];
  assert.equal(evaluateServiceArea("78701", "Austin", mixed), "match");
  // THE BUG, pinned: an out-of-area address must still be refused when a
  // polygon sits alongside the real areas.
  assert.equal(evaluateServiceArea("00000", "Dallas", mixed), "outside");
});

test("enforcement gaps tell the owner exactly what is not being checked", () => {
  assert.deepEqual(serviceAreaEnforcementGaps(zipAndCity), {
    total: 2,
    polygons: 0,
    enforceable: 2,
    unenforceable: false,
  });
  assert.deepEqual(
    serviceAreaEnforcementGaps([{ area_type: "polygon", values_json: [], active: true }]),
    { total: 1, polygons: 1, enforceable: 0, unenforceable: true },
  );
  assert.deepEqual(
    serviceAreaEnforcementGaps([
      ...zipAndCity,
      { area_type: "polygon", values_json: [], active: true },
    ]),
    { total: 3, polygons: 1, enforceable: 2, unenforceable: false },
  );
  // Nothing configured is not a lie — the toggle simply has nothing to enforce.
  assert.deepEqual(serviceAreaEnforcementGaps([]), {
    total: 0,
    polygons: 0,
    enforceable: 0,
    unenforceable: false,
  });
  assert.equal(
    serviceAreaEnforcementGaps([{ area_type: "polygon", values_json: [], active: false }])
      .unenforceable,
    false,
  );
});
