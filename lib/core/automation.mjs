// Automation-rule decision logic. Plain ESM so `node --test` executes it.
//
// `automation_rules` has stored trigger_type / action_type / action_json since
// migration 019 and NOTHING has ever executed a rule: /operations let an owner
// build an automation that could never fire. This module holds the three
// decisions that make an executor safe, so each can be proven in both
// directions before any provider is called:
//
//   1. which trigger/action pairs are genuinely implemented (the rest are
//      refused at CREATION time, not accepted and ignored);
//   2. which source rows are inside the rule's firing window (so switching a
//      rule on cannot text five years of finished jobs);
//   3. what to do with an existing automation_runs row (claim / retry / skip),
//      which is the idempotency guarantee.
//
// Tests: tests/automation.test.mjs

export const AUTOMATION_TRIGGERS = Object.freeze(["job_completed", "estimate_sent", "invoice_overdue"]);
export const AUTOMATION_ACTIONS = Object.freeze(["send_sms", "send_email", "create_task"]);

/**
 * The support matrix, and the reason for every gap.
 *
 * `create_task` writes a `job_tasks` row (db/007_v9.sql), which is NOT NULL on
 * job_id and is only ever rendered on /jobs/[id]. A sent estimate has no job at
 * all — `estimates` has no job_id column — and `invoices.job_id` is nullable, so
 * for those two triggers the task would have nowhere to live and nobody to show
 * it to. Rather than create rules that fire into a void, those pairs are
 * refused when the rule is created.
 */
export const SUPPORTED_AUTOMATIONS = Object.freeze({
  job_completed: Object.freeze(["send_sms", "send_email", "create_task"]),
  estimate_sent: Object.freeze(["send_sms", "send_email"]),
  invoice_overdue: Object.freeze(["send_sms", "send_email"]),
});

/** Actions that put a message in front of a customer and therefore need consent. */
export const MESSAGE_ACTIONS = Object.freeze(["send_sms", "send_email"]);

/** How far back a newly enabled rule may reach for source rows. */
export const AUTOMATION_LOOKBACK_DAYS = 2;
/** Attempts a failed run gets before it stops being retried every night. */
export const AUTOMATION_MAX_ATTEMPTS = 3;
/** Default age at which `invoice_overdue` considers an unpaid invoice due. */
export const DEFAULT_OVERDUE_DAYS = 14;

/**
 * Validate a rule before it is stored.
 *
 * @param {{triggerType?: string, actionType?: string, message?: string, overdueDays?: unknown}} input
 * @returns {{ok: true, rule: {triggerType: string, actionType: string, message: string, overdueDays: number}}
 *          | {ok: false, reason: string}}
 */
export function validateAutomationRule(input) {
  const triggerType = String(input?.triggerType ?? "").trim();
  const actionType = String(input?.actionType ?? "").trim();
  if (!AUTOMATION_TRIGGERS.includes(triggerType)) return { ok: false, reason: "unknown_trigger" };
  if (!AUTOMATION_ACTIONS.includes(actionType)) return { ok: false, reason: "unknown_action" };
  if (!SUPPORTED_AUTOMATIONS[triggerType].includes(actionType)) return { ok: false, reason: "unsupported_combination" };

  const message = String(input?.message ?? "").trim();
  // Every supported action needs text: a message body, or a task title.
  if (!message) return { ok: false, reason: "missing_message" };
  if (message.length > 1000) return { ok: false, reason: "message_too_long" };

  let overdueDays = DEFAULT_OVERDUE_DAYS;
  if (triggerType === "invoice_overdue" && input?.overdueDays !== undefined && input?.overdueDays !== "") {
    const parsed = Number(input.overdueDays);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) return { ok: false, reason: "invalid_overdue_days" };
    overdueDays = parsed;
  }
  return { ok: true, rule: { triggerType, actionType, message, overdueDays } };
}

