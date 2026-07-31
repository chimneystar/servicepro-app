import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripSqlComments } from "./helpers/sql.mjs";
import {
  timeToMinutes, isEffective, coversDay, rowWindow, dayAvailability,
  isProfileOff, describeUnavailable, bookingCapacity,
} from "../lib/core/availability.mjs";
import { buildBookingSlots } from "../lib/core/booking.mjs";

// ---------------------------------------------------------------------------
// 6c.3 — the only availability inputs were business hours and existing jobs, so
// booking and dispatch would both schedule somebody who was on holiday.
// ---------------------------------------------------------------------------

const HOURS = { "1": ["09:00", "17:00"], "2": ["09:00", "17:00"], "3": ["09:00", "17:00"], "4": ["09:00", "17:00"], "5": ["09:00", "17:00"] };
// 2026-07-01 is a Wednesday.
const BASE = {
  date: "2026-07-01", hours: HOURS, intervalMin: 60, durationMin: 60, arrivalWindowMin: 120,
  minNoticeHours: 0, maxDaysAhead: 60, timeZone: "UTC", now: Date.UTC(2026, 5, 30, 12, 0),
};

test("times parse to minutes, and an absent time is null not zero", () => {
  assert.equal(timeToMinutes("09:30"), 570);
  assert.equal(timeToMinutes("09:30:00"), 570);
  assert.equal(timeToMinutes(null), null);
  assert.equal(timeToMinutes(""), null);
});

test("only APPROVED time off removes availability", () => {
  assert.equal(isEffective({ status: "approved" }), true);
  assert.equal(isEffective({}), true);                       // the column default
  assert.equal(isEffective({ status: "requested" }), false); // a request is not an absence
  assert.equal(isEffective({ status: "declined" }), false);
});

test("a multi-day absence covers its whole inclusive range and nothing else", () => {
  const row = { starts_on: "2026-07-01", ends_on: "2026-07-03", status: "approved" };
  assert.equal(coversDay(row, "2026-06-30"), false);
  assert.equal(coversDay(row, "2026-07-01"), true);
  assert.equal(coversDay(row, "2026-07-03"), true);
  assert.equal(coversDay(row, "2026-07-04"), false);
});

test("a row with no times is a WHOLE day, expressed as 0..1440", () => {
  assert.deepEqual(rowWindow({}), { start: 0, end: 1440, allDay: true });
  assert.deepEqual(rowWindow({ start_time: "09:00", end_time: "11:00" }), { start: 540, end: 660, allDay: false });
});

test("a null profile_id is a BUSINESS CLOSURE, not one person's holiday", () => {
  const day = dayAvailability([
    { profile_id: null, starts_on: "2026-07-01", ends_on: "2026-07-01" },
    { profile_id: "a", starts_on: "2026-07-01", ends_on: "2026-07-01" },
  ], "2026-07-01");
  assert.equal(day.closedWindows.length, 1);
  assert.equal(day.awayWindows.length, 1);
  assert.deepEqual(day.awayProfileIds, ["a"]);
});

test("a closure removes ALL capacity, however large the team", () => {
  const closed = bookingCapacity({ teamSize: 12, rows: [{ profile_id: null, starts_on: "2026-07-01", ends_on: "2026-07-01" }], day: "2026-07-01" });
  assert.equal(closed.capacity, 0);
  assert.equal(closed.closedAllDay, true);
  // ... and nothing at all is bookable that day.
  assert.deepEqual(buildBookingSlots({ ...BASE, capacity: closed.capacity, busy: [], closedWindows: closed.closedWindows, awayWindows: closed.awayWindows }), []);
});

test("whole-day absence reduces capacity by exactly one person each", () => {
  const rows = [
    { profile_id: "a", starts_on: "2026-07-01", ends_on: "2026-07-01" },
    { profile_id: "b", starts_on: "2026-07-01", ends_on: "2026-07-01" },
  ];
  assert.equal(bookingCapacity({ teamSize: 5, rows, day: "2026-07-01" }).capacity, 3);
  // Two rows for the SAME person must not cost two units of capacity.
  const doubled = [...rows, { profile_id: "a", starts_on: "2026-07-01", ends_on: "2026-07-05" }];
  assert.equal(bookingCapacity({ teamSize: 5, rows: doubled, day: "2026-07-01" }).capacity, 3);
});

