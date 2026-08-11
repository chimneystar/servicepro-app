// Customer statements and the dunning ladder (ledger 6c.6). Plain ESM.
//
// WHY THIS EXISTS
// ---------------
// Collections was ONE weekly overdue SMS per invoice, for ever, at the same
// volume on day 15 as on day 400, and there was no way to answer the question a
// customer with six open invoices actually asks: "what do I owe you in total?"
//
// Two things live here, both pure:
//
//   1. THE STATEMENT — opening balance, the activity in the period, the closing
//      balance and the aging split. Every money figure is an integer in minor
//      units, and the cash side is computed by `collectedMinor` from
//      lib/core/reporting.mjs rather than re-summed here, because a statement
//      that disagrees with the revenue report is worse than no statement.
//
//   2. THE LADDER — a bounded escalation, one rung at a time, that ENDS. The
//      old nudge had no terminal state; this one does, so a business stops
//      texting somebody it has already sent to collections.
//
// Tests: tests/statements.test.mjs

import { collectedMinor } from "./reporting.mjs";

const finite = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const dayISO = (value) => String(value ?? "").slice(0, 10);

/** Whole days between two ISO dates, UTC-anchored so no timezone can shift it. */
export function daysBetween(fromISO, toISO) {
  const a = new Date(`${dayISO(fromISO)}T00:00:00.000Z`).getTime();
  const b = new Date(`${dayISO(toISO)}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b))
    throw new TypeError(`invalid date range: ${fromISO}..${toISO}`);
  return Math.round((b - a) / 86400000);
}

/**
 * Invoice statuses that represent a real charge on the account.
 *
 * A draft has not been issued and a void has been withdrawn; putting either on
 * a statement bills a customer for something nobody sent them.
 */
export const CHARGEABLE_INVOICE_STATUSES = Object.freeze(["unpaid", "paid", "overdue"]);

export function isChargeable(invoice) {
  return (
    CHARGEABLE_INVOICE_STATUSES.includes(String(invoice?.status ?? "")) && !invoice?.deleted_at
  );
}

/** The aging buckets, in order. `max: null` is the open-ended tail. */
export const AGING_BUCKETS = Object.freeze([
  { key: "current", label: "Current", min: 0, max: 30 },
  { key: "d31_60", label: "31–60 days", min: 31, max: 60 },
  { key: "d61_90", label: "61–90 days", min: 61, max: 90 },
  { key: "d90_plus", label: "90+ days", min: 91, max: null },
]);

/** Which bucket an age in days falls in. Negative ages (not yet due) are `current`. */
export function agingBucket(days) {
  const age = Math.max(0, Math.trunc(finite(days)));
  for (const bucket of AGING_BUCKETS) {
    if (age >= bucket.min && (bucket.max === null || age <= bucket.max)) return bucket.key;
  }
  return "d90_plus";
}

/**
 * Build one customer's statement.
 *
 * `invoices` — every invoice for the customer up to `asOf` (charges).
 * `payments` — every payment row for those invoices up to `asOf` (credits).
 *              Filtered and netted by `collectedMinor`, so a failed card, a
 *              refund and a surcharge are all handled the same way the revenue
 *              report handles them.
 * `since`    — start of the detail window. Anything before it is folded into
 *              the opening balance rather than dropped, so the closing balance
 *              is always the whole truth even on a one-month statement.
 */
export function buildStatement({ invoices, payments, asOf, since = null }) {
  const asOfDay = dayISO(asOf);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDay)) throw new TypeError(`invalid asOf: ${asOf}`);
  const sinceDay = since ? dayISO(since) : null;

  const charges = (invoices ?? [])
    .filter(isChargeable)
    .filter((i) => dayISO(i.issue_date) <= asOfDay);
  const chargeIds = new Set(charges.map((i) => String(i.id)));

  const credits = (payments ?? []).filter((p) => {
    const day = dayISO(p?.paid_at);
    if (!day || day > asOfDay) return false;
    // A payment against an invoice that is not on this statement (deleted,
    // draft, another customer) must not silently reduce this balance.
    return !p?.invoice_id || chargeIds.has(String(p.invoice_id));
  });

  const inWindow = (day) => !sinceDay || day >= sinceDay;

  let openingMinor = 0;
  const lines = [];

  for (const invoice of charges) {
    const day = dayISO(invoice.issue_date);
    const amount = finite(invoice.total_minor);
    if (inWindow(day)) {
      lines.push({
        date: day,
        kind: "invoice",
        reference: String(invoice.number ?? ""),
        invoiceId: String(invoice.id),
        description: `Invoice #${invoice.number ?? ""}`.trim(),
        chargeMinor: amount,
        creditMinor: 0,
      });
    } else {
      openingMinor += amount;
    }
  }

  for (const payment of credits) {
    const day = dayISO(payment.paid_at);
    // One payment at a time, so the collected rule is applied per row and a
    // non-settled row contributes exactly nothing.
    const amount = collectedMinor([payment]);
    if (amount === 0) continue;
    if (inWindow(day)) {
      lines.push({
        date: day,
        kind: "payment",
        reference: String(payment.reference ?? payment.method ?? ""),
        invoiceId: payment.invoice_id ? String(payment.invoice_id) : null,
        description: `Payment${payment.method ? ` (${payment.method})` : ""}`,
        chargeMinor: 0,
        creditMinor: amount,
      });
    } else {
      openingMinor -= amount;
    }
  }

  lines.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === "invoice" ? -1 : 1,
  );

  let running = openingMinor;
  for (const line of lines) {
    running += line.chargeMinor - line.creditMinor;
    line.balanceMinor = running;
  }

  const chargesMinor = lines.reduce((sum, l) => sum + l.chargeMinor, 0);
  const paymentsMinor = lines.reduce((sum, l) => sum + l.creditMinor, 0);
  const balanceMinor = openingMinor + chargesMinor - paymentsMinor;

  // Aging is per OPEN invoice, not per statement line: a customer can be 100
  // days late on one invoice and current on another, and a single number hides
  // exactly the invoice that needs chasing.
  const aging = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0]));
  const open = [];
  let oldestDays = 0;
  for (const invoice of charges) {
    const paidForInvoice = collectedMinor(
      credits.filter((p) => String(p.invoice_id ?? "") === String(invoice.id)),
    );
    const outstanding = finite(invoice.total_minor) - paidForInvoice;
    if (outstanding <= 0) continue;
    const age = daysBetween(invoice.issue_date, asOfDay);
    aging[agingBucket(age)] += outstanding;
    oldestDays = Math.max(oldestDays, age);
    open.push({
      invoiceId: String(invoice.id),
      number: invoice.number ?? null,
      issueDate: dayISO(invoice.issue_date),
      ageDays: age,
      outstandingMinor: outstanding,
    });
  }
  open.sort((a, b) => b.ageDays - a.ageDays);

  return {
    asOf: asOfDay,
    since: sinceDay,
    openingMinor,
    chargesMinor,
    paymentsMinor,
    balanceMinor,
    lines,
    aging,
    openInvoices: open,
    oldestDays,
    // `pastDueMinor` deliberately excludes the current bucket: it is the number
    // a collections decision is made on.
    pastDueMinor: aging.d31_60 + aging.d61_90 + aging.d90_plus,
  };
}

