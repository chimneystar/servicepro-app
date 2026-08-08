// Scheduled / emailed reports (ledger 6c.9). Plain ESM.
//
// WHY THIS EXISTS
// ---------------
// Every number in this product required somebody to log in and look at it. A
// business owner who is on a roof all day never sees them.
//
// THE ONE RULE THAT MATTERS HERE: this module contains NO revenue arithmetic of
// its own. `digestTotals` is a thin call into `periodTotals` from
// lib/core/reporting.mjs. Three screens each had their own inline copy of that
// arithmetic and all three were wrong in the same two ways; a fourth copy
// living in an email nobody cross-checks would be the worst of the four,
// because a wrong figure in an inbox is trusted and never reconciled.
// tests/scheduled-reports.test.mjs asserts, on the source with comments
// stripped, that this file performs no multiplication, no tax and no margin —
// it only formats what reporting.mjs returned.
//
// Tests: tests/scheduled-reports.test.mjs

import { periodTotals } from "./reporting.mjs";

export const DIGEST_FREQUENCIES = Object.freeze(["daily", "weekly", "monthly"]);

/**
 * @param {unknown} value
 * @returns {value is "daily" | "weekly" | "monthly"} Declared as a type guard so
 * a TypeScript caller that has already run this check can write the frequency
 * into `report_schedules.frequency`, whose CHECK constraint the generated
 * database types express as this same union. Annotation only — the test itself
 * is unchanged.
 */
export function isDigestFrequency(value) {
  return DIGEST_FREQUENCIES.includes(String(value ?? ""));
}

const day = (value) => String(value ?? "").slice(0, 10);

function shiftDays(dayISO, days) {
  const base = new Date(`${dayISO}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) throw new TypeError(`invalid date: ${dayISO}`);
  return new Date(base.getTime() + days * 86400000).toISOString().slice(0, 10);
}

/**
 * The period a digest sent on `todayISO` covers — always CLOSED and in the
 * past. A "yesterday" digest is a complete day; a digest of today-so-far would
 * change every time it ran and could never be reconciled against the screen.
 */
export function digestPeriod(todayISO, frequency) {
  const today = day(todayISO);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new TypeError(`invalid date: ${todayISO}`);
  if (!isDigestFrequency(frequency)) throw new TypeError(`unknown frequency: ${frequency}`);

  if (frequency === "daily") {
    const d = shiftDays(today, -1);
    return { start: d, end: d, label: d, key: `daily:${d}` };
  }
  if (frequency === "weekly") {
    // The seven days ending yesterday. Deliberately not "since Monday", which
    // would make the first run after switching it on a partial, misleading week.
    const end = shiftDays(today, -1);
    const start = shiftDays(end, -6);
    return { start, end, label: `${start} → ${end}`, key: `weekly:${end}` };
  }
  // Last complete calendar month, whichever day of this month it is run on.
  const firstOfThisMonth = `${today.slice(0, 7)}-01`;
  const end = shiftDays(firstOfThisMonth, -1);
  const start = `${end.slice(0, 7)}-01`;
  return { start, end, label: end.slice(0, 7), key: `monthly:${end.slice(0, 7)}` };
}

/**
 * Is this schedule due tonight?
 *
 * `last_period_key` is the claim, not a timestamp: a cron that runs twice, or
 * that was down for a week and catches up, must send exactly one digest per
 * period. Comparing timestamps would send two on a retry and zero after a
 * clock skew.
 */
export function isDigestDue(schedule, todayISO) {
  if (!schedule || schedule.enabled === false) return { due: false, reason: "disabled" };
  if (!isDigestFrequency(schedule.frequency)) return { due: false, reason: "unknown_frequency" };
  const period = digestPeriod(todayISO, schedule.frequency);
  if (String(schedule.last_period_key ?? "") === period.key)
    return { due: false, reason: "already_sent", period };
  if (schedule.starts_on && day(schedule.starts_on) > period.end)
    return { due: false, reason: "not_started", period };
  return { due: true, reason: "", period };
}

/**
 * The figures. A pass-through to the shared reporting engine, on purpose.
 * If this function ever grows an operator, the structural test fails.
 */
export function digestTotals(input) {
  return periodTotals(input);
}

/**
 * Render the digest.
 *
 * `format` is injected (the caller owns `money()` and the org currency) so this
 * module never divides by 100 — which is the smallest possible way to end up
 * with a fifth copy of the money arithmetic.
 */
export function renderDigest({
  totals,
  counts = {},
  period,
  orgName = "",
  locale = "en",
  format,
  reportUrl = "",
}) {
  if (typeof format !== "function") throw new TypeError("renderDigest needs a format function");
  const he = locale === "he";
  const m = (value) => format(value);

  const rows = [
    [he ? "נגבה" : "Collected", m(totals.collectedMinor)],
    [he ? "הכנסה (ללא מס)" : "Revenue (ex-tax)", m(totals.revenueExTaxMinor)],
    [he ? "רווח גולמי" : "Gross profit", m(totals.grossProfitMinor)],
    [he ? "הוצאות" : "Expenses", m(totals.expensesMinor)],
    [he ? "רווח נקי" : "Net profit", m(totals.netProfitMinor)],
  ];
  if (counts.openInvoices !== undefined) {
    rows.push([he ? "חשבוניות פתוחות" : "Open invoices", `${counts.openInvoices}`]);
  }
  if (counts.outstandingMinor !== undefined) {
    rows.push([he ? "יתרה לגבייה" : "Outstanding", m(counts.outstandingMinor)]);
  }
  if (counts.jobsCompleted !== undefined) {
    rows.push([he ? "עבודות שהושלמו" : "Jobs completed", `${counts.jobsCompleted}`]);
  }

  const heading = he
    ? `סיכום ${orgName} · ${period.label}`
    : `${orgName} summary · ${period.label}`;
  const body = [
    heading,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    reportUrl ? (he ? `הדוח המלא: ${reportUrl}` : `Full report: ${reportUrl}`) : "",
  ]
    .filter((line) => line !== null)
    .join("\n")
    .trimEnd();

  return {
    subject: `${heading}`,
    body,
    rows,
  };
}