test("the whole team on holiday leaves NO slots — the headline defect", () => {
  const rows = [
    { profile_id: "a", starts_on: "2026-07-01", ends_on: "2026-07-01" },
    { profile_id: "b", starts_on: "2026-07-01", ends_on: "2026-07-01" },
  ];
  const availability = bookingCapacity({ teamSize: 2, rows, day: "2026-07-01" });
  assert.equal(availability.capacity, 0);
  assert.deepEqual(buildBookingSlots({ ...BASE, capacity: availability.capacity, busy: [], awayWindows: availability.awayWindows, closedWindows: availability.closedWindows }), []);
  // Proven the other way: with nobody off, the same day is fully bookable.
  const open = bookingCapacity({ teamSize: 2, rows: [], day: "2026-07-01" });
  assert.ok(buildBookingSlots({ ...BASE, capacity: open.capacity, busy: [] }).length > 0);
});

test("a PARTIAL-day absence closes only its own hours", () => {
  const rows = [{ profile_id: "a", starts_on: "2026-07-01", ends_on: "2026-07-01", start_time: "09:00", end_time: "11:00" }];
  const availability = bookingCapacity({ teamSize: 1, rows, day: "2026-07-01" });
  assert.equal(availability.capacity, 1, "a partial absence must not zero the day");
  const slots = buildBookingSlots({ ...BASE, capacity: availability.capacity, busy: [], awayWindows: availability.awayWindows, closedWindows: availability.closedWindows });
  const starts = slots.map((slot) => slot.start);
  assert.ok(!starts.includes("09:00") && !starts.includes("10:00"), "the dentist hours are gone");
  assert.ok(starts.includes("11:00") && starts.includes("14:00"), "the afternoon is still available");
});

test("time off and existing jobs consume the SAME capacity pool", () => {
  const rows = [{ profile_id: "a", starts_on: "2026-07-01", ends_on: "2026-07-01", start_time: "09:00", end_time: "10:00" }];
  const availability = bookingCapacity({ teamSize: 2, rows, day: "2026-07-01" });
  const slots = buildBookingSlots({
    ...BASE, capacity: availability.capacity,
    busy: [{ start: "09:00", end: "10:00" }],                     // the OTHER technician is on a job
    awayWindows: availability.awayWindows, closedWindows: availability.closedWindows,
  });
  assert.ok(!slots.some((slot) => slot.start === "09:00"), "2 people, 1 away and 1 busy => nothing free");
  assert.ok(slots.some((slot) => slot.start === "10:00"));
});

test("passing NO time off reproduces the old behaviour byte for byte", () => {
  const before = buildBookingSlots({ ...BASE, capacity: 2, busy: [{ start: "13:00", end: "14:00" }] });
  const after = buildBookingSlots({ ...BASE, capacity: 2, busy: [{ start: "13:00", end: "14:00" }], awayWindows: [], closedWindows: [] });
  assert.deepEqual(after, before);
  assert.ok(before.length > 0);
});

test("a technician's own absence does not make anybody ELSE unavailable", () => {
  const rows = [{ profile_id: "a", starts_on: "2026-07-01", ends_on: "2026-07-01" }];
  assert.equal(isProfileOff(rows, "a", "2026-07-01", "09:00", "10:00").off, true);
  assert.equal(isProfileOff(rows, "b", "2026-07-01", "09:00", "10:00").off, false);
});

test("a closure makes EVERYBODY unavailable, and says so", () => {
  const rows = [{ profile_id: null, starts_on: "2026-07-04", ends_on: "2026-07-04" }];
  const result = isProfileOff(rows, "anyone", "2026-07-04", "09:00", "10:00");
  assert.equal(result.off, true);
  assert.equal(result.reason, "closed");
  assert.match(describeUnavailable(result, { locale: "en" }), /closed/i);
});

test("an untimed job asks the WHOLE-DAY question", () => {
  // A job with no times could be worked at any hour, so a partial absence still
  // refuses it — refusing more, never less, is the safe direction.
  const rows = [{ profile_id: "a", starts_on: "2026-07-01", ends_on: "2026-07-01", start_time: "09:00", end_time: "10:00" }];
  assert.equal(isProfileOff(rows, "a", "2026-07-01", null, null).off, true);
  assert.equal(isProfileOff(rows, "a", "2026-07-01", "14:00", "15:00").off, false);
});