// ---------------------------------------------------------------------
//  The dunning ladder.
// ---------------------------------------------------------------------

/**
 * Four rungs, then it stops.
 *
 * `afterDays` is measured from the invoice issue date, matching the 14-day
 * definition of "past due" that PAST_DUE_AFTER_DAYS and the existing overdue
 * nudge already use, so nothing in the product disagrees about when a customer
 * is late. Each rung names its channel; email is preferred where a longer,
 * itemised message helps and SMS where urgency does.
 */
/**
 * The stage and channel names are the values `dunning_events.stage` and
 * `.channel` allow (CHECK constraints, migration 040), so they are annotated as
 * those literals rather than as `string`. `lib/cron-tasks.ts` writes
 * `rung.stage` and `rung.channel` straight into those columns; inferred as
 * `string` the write does not compile, and a rung renamed here without the
 * migration would otherwise fail at the database instead of at the build.
 *
 * @type {readonly {
 *   stage: "reminder" | "overdue" | "second_notice" | "final_notice",
 *   afterDays: number,
 *   channel: "email" | "sms",
 *   severity: number,
 * }[]}
 */
export const DUNNING_LADDER = Object.freeze([
  { stage: "reminder", afterDays: 7, channel: "email", severity: 1 },
  { stage: "overdue", afterDays: 14, channel: "sms", severity: 2 },
  { stage: "second_notice", afterDays: 30, channel: "email", severity: 3 },
  { stage: "final_notice", afterDays: 45, channel: "email", severity: 4 },
]);

export const DUNNING_STAGES = Object.freeze(DUNNING_LADDER.map((rung) => rung.stage));

export function dunningRung(stage) {
  return DUNNING_LADDER.find((rung) => rung.stage === stage) ?? null;
}

/**
 * The ONE rung to fire tonight for this invoice, or null.
 *
 * Three properties, each of which is a bug that has happened to somebody:
 *
 *  - It returns the HIGHEST rung the age has earned, not the lowest unsent one.
 *    Switching this feature on against a book of 300-day-old invoices sends one
 *    final notice each, not four escalating messages in four nights.
 *  - It never repeats a rung: `sentStages` is terminal, per invoice.
 *  - It never goes BACKWARDS. Once a final notice has gone out, an earlier rung
 *    is not offered again even if it was somehow never sent.
 *
 * @param {{ageDays: number, outstandingMinor: number}} invoice
 * @param {string[]} sentStages
 */
