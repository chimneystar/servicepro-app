import test from "node:test";
import assert from "node:assert/strict";
import {
  intervalsOverlap, validateInterval, findConflicts, canBook,
  canTransition, toEpochMinutes,
} from "../lib/core/scheduling.mjs";

const base = [
  { id: "a", technicianId: "t1", startMin: 600, endMin: 690, status: "scheduled" }, // 10:00-11:30
  { id: "b", technicianId: "t1", startMin: 690, endMin: 750, status: "scheduled" }, // 11:30-12:30 (back-to-back)
  { id: "c", technicianId: "t2", startMin: 600, endMin: 690, status: "scheduled" }, // other tech, same time
  { id: "d", technicianId: "t1", startMin: 800, endMin: 860, status: "cancelled" }, // cancelled
];

test("overlap detection (end exclusive)", () => {
  assert.equal(intervalsOverlap(600, 690, 660, 720), true);  // overlap
  assert.equal(intervalsOverlap(600, 690, 690, 750), false); // back-to-back = no overlap
  assert.equal(intervalsOverlap(600, 690, 700, 750), false); // separate
});

test("double-booking the same technician is blocked", () => {
  const candidate = { technicianId: "t1", startMin: 620, endMin: 680 }; // 10:20-11:20 overlaps only 'a'
  const conflicts = findConflicts(candidate, base);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].id, "a");
  assert.equal(canBook(candidate, base).ok, false);
});

test("back-to-back booking is allowed", () => {
  const candidate = { technicianId: "t1", startMin: 750, endMin: 810 }; // 12:30-13:30
  assert.deepEqual(findConflicts(candidate, base), []);
  assert.equal(canBook(candidate, base).ok, true);
});

test("different technician at the same time is allowed", () => {
  const candidate = { technicianId: "t3", startMin: 600, endMin: 690 };
  assert.equal(canBook(candidate, base).ok, true);
});

test("cancelled appointments never cause a conflict", () => {
  const candidate = { technicianId: "t1", startMin: 810, endMin: 850 }; // overlaps cancelled 'd'
  assert.deepEqual(findConflicts(candidate, base), []);
});

test("editing an appointment does not conflict with itself", () => {
  const candidate = { id: "a", technicianId: "t1", startMin: 600, endMin: 680 }; // shrink 'a'
  assert.deepEqual(findConflicts(candidate, base).map((c) => c.id), []); // self excluded, no b overlap
  // But extending 'a' into 'b' (690) IS still caught:
  const candidate2 = { id: "a", technicianId: "t1", startMin: 600, endMin: 710 };
  assert.deepEqual(findConflicts(candidate2, base).map((c) => c.id), ["b"]);
});

test("unassigned job cannot double-book a technician", () => {
  const candidate = { technicianId: null, startMin: 600, endMin: 690 };
  assert.deepEqual(findConflicts(candidate, base), []);
});

test("invalid time windows are rejected", () => {
  assert.equal(validateInterval(700, 700).ok, false); // zero length
  assert.equal(validateInterval(700, 600).ok, false); // end before start
  assert.equal(validateInterval(0, 24 * 60 + 1).ok, false); // too long
  assert.equal(validateInterval(600, 690).ok, true);
});

test("status transitions are controlled (no silent disappearance)", () => {
  assert.equal(canTransition("scheduled", "in_progress"), true);
  assert.equal(canTransition("scheduled", "cancelled"), true);
  assert.equal(canTransition("in_progress", "done"), true);
  assert.equal(canTransition("done", "scheduled"), false);     // terminal
  assert.equal(canTransition("cancelled", "scheduled"), false); // terminal
  assert.equal(canTransition("scheduled", "banana"), false);    // unknown
});

test("date+time to epoch minutes is deterministic", () => {
  // Israel is UTC+2 (standard) / +3 (DST). Use explicit offset for determinism.
  const m1 = toEpochMinutes("2026-07-20", "09:00", 180); // +3h (IDT)
  const m2 = toEpochMinutes("2026-07-20", "10:30", 180);
  assert.ok(m2 > m1);
  assert.equal(m2 - m1, 90); // 90 minutes apart, exactly
});

test("canBook returns conflicts payload for the UI", () => {
  const candidate = { technicianId: "t1", startMin: 620, endMin: 680 };
  const res = canBook(candidate, base);
  assert.equal(res.ok, false);
  assert.ok(res.error.length > 0);
  assert.equal(res.conflicts.length, 1);
});
