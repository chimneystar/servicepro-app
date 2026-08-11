// Outbound-contact eligibility. Plain ESM so `node --test` executes it directly.
//
// This module decides WHETHER a customer may be contacted on a channel. It is
// pure and separate because the rule it encodes is a legal one, not a
// preference: a customer who replied STOP (customers.sms_opt_in = false) or
// unsubscribed by email (email_opt_in = false) must never receive marketing.
// The reminder loops in lib/cron-tasks.ts already honour this inline; every new
// sending path routes through here instead of re-implementing it, because the
// third copy of a rule is where the copies start to disagree.
//
// Tests: tests/outreach.test.mjs

export const OUTREACH_CHANNELS = Object.freeze(["sms", "email"]);

/** Placeholder the seed data and CSV import use for "no phone on file". */
const NO_PHONE = "—";

/**
 * @typedef {{name?: string|null, phone?: string|null, email?: string|null,
 *            sms_opt_in?: boolean|null, email_opt_in?: boolean|null,
 *            deleted_at?: string|null, archived?: boolean|null}} ContactRow
 */

/**
 * May we contact this customer on this channel, and if so, at what address?
 *
 * Refusal reasons are returned rather than thrown so the caller can RECORD the
 * skip (automation_runs.status = 'skipped', campaign_deliveries.status =
 * 'skipped'). A send that is quietly not attempted is indistinguishable from
 * one that succeeded, which is the failure mode this whole exercise is about.
 *
 * The opt-in flag must be an explicit boolean. `undefined` means the caller
 * forgot to select the column — treating that as consent is how an entire
 * opted-out list gets mailed, so it is refused with its own reason.
 *
 * @param {ContactRow|null|undefined} customer
 * @param {"sms"|"email"} channel
 * @returns {{ok: true, to: string} | {ok: false, reason: string}}
 */
export function contactEligibility(customer, channel) {
  if (!OUTREACH_CHANNELS.includes(channel)) return { ok: false, reason: "unknown_channel" };
  if (!customer || typeof customer !== "object") return { ok: false, reason: "no_customer" };
  if (customer.deleted_at) return { ok: false, reason: "customer_deleted" };

  if (channel === "sms") {
    if (customer.sms_opt_in === false) return { ok: false, reason: "sms_opt_out" };
    if (typeof customer.sms_opt_in !== "boolean")
      return { ok: false, reason: "sms_opt_in_unknown" };
    const phone = String(customer.phone ?? "").trim();
    if (!phone || phone === NO_PHONE) return { ok: false, reason: "no_phone" };
    return { ok: true, to: phone };
  }

  if (customer.email_opt_in === false) return { ok: false, reason: "email_opt_out" };
  if (typeof customer.email_opt_in !== "boolean")
    return { ok: false, reason: "email_opt_in_unknown" };
  const email = String(customer.email ?? "").trim();
  if (!email || !email.includes("@")) return { ok: false, reason: "no_email" };
  return { ok: true, to: email };
}

/** Channels a campaign row's `channel` value expands to. */
export function campaignChannels(channel) {
  if (channel === "both") return ["email", "sms"];
  if (channel === "email" || channel === "sms") return [channel];
  return [];
}

/**
 * Audience segments the campaign sender can actually build a recipient list
 * for. The /growth form offers exactly these three; anything else is a segment
 * nobody implemented, and a campaign addressed to it must be reported rather
 * than sent to an accidental "everyone".
 */
export const CAMPAIGN_SEGMENTS = Object.freeze(["all_customers", "past_due", "inactive"]);

export function isKnownSegment(segment) {
  return CAMPAIGN_SEGMENTS.includes(String(segment ?? ""));
}

/** ISO date (YYYY-MM-DD) `days` before `todayISO`. Pure date maths, UTC-anchored. */
export function isoDaysBefore(todayISO, days) {
  const base = new Date(`${String(todayISO).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) throw new TypeError(`invalid date: ${todayISO}`);
  base.setUTCDate(base.getUTCDate() - Number(days));
  return base.toISOString().slice(0, 10);
}

/** Days a customer may go without work before the "inactive" segment claims them. */
export const INACTIVE_AFTER_DAYS = 365;
/** Age at which an unpaid invoice counts as past due — same 14 days the overdue nudge uses. */
export const PAST_DUE_AFTER_DAYS = 14;

/**
 * Trim a message to one SMS-sane length. Twilio will happily bill for six
 * segments; a marketing blast that silently costs 6x is its own defect.
 */
export function truncateForSms(body, limit = 480) {
  const text = String(body ?? "").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}