/** Human-readable reason, English and Hebrew, for a refused rule. */
export function automationRefusalMessage(reason, he = false) {
  const messages = {
    unknown_trigger: [
      "That trigger isn't one this app can watch for.",
      "הטריגר הזה לא נתמך.",
    ],
    unknown_action: [
      "That action isn't one this app can perform.",
      "הפעולה הזאת לא נתמכת.",
    ],
    unsupported_combination: [
      "\"Create task\" only works when a job is completed — an estimate or an invoice has no job to attach the task to. Choose Send SMS or Send email instead.",
      "\"יצירת משימה\" אפשרית רק כשעבודה הושלמה — להצעה או לחשבונית אין עבודה לשייך אליה משימה. אפשר לבחור SMS או אימייל.",
    ],
    missing_message: [
      "Write the message (or task title) this automation should produce.",
      "צריך לכתוב את ההודעה (או את שם המשימה) שהאוטומציה תיצור.",
    ],
    message_too_long: ["That message is too long.", "ההודעה ארוכה מדי."],
    invalid_overdue_days: [
      "Overdue days must be a whole number between 1 and 365.",
      "מספר ימי האיחור חייב להיות מספר שלם בין 1 ל-365.",
    ],
  };
  const pair = messages[reason] ?? ["That automation isn't supported.", "האוטומציה הזאת לא נתמכת."];
  return he ? pair[1] : pair[0];
}

/**
 * Earliest source-row timestamp a rule may act on.
 *
 * Two bounds, both load-bearing:
 *  - the rule's own creation time, so switching on "text every completed job"
 *    does not text every job the business has ever finished; and
 *  - a short lookback, so a cron that was down for a month does not wake up and
 *    send a month of back-dated messages in one burst.
 *
 * @param {string} ruleCreatedAt ISO timestamp
 * @param {string} now ISO timestamp
 * @param {number} lookbackDays
 * @returns {string} ISO timestamp
 */
export function automationWindowStart(ruleCreatedAt, now, lookbackDays = AUTOMATION_LOOKBACK_DAYS) {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError(`invalid now: ${now}`);
  const lookbackMs = nowMs - Number(lookbackDays) * 86400000;
  const createdMs = new Date(ruleCreatedAt).getTime();
  const startMs = Number.isFinite(createdMs) ? Math.max(createdMs, lookbackMs) : lookbackMs;
  return new Date(startMs).toISOString();
}

/**
 * The date an unpaid invoice becomes "overdue" for this rule: issue date plus
 * the configured age. Time-based eligibility cannot use updated_at — an invoice
 * nobody touches still becomes overdue.
 *
 * @param {string} issueDate YYYY-MM-DD
 * @param {number} overdueDays
 * @returns {string} YYYY-MM-DD
 */
export function overdueEventDate(issueDate, overdueDays) {
  const base = new Date(`${String(issueDate).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) throw new TypeError(`invalid issue date: ${issueDate}`);
  base.setUTCDate(base.getUTCDate() + Number(overdueDays));
  return base.toISOString().slice(0, 10);
}

/**
 * Is a time-based source row inside the window? Both bounds inclusive-ish:
 * on or after the window start, and not in the future.
 */
export function isWithinWindow(eventISO, windowStartISO, nowISO) {
  const event = new Date(eventISO).getTime();
  if (!Number.isFinite(event)) return false;
  return event >= new Date(windowStartISO).getTime() && event <= new Date(nowISO).getTime();
}

/**
 * What to do with the automation_runs row (if any) for a (rule, source) pair.
 *
 * This IS the idempotency guarantee, and the reason failures are recorded
 * instead of deleted: the run row is both the audit trail and the claim.
 *
 *  - no row            → 'claim'  (insert; a unique index makes the race safe)
 *  - succeeded/skipped → 'skip'   (terminal — never fire twice at one source)
 *  - failed, attempts left → 'retry' (re-claim by compare-and-set on 'failed')
 *  - failed, attempts spent → 'skip'
 *  - running/pending   → 'skip'   (see note)
 *
 * Note on 'running': a row stuck in 'running' means the process died between
 * claiming and finishing, and NOTHING can tell us whether the SMS went out.
 * Re-firing would risk texting a customer twice, so the run stays visible as
 * stuck and the executor logs it loudly instead of guessing.
 *
 * @param {{status?: string, attempts?: number}|null|undefined} run
 * @param {number} maxAttempts
 * @returns {"claim"|"retry"|"skip"}
 */
export function nextRunAction(run, maxAttempts = AUTOMATION_MAX_ATTEMPTS) {
  if (!run) return "claim";
  const status = String(run.status ?? "");
  if (status === "failed") {
    const attempts = Number(run.attempts ?? 0);
    return attempts < maxAttempts ? "retry" : "skip";
  }
  return "skip";
}

/** True when a claimed run has been sitting unfinished long enough to report. */
export function isStaleRun(run, nowISO, staleHours = 6) {
  if (!run || String(run.status ?? "") !== "running") return false;
  const started = new Date(run.created_at ?? 0).getTime();
  if (!Number.isFinite(started)) return false;
  return new Date(nowISO).getTime() - started > staleHours * 3600000;
}
