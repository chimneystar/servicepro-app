// Date-window arithmetic for the list screens that used to load whole tables.
//
// THE BUG: /schedule selected every non-deleted job in the organisation with no
// date filter and no limit, and `components/Calendar.tsx` then threw away all
// but the visible week in JavaScript. /messages, /jobs and the owner dashboard
// had the same shape. Those queries do not get slower gradually — they get
// slower proportionally to how long the business has been trading, and then one
// day they time out.
//
// The fix is to ask Postgres for the visible period only. That needs two pieces
// of arithmetic that must agree exactly, or the calendar either re-fetches in a
// loop (window too small) or silently shows nothing for days it did not load:
//
//   fetchWindow(anchor)      — what the server loads for a given anchor date
//   visibleRange(anchor,view)— what the calendar actually renders
//
// The invariant `fetchWindow(a) ⊇ visibleRange(a, v)` for every view and every
// anchor is proven exhaustively in tests/query-window.test.mjs.
//
// Everything here is pure UTC-date string arithmetic ("YYYY-MM-DD"), because the
// database columns are `date`, not `timestamptz`, and because a pure module can
// be tested without a browser or a server.

const DAY_MS = 86400000;

/** Parse "YYYY-MM-DD" to a UTC timestamp. Throws on anything else. */
function parse(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!match) throw new RangeError(`not an ISO date: ${JSON.stringify(iso)}`);
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(ms)) throw new RangeError(`not an ISO date: ${JSON.stringify(iso)}`);
  return ms;
}

/** Format a UTC timestamp back to "YYYY-MM-DD". */
function format(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** True when `value` looks like a calendar date we can work with. */
export function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

/** Coerce untrusted input (a query string) to an ISO date, or fall back. */
export function toIsoDate(value, fallback) {
  if (!isIsoDate(value)) return fallback;
  // Reject impossible dates like 2026-02-31 that pass the shape test.
  return format(parse(value)) === value ? value : fallback;
}

/** Shift an ISO date by whole days. */
export function addDays(iso, days) {
  return format(parse(iso) + days * DAY_MS);
}

/** Shift an ISO date by whole months, clamping to the end of the target month. */
export function addMonths(iso, months) {
  const at = new Date(parse(iso));
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return format(Date.UTC(year, month, Math.min(at.getUTCDate(), lastDay)));
}

/** First day of the month containing `iso`. */
export function monthStart(iso) {
  const at = new Date(parse(iso));
  return format(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

/** Last day of the month containing `iso`. */
export function monthEnd(iso) {
  const at = new Date(parse(iso));
  return format(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0));
}

/** Sunday of the week containing `iso` — the calendar's week starts on Sunday. */
export function weekStart(iso) {
  const at = new Date(parse(iso));
  return format(parse(iso) - at.getUTCDay() * DAY_MS);
}

/**
 * The dates the calendar actually paints for a given anchor and view.
 *
 * The month view draws a fixed 6x7 grid starting on the Sunday on or before the
 * first of the month, so it can reach up to 6 days before the month and 41 days
 * after that Sunday — well outside the month itself.
 */
export function visibleRange(anchorIso, view) {
  if (view === "day") return { from: anchorIso, to: anchorIso };
  if (view === "week") {
    const from = weekStart(anchorIso);
    return { from, to: addDays(from, 6) };
  }
  const gridStart = weekStart(monthStart(anchorIso));
  return { from: gridStart, to: addDays(gridStart, 41) };
}

/**
 * The window the server loads for a given anchor.
 *
 * Padded by two weeks either side of the anchor's month so that every view of
 * that month — including the month grid's leading and trailing days — is served
 * from one fetch. See the exhaustive containment test.
 */
export function fetchWindow(anchorIso, padDays = 14) {
  return { from: addDays(monthStart(anchorIso), -padDays), to: addDays(monthEnd(anchorIso), padDays) };
}

/** True when `outer` fully contains `inner`. */
export function covers(outer, inner) {
  return outer.from <= inner.from && outer.to >= inner.to;
}

/**
 * How far back a rolling report should look, as an ISO date.
 * `today` is passed in rather than read from the clock so this stays pure.
 */
export function monthsBack(todayIso, months) {
  return addMonths(todayIso, -months);
}

/**
 * Did a `.limit(n)` query hit its ceiling?
 *
 * The point of asking is that the answer has to reach the screen. `/jobs`
 * truncated at 500 rows and said nothing, so the status tab counts and the
 * search box quietly disagreed with reality once a business passed 500 jobs.
 */
export function isTruncated(rowCount, limit) {
  return Number.isFinite(limit) && limit > 0 && (rowCount ?? 0) >= limit;
}

/**
 * Clamp a caller-supplied page size. Returns `fallback` for anything that is
 * not a positive integer, and never exceeds `max`.
 */
export function clampLimit(value, fallback, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}
