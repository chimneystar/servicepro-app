// =====================================================================
//  availability.mjs — who is actually available, and when.
//
//  WHY THIS EXISTS (remediation plan 6c.3)
//  ---------------------------------------
//  The only availability inputs in the product were the organisation's business
//  hours and the jobs already on the calendar. Nothing anywhere knew that a
//  technician was on holiday, off sick or in training, so the public booking
//  calendar offered their slots and the dispatch board let a job be dropped on
//  them. A business discovered the clash on the morning.
//
//  WHAT THIS IS NOT. It never books, cancels or moves anything. It only REMOVES
//  availability, so it cannot become a route around the no-double-book
//  guarantee (`jobs_no_double_book` plus db/028_crew_double_book.sql): those
//  refuse overlaps at the database whatever this module says, and this module
//  refuses more, never less.
//
//  Times are the business's own wall clock, 'HH:MM', matching
//  `booking_settings.hours_json` and `jobs.start_time`. Dates are 'YYYY-MM-DD'
//  strings, compared lexicographically — no Date is constructed, so no server
//  timezone can move a day boundary (the defect 4.8 had to fix in booking.mjs).
//
//  Tests: tests/availability.test.mjs
// =====================================================================

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Minutes past midnight for 'HH:MM' / 'HH:MM:SS'; null when absent. */
export function timeToMinutes(value) {
  if (value == null || value === "") return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value));
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number.isFinite(minutes) ? minutes : null;
}

/** Only approved absence removes availability. A request is not an absence. */
export function isEffective(row) {
  return String(row?.status ?? "approved") === "approved";
}

/** Does a time-off row cover this calendar day at all? */
export function coversDay(row, day) {
  if (!DAY.test(String(day))) throw new Error(`invalid date: ${day}`);
  if (!isEffective(row)) return false;
  const from = String(row?.starts_on ?? row?.startsOn ?? "").slice(0, 10);
  const to = String(row?.ends_on ?? row?.endsOn ?? from).slice(0, 10);
  if (!DAY.test(from) || !DAY.test(to)) return false;
  return from <= day && day <= to;
}

/**
 * The windows a row blocks on a given day, in wall-clock minutes.
 *
 * An all-day row (no start/end time) blocks the whole day, expressed as
 * 0..1440 rather than as a special case, so every downstream overlap test is
 * the same arithmetic.
 */
export function rowWindow(row) {
  const start = timeToMinutes(row?.start_time ?? row?.startTime);
  const end = timeToMinutes(row?.end_time ?? row?.endTime);
  if (start === null || end === null || end <= start)
    return { start: 0, end: 24 * 60, allDay: true };
  return { start, end, allDay: false };
}

const profileOf = (row) => row?.profile_id ?? row?.profileId ?? null;

/**
 * Split a day's time-off rows into the two things a calendar needs to know.
 *
 *   closedWindows — the BUSINESS is shut (a row with no profile_id: the public
 *                   holiday case). Nothing can be booked in these windows at
 *                   any capacity.
 *   awayWindows   — one entry per absent technician-window. Each one removes
 *                   exactly one unit of team capacity while it overlaps.
 *
 * Modelling a closure as "everyone is away" would be wrong: capacity is a count
 * of active technicians, and a business whose team list is stale would still
 * take bookings on Christmas Day.
 */
export function dayAvailability(rows, day) {
  const closedWindows = [];
  const awayWindows = [];
  const awayProfileIds = [];
  for (const row of rows ?? []) {
    if (!coversDay(row, day)) continue;
    const window = rowWindow(row);
    const profileId = profileOf(row);
    if (profileId === null) {
      closedWindows.push(window);
    } else {
      awayWindows.push({ ...window, profileId });
      if (!awayProfileIds.includes(profileId)) awayProfileIds.push(profileId);
    }
  }
  return { closedWindows, awayWindows, awayProfileIds };
}

/**
 * Is this technician off during [startTime, endTime) on this day?
 *
 * `startTime`/`endTime` may be omitted, which asks the whole-day question — the
 * right question for a job with no times on it, because an untimed job could be
 * worked at any hour of a day the technician is not there for.
 */
export function isProfileOff(rows, profileId, day, startTime, endTime) {
  const { closedWindows, awayWindows } = dayAvailability(rows, day);
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const hasSlot = start !== null && end !== null && end > start;
  const overlaps = (window) => (hasSlot ? start < window.end && window.start < end : true);
  if (closedWindows.some(overlaps)) return { off: true, reason: "closed" };
  const hit = awayWindows.find((window) => window.profileId === profileId && overlaps(window));
  if (hit) return { off: true, reason: hit.allDay ? "away" : "away_partial", window: hit };
  return { off: false };
}

/**
 * A sentence a dispatcher can act on, in the caller's language.
 * The generic "couldn't save" that every failure used to collapse into is the
 * thing item 4.10 was about; a scheduling refusal has to say what to do next.
 */
export function describeUnavailable(result, { locale = "en", name = "" } = {}) {
  if (!result?.off) return null;
  const he = locale === "he";
  if (result.reason === "closed") {
    return he
      ? "העסק סגור בתאריך הזה. שנו את התאריך או הסירו את יום הסגירה."
      : "The business is closed on that date. Change the date, or remove the closure.";
  }
  const who = name || (he ? "הטכנאי" : "That technician");
  if (result.reason === "away_partial" && result.window) {
    const from =
      String(Math.floor(result.window.start / 60)).padStart(2, "0") +
      ":" +
      String(result.window.start % 60).padStart(2, "0");
    const to =
      String(Math.floor(result.window.end / 60)).padStart(2, "0") +
      ":" +
      String(result.window.end % 60).padStart(2, "0");
    return he
      ? `${who} בחופשה בין ${from} ל-${to} בתאריך הזה.`
      : `${who} is off between ${from} and ${to} on that date.`;
  }
  return he ? `${who} בחופשה בתאריך הזה.` : `${who} is off on that date.`;
}

/**
 * Effective bookable capacity for a day: the team, minus whoever is away.
 *
 * Only whole-day absences reduce the day's headline capacity. Partial-day
 * absences are returned as windows and applied per slot, because a technician
 * away from 09:00 to 11:00 is available at 14:00 and pretending otherwise
 * would turn one dentist appointment into a closed afternoon.
 */
export function bookingCapacity({ teamSize, rows, day }) {
  const size = Math.max(0, Math.trunc(Number(teamSize) || 0));
  const { closedWindows, awayWindows } = dayAvailability(rows, day);
  const closedAllDay = closedWindows.some((window) => window.allDay);
  const awayAllDay = new Set(awayWindows.filter((w) => w.allDay).map((w) => w.profileId));
  return {
    capacity: closedAllDay ? 0 : Math.max(0, size - awayAllDay.size),
    closedAllDay,
    closedWindows: closedAllDay ? [] : closedWindows,
    awayWindows: awayWindows.filter((window) => !window.allDay),
  };
}
