// Pure online-booking logic. Plain ESM so `node --test` can execute it directly,
// matching lib/core/money.mjs, scheduling.mjs and calls.mjs.
//
// COUPLING: lib/booking.ts re-exports everything here and adds the TypeScript
// types. Change this file, not that one. Tests: tests/booking.test.mjs.

export function normalizePhone(value) {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

// ---------------------------------------------------------------------------
// Timezone. The business's wall clock is NOT the server's wall clock.
//
// Every instant below is a UTC epoch milliseconds number; every "date" and
// "HH:MM" is the business's local wall clock. Converting between the two used
// to be done with `new Date("2026-08-03T09:00:00")`, which the runtime resolves
// in the SERVER's zone — on Vercel that is UTC. A business in UTC-6 therefore
// got minimum-notice cutoffs six hours off and day boundaries on the wrong day,
// so customers were offered same-day slots that had already passed.
//
// Intl.DateTimeFormat is the only zone database in the runtime, and using it
// keeps the dependency count where it is deliberately kept (6 runtime deps).
// ---------------------------------------------------------------------------

/** US business deployment; matches the `booking_settings.timezone` DB default. */
export const DEFAULT_BOOKING_TIMEZONE = "America/New_York";

const formatterCache = new Map();

function formatterFor(timeZone) {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  // Throws RangeError on an unknown IANA name — that is how resolveTimeZone validates.
  // hourCycle h23 (not hour12:false) so midnight is hour 0, never hour 24.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** Validate an IANA zone name, falling back to the default rather than throwing. */
export function resolveTimeZone(timeZone) {
  const candidate = String(timeZone ?? "").trim();
  if (!candidate) return DEFAULT_BOOKING_TIMEZONE;
  try {
    formatterFor(candidate);
    return candidate;
  } catch {
    return DEFAULT_BOOKING_TIMEZONE;
  }
}

/** The business's wall-clock fields at a given instant. */
function zonedParts(instantMs, timeZone) {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const out = {};
  for (const part of parts) if (part.type !== "literal") out[part.type] = Number(part.value);
  return out;
}

/** Zone offset in ms at an instant (positive east of UTC). */
function zoneOffsetMs(instantMs, timeZone) {
  const whole = Math.floor(instantMs / 1000) * 1000;
  const parts = zonedParts(whole, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - whole;
}

/**
 * The instant at which the business's wall clock reads the given date+time.
 *
 * Two passes: the first estimates the offset from the naive UTC reading, the
 * second re-reads it at that estimate so a DST transition between the two
 * resolves correctly (the offset that applies is the one at the real instant,
 * not the one at the naive instant).
 */
function wallClockToInstant(year, month, day, hour, minute, timeZone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstPass = naive - zoneOffsetMs(naive, timeZone);
  return naive - zoneOffsetMs(firstPass, timeZone);
}

/** Days since the epoch for a civil date — zone-free once the date is known. */
function civilDayNumber(year, month, day) {
  return Math.round(Date.UTC(year, month - 1, day) / 864e5);
}

/** Strict YYYY-MM-DD parse that rejects impossible dates such as 2026-02-31. */
function parseDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** ISO weekday (1 = Monday … 7 = Sunday), matching the keys of `hours_json`. */
function isoWeekday(year, month, day) {
  return ((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1;
}

export function addMinutes(time, minutes) {
  const [hour, minute] = String(time).slice(0, 5).split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function toMinutes(time) {
  if (!time) return null;
  const [hour, minute] = String(time).slice(0, 5).split(":").map(Number);
  return Number.isFinite(hour + minute) ? hour * 60 + minute : null;
}

function hhmm(totalMinutes) {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

/**
 * Bookable arrival windows for one calendar day in the business's timezone.
 *
 * `input.timeZone` is the IANA name from `booking_settings.timezone`. `input.now`
 * is an injectable instant (Date or epoch ms) so the maths can be tested against
 * explicit zones instead of the machine's local time.
 *
 * TIME OFF (remediation plan 6c.3) enters through two OPTIONAL inputs, both
 * defaulting to empty so a caller that does not pass them gets byte-identical
 * results to before they existed:
 *
 *   `closedWindows` — the business is shut. Any overlap removes the slot at any
 *                     capacity; this is the public-holiday case.
 *   `awayWindows`   — one entry per absent technician-window. Each overlapping
 *                     entry removes one unit of capacity, exactly as an existing
 *                     job does, so a five-person team with two people on holiday
 *                     offers three concurrent slots rather than none or five.
 *
 * Whole-day absence is normally folded into `capacity` by
 * `bookingCapacity()` in lib/core/availability.mjs; these windows carry the
 * partial-day case, where somebody is at the dentist until 11:00 and available
 * all afternoon.
 */
export function buildBookingSlots(input) {
  const timeZone = resolveTimeZone(input.timeZone);
  const nowValue = input.now;
  const nowMs = nowValue instanceof Date ? nowValue.getTime() : typeof nowValue === "number" ? nowValue : Date.now();
  if (!Number.isFinite(nowMs)) return [];

  const target = parseDateOnly(input.date);
  if (!target) return [];

  // "Today" is today for the BUSINESS, not for the server.
  const todayThere = zonedParts(nowMs, timeZone);
  const daysAhead = civilDayNumber(target.year, target.month, target.day)
    - civilDayNumber(todayThere.year, todayThere.month, todayThere.day);
  if (daysAhead < 0 || daysAhead > input.maxDaysAhead) return [];

  const open = input.hours?.[String(isoWeekday(target.year, target.month, target.day))];
  if (!open) return [];
  const start = toMinutes(open[0]);
  const close = toMinutes(open[1]);
  if (start === null || close === null || close <= start) return [];

  const earliest = nowMs + input.minNoticeHours * 3600_000;
  const busy = (input.busy ?? [])
    .map((row) => ({ start: toMinutes(row.start), end: toMinutes(row.end) }))
    .filter((row) => row.start !== null && row.end !== null);
  const normalizeWindows = (rows) => (rows ?? [])
    .map((row) => ({
      start: typeof row.start === "number" ? row.start : toMinutes(row.start),
      end: typeof row.end === "number" ? row.end : toMinutes(row.end),
    }))
    .filter((row) => row.start !== null && row.end !== null && row.end > row.start);
  const closedWindows = normalizeWindows(input.closedWindows);
  const awayWindows = normalizeWindows(input.awayWindows);

  // A capacity of zero means nobody is working: the whole team is off, or the
  // business is closed. Returning an empty list here rather than falling into
  // the loop is what stops `Math.max(1, capacity)` below from quietly
  // resurrecting one bookable technician who does not exist.
  if (Number.isFinite(input.capacity) && input.capacity <= 0) return [];

  const slots = [];
  for (let cursor = start; cursor + input.durationMin <= close; cursor += input.intervalMin) {
    // The slot's real instant, resolved through the business's zone, so the
    // minimum-notice cutoff compares two points on the same timeline.
    const slotInstant = wallClockToInstant(
      target.year, target.month, target.day,
      Math.floor(cursor / 60), cursor % 60,
      timeZone,
    );
    if (slotInstant < earliest) continue;
    const slotEnd = cursor + input.durationMin;
    const hits = (row) => cursor < row.end && slotEnd > row.start;
    // Business closed for this window: no capacity can rescue it.
    if (closedWindows.some(hits)) continue;
    const overlap = busy.filter(hits).length;
    // Each technician away over this window is one fewer pair of hands, exactly
    // as an existing job is.
    const away = awayWindows.filter(hits).length;
    if (overlap + away >= Math.max(1, input.capacity)) continue;
    const startText = hhmm(cursor);
    const endText = addMinutes(startText, input.arrivalWindowMin);
    slots.push({ start: startText, end: endText, label: `${startText}–${endText}` });
  }
  return slots;
}

/**
 * Whether an address falls inside the organisation's service areas.
 *
 * Returns a tri-state so the caller can tell "no areas configured, accept" apart
 * from "areas are configured but none of them can be evaluated here". Polygon
 * areas need a geocoded point, which booking submission does not have — previously
 * a polygon-only organisation silently accepted every address while showing the
 * enforcement toggle as ON.
 *
 *   "match"        -> inside a configured area (or no areas configured)
 *   "outside"      -> areas configured and evaluated; the address is not in one
 *   "unevaluable"  -> only polygon areas exist; caller must decide (and should warn)
 */
export function evaluateServiceArea(postalCode, city, areas) {
  const active = (areas ?? []).filter((area) => area.active !== false);
  if (!active.length) return "match";

  const evaluable = active.filter((area) => area.area_type !== "polygon");
  if (!evaluable.length) return "unevaluable";

  const postal = String(postalCode ?? "").trim().toLowerCase();
  const normalizedCity = String(city ?? "").trim().toLowerCase();

  const hit = evaluable.some((area) => {
    const values = Array.isArray(area.values_json) ? area.values_json.map(String) : [];
    if (area.area_type === "zip") return values.some((value) => value.trim().toLowerCase() === postal);
    return values.some((value) => value.trim().toLowerCase() === normalizedCity);
  });
  return hit ? "match" : "outside";
}

/**
 * DEPRECATED — back-compat boolean wrapper; collapses "unevaluable" into accept.
 *
 * That collapse IS the defect: it is what let a polygon-only organisation show
 * the enforcement toggle as ON while accepting every address. Call
 * `evaluateServiceArea` and handle the third state explicitly. Kept only so the
 * old shape stays available; no booking path uses it.
 */
export function matchesServiceArea(postalCode, city, areas) {
  return evaluateServiceArea(postalCode, city, areas) !== "outside";
}

/**
 * Whether an organisation's configuration claims enforcement it cannot deliver.
 *
 * Polygon areas need a geocoded lat/lng for the customer's address. Nothing in
 * this product geocodes anything: `leads` and `customers` store address text
 * only, there is no PostGIS and no geocoding provider, and Operations creates a
 * "polygon" area by splitting a free-text box on commas — so the stored
 * `values_json` is not even coordinate pairs. Point-in-polygon is therefore not
 * implementable here; see docs/REMEDIATION-PLAN.md item 4.8.
 *
 * The settings screen uses this to tell the owner the truth instead of leaving
 * the toggle lying.
 */
export function serviceAreaEnforcementGaps(areas) {
  const active = (areas ?? []).filter((area) => area.active !== false);
  const polygons = active.filter((area) => area.area_type === "polygon").length;
  return {
    total: active.length,
    polygons,
    enforceable: active.length - polygons,
    /** Enforcement is configured but literally nothing can be checked. */
    unenforceable: active.length > 0 && polygons === active.length,
  };
}

export function createBookingReference() {
  return `SP-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}
