// =====================================================================
//  job-costing.mjs — what a job actually cost, INCLUDING labour.
//
//  WHY THIS EXISTS (remediation plan 6c.2)
//  ---------------------------------------
//  Clock in / clock out has been collected since migration 009 and reached no
//  profit figure anywhere in the product. /reports computes gross profit as
//  revenue ex-tax minus the cost carried on the invoice lines; materials got
//  onto those lines in 5.11, labour never did. So every margin the owner has
//  ever been shown counted the technician's time as free — the single largest
//  cost in a field-service business.
//
//  All arithmetic here is integer minor units and integer minutes, for the same
//  reason lib/core/money.mjs is: this multiplies money.
//
//  Tests: tests/job-costing.test.mjs
// =====================================================================

const finite = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Round a non-negative integer division half-up with integer math. */
function divRoundHalfUp(numerator, denominator) {
  if (denominator <= 0) throw new Error("denominator must be > 0");
  const sign = numerator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  return sign * Math.floor((n + Math.floor(denominator / 2)) / denominator);
}

/**
 * Whole minutes a single time entry represents.
 *
 * An OPEN entry (no `ended_at`) contributes NOTHING. That is a decision, not an
 * omission: "now minus started_at" makes the cost of a job change every time
 * the page is refreshed, and a technician who forgets to clock out would
 * silently inflate the cost of the job for ever. Open entries are counted
 * separately and reported so the screen can say the figure is provisional.
 */
export function entryMinutes(entry) {
  if (!entry?.started_at || !entry?.ended_at) return 0;
  const start = new Date(entry.started_at).getTime();
  const end = new Date(entry.ended_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.floor((end - start) / 60000);
}

/** Closed minutes per technician, plus how many timers are still running. */
export function minutesByTechnician(entries) {
  const byTech = new Map();
  let openEntries = 0;
  for (const entry of entries ?? []) {
    if (entry?.started_at && !entry?.ended_at) {
      openEntries += 1;
      continue;
    }
    const minutes = entryMinutes(entry);
    if (minutes <= 0) continue;
    const key = entry.user_id ?? null;
    byTech.set(key, (byTech.get(key) ?? 0) + minutes);
  }
  return { byTech, openEntries };
}

/**
 * The hourly cost rate in force for a technician on a given day.
 *
 * Rates are effective-dated for a reason a flat column could not serve: a pay
 * rise in June must not retroactively re-cost March's finished jobs. The rule
 * is the same as `resolveTaxJurisdictions` — the latest rule whose start is on
 * or before the day, compared as 'YYYY-MM-DD' strings so no Date is built and
 * no timezone can shift the boundary.
 *
 * Returns `null` when the technician has NO applicable rate. Null is not zero:
 * zero would quietly report the labour as free, which is the defect being
 * repaired. Callers must surface it.
 */
export function resolvePayRate(rates, profileId, onDate) {
  const day = String(onDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`invalid date: ${onDate}`);
  let best = null;
  for (const raw of rates ?? []) {
    if ((raw.profile_id ?? raw.profileId) !== profileId) continue;
    const from = String(raw.effective_from ?? raw.effectiveFrom ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from > day) continue;
    if (!best || from > best.from) {
      best = { from, rate: finite(raw.cost_rate_minor ?? raw.costRateMinor) };
    }
  }
  return best ? best.rate : null;
}

/** Cost of `minutes` at an hourly rate, integer half-up. */
export function labourCostForMinutes(minutes, hourlyRateMinor) {
  const m = Math.max(0, Math.trunc(finite(minutes)));
  const rate = Math.max(0, Math.trunc(finite(hourlyRateMinor)));
  return divRoundHalfUp(m * rate, 60);
}

/**
 * Labour on one job: minutes, cost, and — deliberately — who could not be
 * priced.
 *
 * @param {Array} entries      job_time_entries rows
 * @param {Array} rates        technician_pay_rates rows
 * @param {string} onDate      the job's date, 'YYYY-MM-DD'
 */
export function jobLabour({ entries, rates, onDate }) {
  const { byTech, openEntries } = minutesByTechnician(entries);
  let minutes = 0;
  let costMinor = 0;
  const unpriced = [];
  for (const [profileId, mins] of byTech) {
    minutes += mins;
    const rate = resolvePayRate(rates, profileId, onDate);
    if (rate === null) {
      unpriced.push({ profileId, minutes: mins });
      continue;
    }
    costMinor += labourCostForMinutes(mins, rate);
  }
  return {
    minutes,
    costMinor,
    openEntries,
    unpriced,
    /** True when the number understates reality and the screen must say so. */
    incomplete: unpriced.length > 0 || openEntries > 0,
  };
}

/**
 * The job's profit and loss.
 *
 * `materialsCostMinor` is the sum of the line costs (5.11 put real part costs
 * there). `labourCostMinor` is this module's contribution. `expensesMinor` is
 * the hand-typed `jobs.job_expenses_minor`, kept separate so the owner can see
 * which part of the cost was measured and which part was typed.
 */
export function jobProfit({ revenueMinor, materialsCostMinor, labourCostMinor, expensesMinor }) {
  const revenue = finite(revenueMinor);
  const materials = Math.max(0, finite(materialsCostMinor));
  const labour = Math.max(0, finite(labourCostMinor));
  const expenses = Math.max(0, finite(expensesMinor));
  const cost = materials + labour + expenses;
  const profit = revenue - cost;
  return {
    revenueMinor: revenue,
    materialsCostMinor: materials,
    labourCostMinor: labour,
    expensesMinor: expenses,
    totalCostMinor: cost,
    profitMinor: profit,
    /**
     * Margin in basis points, or null when there is no revenue to divide by.
     * Null rather than 0 or Infinity: "no revenue yet" is not "0% margin", and
     * a screen that cannot tell the difference prints a lie.
     */
    marginBps: revenue > 0 ? divRoundHalfUp(profit * 10000, revenue) : null,
  };
}

/**
 * The invoice line that carries labour into the margin report.
 *
 * /reports (and lib/core/reporting.mjs materialsCostMinor) derives cost from
 * `invoice_items.cost_minor` and nothing else, so this is the ONE place labour
 * can reach the owner's gross-profit figure without a second reporting path.
 * The line is priced at ZERO — it is not an extra charge to the customer, the
 * labour is already inside the service price — and carries the cost, so
 * qty(1) * cost = the labour cost exactly.
 */
export function labourInvoiceLine({ minutes, costMinor, locale = "en" }) {
  const mins = Math.max(0, Math.trunc(finite(minutes)));
  const cost = Math.max(0, Math.trunc(finite(costMinor)));
  if (cost <= 0) return null;
  const hours = (mins / 60).toFixed(2);
  return {
    description:
      locale === "he"
        ? `עבודה (${hours} שעות) — כלול במחיר`
        : `Labour (${hours} h) — included in the price`,
    qty_milli: 1000,
    unit_price_minor: 0,
    cost_minor: cost,
    taxable: false,
  };
}

export const _internal = { divRoundHalfUp };
