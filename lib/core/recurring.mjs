// ---------------------------------------------------------------------------
//  Recurring maintenance-plan date maths — pure, no I/O.
//
//  THE BUG THIS EXISTS TO PREVENT: both generators (the "Generate due" button
//  and the nightly cron) rolled `next_due` forward by exactly ONE interval,
//  regardless of how overdue the plan was. A plan two years past due was still
//  past due after generation, so every run created another back-dated job for
//  the same plan — silently, for ever.
//
//  Two things fix it, and both live here so the button and the cron cannot
//  drift apart again:
//    * nextDueAfter() advances the plan PAST today, however far behind it is;
//    * recurringJobKey() gives each (plan, occurrence) a stable identity that
//      the unique index on jobs(organization_id, external_source, external_id)
//      turns into real, database-enforced idempotency.
// ---------------------------------------------------------------------------

/** Value written to jobs.external_source by both recurring generators. */
export const RECURRING_JOB_SOURCE = "recurring_plan";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertISO(value, label) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    throw new TypeError(`${label}: expected a YYYY-MM-DD date, got ${JSON.stringify(value)}`);
  }
  return value;
}

const pad = (n, width = 2) => String(n).padStart(width, "0");

/** Days in a 1-indexed month, leap years included. */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Add whole months to an ISO date, clamping to the end of the target month.
 *
 * Date#setMonth overflows (31 Jan + 1 month becomes 3 March), which makes a
 * monthly plan drift later every single cycle. Clamping keeps it on the 31st
 * wherever the 31st exists.
 */
export function addMonthsISO(iso, months) {
  assertISO(iso, "addMonthsISO");
  const step = Math.trunc(Number(months));
  if (!Number.isFinite(step)) throw new TypeError(`addMonthsISO: months must be a number, got ${JSON.stringify(months)}`);
  const [year, month, day] = iso.split("-").map(Number);
  const absolute = year * 12 + (month - 1) + step;
  const outYear = Math.floor(absolute / 12);
  const outMonth = absolute - outYear * 12 + 1; // 1-12, correct for negatives too
  return `${pad(outYear, 4)}-${pad(outMonth)}-${pad(Math.min(day, daysInMonth(outYear, outMonth)))}`;
}

/** Whole months between two ISO dates, ignoring the day component. */
function monthsApart(from, to) {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** An interval the database would accept (recurring_plans.interval_months is 1-60). */
function safeInterval(intervalMonths) {
  const n = Math.trunc(Number(intervalMonths));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * The plan's next due date after generation: the first occurrence strictly
 * later than `today`, however many intervals that takes.
 *
 * A plan that is not yet due is returned untouched — catching up must never
 * push a healthy plan forward.
 */
export function nextDueAfter(nextDue, intervalMonths, today) {
  assertISO(nextDue, "nextDueAfter(nextDue)");
  assertISO(today, "nextDueAfter(today)");
  if (nextDue > today) return nextDue;
  const step = safeInterval(intervalMonths);
  // Jump straight to the right neighbourhood instead of looping month by month,
  // then step once or twice more for day-of-month clamping edges.
  let steps = Math.max(1, Math.ceil((monthsApart(nextDue, today) + 1) / step));
  let candidate = addMonthsISO(nextDue, steps * step);
  while (candidate <= today) {
    steps += 1;
    candidate = addMonthsISO(nextDue, steps * step);
  }
  return candidate;
}

/**
 * Stable identity for one occurrence of one plan, written to jobs.external_id.
 * Two runs over the same plan on the same due date produce the same key, so the
 * unique index refuses the second job instead of duplicating it.
 */
export function recurringJobKey(planId, dueDate) {
  const id = String(planId ?? "").trim();
  if (!id) throw new TypeError(`recurringJobKey: a plan id is required, got ${JSON.stringify(planId)}`);
  assertISO(dueDate, "recurringJobKey(dueDate)");
  return `${id}:${dueDate}`;
}
