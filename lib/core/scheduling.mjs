// =====================================================================
//  scheduling.mjs — appointment integrity. Two guarantees:
//    1. A technician can never be double-booked (overlap detection here,
//       AND a hard database exclusion constraint as a second line of defence).
//    2. Appointments never silently disappear: they are never hard-deleted;
//       they move through a controlled set of statuses, and every change is
//       written to the audit log. Cancelled appointments are kept.
//
//  Times are integer "epoch minutes" (minutes since 1970-01-01T00:00Z) so
//  there is no timezone or floating-point ambiguity in the core logic.
// =====================================================================

export const JOB_STATUSES = ["scheduled", "in_progress", "done", "cancelled"];

// Which status changes are allowed. Anything not listed is rejected.
const ALLOWED_TRANSITIONS = {
  scheduled:   ["in_progress", "done", "cancelled", "scheduled"], // reschedule keeps 'scheduled'
  in_progress: ["done", "cancelled", "in_progress"],
  done:        [],            // terminal — cannot be reopened (create a new job instead)
  cancelled:   [],            // terminal
};

/** True if two time intervals overlap. End is EXCLUSIVE (back-to-back is OK). */
export function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/** Validate a single appointment's time window. Returns {ok, error}. */
export function validateInterval(startMin, endMin, { maxDurationMin = 24 * 60 } = {}) {
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin))
    return { ok: false, error: "זמנים חייבים להיות מספרים שלמים (דקות)" };
  if (endMin <= startMin)
    return { ok: false, error: "שעת הסיום חייבת להיות אחרי שעת ההתחלה" };
  if (endMin - startMin > maxDurationMin)
    return { ok: false, error: "משך העבודה ארוך מדי" };
  return { ok: true };
}

/**
 * Find scheduling conflicts for a candidate appointment against existing ones.
 * A conflict = same technician, overlapping time, not cancelled, not the same
 * appointment (so editing an appointment doesn't conflict with itself).
 * @param {{id?:string, technicianId:string, startMin:number, endMin:number}} candidate
 * @param {Array<{id:string, technicianId:string, startMin:number, endMin:number, status:string}>} existing
 * @returns {Array} the conflicting appointments (empty = free to book)
 */
export function findConflicts(candidate, existing) {
  if (candidate.technicianId == null) return []; // unassigned jobs can't double-book a tech
  return existing.filter((e) =>
    e.id !== candidate.id &&
    e.technicianId === candidate.technicianId &&
    e.status !== "cancelled" &&
    intervalsOverlap(candidate.startMin, candidate.endMin, e.startMin, e.endMin)
  );
}

/** Full check before booking/rescheduling. Returns {ok, error?, conflicts?}. */
export function canBook(candidate, existing, opts) {
  const v = validateInterval(candidate.startMin, candidate.endMin, opts);
  if (!v.ok) return { ok: false, error: v.error };
  const conflicts = findConflicts(candidate, existing);
  if (conflicts.length > 0)
    return { ok: false, error: "הטכנאי כבר משובץ בזמן הזה", conflicts };
  return { ok: true };
}

/** Is a status change allowed? */
export function canTransition(from, to) {
  if (!JOB_STATUSES.includes(from) || !JOB_STATUSES.includes(to)) return false;
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Convert a calendar date + HH:MM (local) to epoch minutes, given a tz offset in minutes. */
export function toEpochMinutes(dateISO, hhmm, tzOffsetMin = 0) {
  const [h, m] = hhmm.split(":").map(Number);
  const [Y, Mo, D] = dateISO.split("-").map(Number);
  const utcMs = Date.UTC(Y, Mo - 1, D, h, m) - tzOffsetMin * 60000;
  return Math.floor(utcMs / 60000);
}
