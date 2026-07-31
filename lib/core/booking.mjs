// Pure online-booking logic. Plain ESM so `node --test` can execute it directly,
// matching lib/core/money.mjs, scheduling.mjs and calls.mjs.
//
// COUPLING: lib/booking.ts re-exports everything here and adds the TypeScript
// types. Change this file, not that one. Tests: tests/booking.test.mjs.

export function normalizePhone(value) {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
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

export function buildBookingSlots(input) {
  const now = input.now ?? new Date();
  const day = new Date(`${input.date}T12:00:00`);
  if (Number.isNaN(day.valueOf())) return [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAhead = Math.round((day.getTime() - today.getTime()) / 864e5);
  if (daysAhead < 0 || daysAhead > input.maxDaysAhead) return [];
  const isoDay = day.getDay() === 0 ? 7 : day.getDay();
  const open = input.hours[String(isoDay)];
  if (!open) return [];
  const start = toMinutes(open[0]);
  const close = toMinutes(open[1]);
  if (start === null || close === null || close <= start) return [];

  const earliest = now.getTime() + input.minNoticeHours * 3600_000;
  const busy = input.busy
    .map((row) => ({ start: toMinutes(row.start), end: toMinutes(row.end) }))
    .filter((row) => row.start !== null && row.end !== null);

  const slots = [];
  for (let cursor = start; cursor + input.durationMin <= close; cursor += input.intervalMin) {
    const slotDate = new Date(`${input.date}T${hhmm(cursor)}:00`);
    if (slotDate.getTime() < earliest) continue;
    const overlap = busy.filter((row) => cursor < row.end && cursor + input.durationMin > row.start).length;
    if (overlap >= Math.max(1, input.capacity)) continue;
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

/** Back-compat boolean wrapper. Unevaluable (polygon-only) accepts, as before. */
export function matchesServiceArea(postalCode, city, areas) {
  return evaluateServiceArea(postalCode, city, areas) !== "outside";
}

export function createBookingReference() {
  return `SP-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}