export function nextDunningStage(invoice, sentStages = []) {
  const outstanding = finite(invoice?.outstandingMinor);
  if (outstanding <= 0) return null;
  const age = Math.trunc(finite(invoice?.ageDays));

  const sent = new Set((sentStages ?? []).map(String));
  const highestSent = DUNNING_LADDER.filter((rung) => sent.has(rung.stage)).reduce(
    (max, rung) => Math.max(max, rung.severity),
    0,
  );

  const earned = DUNNING_LADDER.filter((rung) => age >= rung.afterDays);
  if (!earned.length) return null;
  const due = earned[earned.length - 1];
  if (due.severity <= highestSent) return null;
  return due;
}

/** The claim key for one rung against one invoice. Unique per (invoice, stage). */
export function dunningKey(invoiceId, stage) {
  const id = String(invoiceId ?? "").trim();
  if (!id) throw new TypeError("dunningKey needs an invoice id");
  if (!DUNNING_STAGES.includes(String(stage)))
    throw new TypeError(`unknown dunning stage: ${stage}`);
  return `${id}:${stage}`;
}

/**
 * The message for one rung. Plain text; the email path wraps it in escaped HTML
 * upstream, exactly as the automation sender already does.
 */
export function dunningMessage({
  stage,
  locale = "en",
  firstName = "",
  businessName = "",
  invoiceNumber = "",
  amountLabel = "",
  balanceLabel = "",
  link = "",
}) {
  const rung = dunningRung(stage);
  if (!rung) throw new TypeError(`unknown dunning stage: ${stage}`);
  const he = locale === "he";
  const name = String(firstName ?? "").trim();
  const hi = he ? (name ? `שלום ${name},` : "שלום,") : name ? `Hi ${name},` : "Hello,";
  const number = String(invoiceNumber ?? "");
  const where = link
    ? he
      ? ` ניתן לצפות ולשלם כאן: ${link}`
      : ` You can view and pay it here: ${link}`
    : "";

  const bodies = {
    reminder: he
      ? `${hi} תזכורת ידידותית מ${businessName}: חשבונית #${number} על סך ${amountLabel} ממתינה לתשלום.${where} תודה!`
      : `${hi} a friendly reminder from ${businessName}: invoice #${number} for ${amountLabel} is awaiting payment.${where} Thank you!`,
    overdue: he
      ? `${hi} חשבונית #${number} (${amountLabel}) מ${businessName} באיחור.${where} נשמח לעדכון.`
      : `${hi} invoice #${number} (${amountLabel}) from ${businessName} is now past due.${where} Please let us know if there is a problem.`,
    second_notice: he
      ? `${hi} חשבונית #${number} מ${businessName} טרם שולמה. היתרה הפתוחה בחשבונך היא ${balanceLabel}.${where} אנא צרו קשר אם יש שאלה.`
      : `${hi} invoice #${number} from ${businessName} is still unpaid. The open balance on your account is ${balanceLabel}.${where} Please get in touch if something is wrong.`,
    final_notice: he
      ? `${hi} זוהי הודעה אחרונה בנוגע לחשבונית #${number} מ${businessName}. היתרה הפתוחה היא ${balanceLabel}.${where} אם לא נשמע מכם, החוב יועבר לטיפול גבייה.`
      : `${hi} this is a final notice regarding invoice #${number} from ${businessName}. The open balance is ${balanceLabel}.${where} If we do not hear from you, the account will be passed for collection.`,
  };

  const subjects = {
    reminder: he ? `תזכורת — חשבונית #${number}` : `Reminder — invoice #${number}`,
    overdue: he ? `חשבונית #${number} באיחור` : `Invoice #${number} is past due`,
    second_notice: he ? `הודעה שנייה — חשבונית #${number}` : `Second notice — invoice #${number}`,
    final_notice: he ? `הודעה אחרונה — חשבונית #${number}` : `Final notice — invoice #${number}`,
  };

  return {
    channel: rung.channel,
    subject: `${subjects[stage]} · ${businessName}`.trim(),
    body: bodies[stage],
  };
}

/** The covering note that goes out with a statement. */
export function statementMessage({
  locale = "en",
  firstName = "",
  businessName = "",
  balanceLabel = "",
  asOf = "",
  link = "",
}) {
  const he = locale === "he";
  const name = String(firstName ?? "").trim();
  const hi = he ? (name ? `שלום ${name},` : "שלום,") : name ? `Hi ${name},` : "Hello,";
  const where = link ? (he ? ` פירוט מלא: ${link}` : ` The full statement is here: ${link}`) : "";
  return {
    subject: he
      ? `דף חשבון ל-${asOf} · ${businessName}`
      : `Account statement as of ${asOf} · ${businessName}`,
    body: he
      ? `${hi} מצורף דף החשבון שלך מ${businessName} נכון ל-${asOf}. היתרה הפתוחה: ${balanceLabel}.${where} תודה!`
      : `${hi} here is your account statement from ${businessName} as of ${asOf}. Open balance: ${balanceLabel}.${where} Thank you!`,
  };
}