test("the refusal names the hours, so a dispatcher can act on it", () => {
  const rows = [{ profile_id: "a", starts_on: "2026-07-01", ends_on: "2026-07-01", start_time: "09:00", end_time: "11:30" }];
  const message = describeUnavailable(isProfileOff(rows, "a", "2026-07-01", "10:00", "11:00"), { locale: "en", name: "Dana" });
  assert.match(message, /Dana/);
  assert.match(message, /09:00/);
  assert.match(message, /11:30/);
  assert.equal(describeUnavailable({ off: false }), null);
});

test("a REQUESTED absence blocks nothing until it is approved", () => {
  const rows = [{ profile_id: "a", starts_on: "2026-07-01", ends_on: "2026-07-01", status: "requested" }];
  assert.equal(isProfileOff(rows, "a", "2026-07-01", "09:00", "10:00").off, false);
  assert.equal(bookingCapacity({ teamSize: 3, rows, day: "2026-07-01" }).capacity, 3);
});

// ---------------------------------------------------------------------------
// Structural. Comments stripped first.
// ---------------------------------------------------------------------------
const migration = stripSqlComments(readFileSync(new URL("../db/039_scheduling_sales.sql", import.meta.url), "utf8"));
const slotsRoute = stripSqlComments(readFileSync(new URL("../app/api/booking/[org]/slots/route.ts", import.meta.url), "utf8"));
const submitRoute = stripSqlComments(readFileSync(new URL("../app/api/booking/[org]/submit/route.ts", import.meta.url), "utf8"));
const dispatchPage = stripSqlComments(readFileSync(new URL("../app/(app)/dispatch/page.tsx", import.meta.url), "utf8"));
const guard = stripSqlComments(readFileSync(new URL("../app/(app)/dispatch/assignment-guard.ts", import.meta.url), "utf8"));

test("the booking SLOTS route reads time off", () => {
  assert.match(slotsRoute, /technician_time_off/);
  assert.match(slotsRoute, /bookingCapacity/);
  assert.match(slotsRoute, /closedWindows/);
  assert.match(slotsRoute, /awayWindows/);
  assert.match(slotsRoute, /eq\("status","approved"\)/);
});

test("the booking SUBMIT route applies the identical rule", () => {
  // The slot list is a suggestion; the POST is the decision. A rule enforced in
  // one and not the other is a rule with a documented bypass.
  assert.match(submitRoute, /technician_time_off/);
  assert.match(submitRoute, /bookingCapacity/);
  assert.match(submitRoute, /closedWindows:availability\.closedWindows/);
});

test("the dispatch view surfaces time off, and the actions enforce it", () => {
  assert.match(dispatchPage, /technician_time_off/);
  assert.match(dispatchPage, /dayAvailability/);
  assert.match(guard, /isProfileOff/);
  assert.match(guard, /technician_time_off/);
});

test("time off NEVER writes to jobs or job_assignments", () => {
  // This is the guarantee that keeps it from becoming a route around
  // jobs_no_double_book: it removes availability and writes nothing.
  assert.doesNotMatch(guard, /from\("jobs"\)\s*\.\s*update/);
  assert.doesNotMatch(guard, /job_assignments/);
});

test("migration 039 does not weaken the no-double-book guarantee", () => {
  assert.doesNotMatch(migration, /drop constraint[^\n;]*jobs_no_double_book/i);
  assert.doesNotMatch(migration, /drop trigger[^\n;]*trg_job_assignments_no_double_book/i);
  assert.doesNotMatch(migration, /drop trigger[^\n;]*trg_jobs_crew_no_double_book/i);
  assert.doesNotMatch(migration, /drop table/i);
  assert.doesNotMatch(migration, /drop column/i);
  // Nothing in it touches the columns the exclusion constraint is built on.
  assert.doesNotMatch(migration, /update public\.jobs\s+set\s+assigned_to/i);
});

test("time off is one table covering both absence and closure", () => {
  assert.match(migration, /create table if not exists public\.technician_time_off/);
  assert.match(migration, /profile_id\s+uuid,/);            // nullable = closure
  assert.match(migration, /check \(ends_on >= starts_on\)/);
  assert.match(migration, /revoke all on public\.technician_time_off from anon/);
});

test("a technician can REQUEST time off but cannot approve it", () => {
  const policy = /create policy technician_time_off_request[\s\S]*?;/.exec(migration);
  assert.ok(policy);
  assert.match(policy[0], /profile_id = auth\.uid\(\)/);
  assert.match(policy[0], /status = 'requested'/);
  assert.match(policy[0], /for insert/);
});
