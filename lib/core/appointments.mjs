// =====================================================================
//  appointments.mjs — confirm / decline, and "where is my technician?".
//
//  WHY THIS EXISTS (remediation plan 6c.8)
//  ---------------------------------------
//  Reminders were one-way SMS. The customer had no way to confirm or to say
//  "not that day", and the "on my way" message pointed at nothing — the two
//  largest sources of no-shows and of inbound "where are they?" phone calls in
//  this trade.
//
//  THE TOKEN RULES, WHICH ARE 023 §10's RULES.
//  Migration 023 had to retrofit expiry and revocation onto the customer portal
//  link because it was a permanent, irrevocable credential that one forwarded
//  email granted for ever. The appointment link is built with those properties
//  from the start, and this module is where they are decided:
//    * it EXPIRES — `expiresAt` is required, and an absent one is invalid
//      rather than eternal;
//    * it is REVOCABLE — `revokedAt` is checked FIRST, so a revoked link inside
//      its window is refused;
//    * it exposes only this appointment. It chains to no document token, no
//      price, no other job.
//
//  Tests: tests/appointments.test.mjs
// =====================================================================

export const CONFIRMATION_STATES = ["pending", "confirmed", "declined"];
export const APPOINTMENT_RESPONSES = ["confirmed", "declined"];

/** How long a link lives. Long enough to survive a reschedule, not a season. */
export const TOKEN_TTL_DAYS_AFTER_JOB = 3;
export const TOKEN_MIN_TTL_DAYS = 2;

const finite = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const ms = (value) => {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
};

/**
 * When a link minted now for a job on `scheduledDate` should die.
 *
 * Tied to the APPOINTMENT, not to a fixed window from issue: a link created
 * three weeks early must still work on the day, and a link for yesterday's job
 * must not still work next month. Floored at `TOKEN_MIN_TTL_DAYS` from now so
 * re-issuing a link for a job in the past still produces something usable for
 * the arrival page while the technician is actually there.
 */
export function tokenExpiryFor(scheduledDate, now = Date.now()) {
  const nowMs = ms(now) ?? Date.now();
  const floor = nowMs + TOKEN_MIN_TTL_DAYS * 86400_000;
  const day = String(scheduledDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return new Date(floor).toISOString();
  const jobEnd = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))
    + (TOKEN_TTL_DAYS_AFTER_JOB + 1) * 86400_000;
  return new Date(Math.max(floor, jobEnd)).toISOString();
}

/**
 * Is this token usable right now? Revocation is checked BEFORE expiry so a
 * revoked-but-unexpired link is refused for the reason that actually applies.
 */
export function tokenState(token, now = Date.now()) {
  const nowMs = ms(now) ?? Date.now();
  if (!token) return { valid: false, reason: "not_found" };
  const revoked = ms(token.revoked_at ?? token.revokedAt);
  if (revoked !== null && revoked <= nowMs) return { valid: false, reason: "revoked" };
  const expires = ms(token.expires_at ?? token.expiresAt);
  // No expiry is INVALID, not eternal. A link that cannot age out is the exact
  // defect 023 §10 had to repair on the portal token; it is not repeated here.
  if (expires === null) return { valid: false, reason: "no_expiry" };
  if (expires <= nowMs) return { valid: false, reason: "expired" };
  return { valid: true };
}

/** Normalise a customer's answer; anything else is refused, never guessed. */
export function normalizeResponse(value) {
  const response = String(value ?? "").trim().toLowerCase();
  return APPOINTMENT_RESPONSES.includes(response) ? response : null;
}

/**
 * May this appointment still be answered?
 *
 * A finished or cancelled job cannot: confirming an appointment that already
 * happened is meaningless, and it would overwrite the record of what the
 * customer actually said beforehand. Bounded at `maxResponses` so a leaked link
 * cannot be used to hammer the row — the same reasoning as the portal request
 * rate limit in 023 §10.
 */
export function canRespond(job, { maxResponses = 10 } = {}) {
  if (!job) return { ok: false, error: "not_found" };
  if (job.deleted_at) return { ok: false, error: "not_found" };
  if (job.status === "done" || job.status === "cancelled") return { ok: false, error: "appointment_closed" };
  if (finite(job.customer_response_count) >= maxResponses) return { ok: false, error: "too_many_responses" };
  return { ok: true };
}

/**
 * The arrival state the customer's page shows.
 *
 * Deliberately derived rather than stored: a stored state machine would need a
 * writer at every one of these transitions, and the one that would be forgotten
 * is the one that leaves a customer staring at "on the way" after the
 * technician has gone home.
 */
export function arrivalState(appointment, now = Date.now()) {
  const nowMs = ms(now) ?? Date.now();
  if (!appointment) return "unknown";
  if (appointment.status === "cancelled") return "cancelled";
  if (appointment.completed_at) return "completed";
  if (appointment.arrived_at) return "arrived";
  const onWay = ms(appointment.on_my_way_at);
  if (onWay !== null) {
    const eta = finite(appointment.eta_minutes);
    // An ETA that ran out does not become "arrived" — nobody told us that.
    // It becomes "due", which is honest and is what the customer should ring
    // about if it stays that way.
    if (eta > 0 && nowMs > onWay + eta * 60_000) return "due";
    return "on_the_way";
  }
  return "scheduled";
}

/** Minutes until the technician is expected; null when nothing is known. */
export function minutesUntilArrival(appointment, now = Date.now()) {
  const nowMs = ms(now) ?? Date.now();
  const onWay = ms(appointment?.on_my_way_at);
  const eta = finite(appointment?.eta_minutes);
  if (onWay === null || eta <= 0) return null;
  return Math.round((onWay + eta * 60_000 - nowMs) / 60_000);
}

/** One sentence, in the customer's language, for each arrival state. */
export function describeArrival(appointment, { locale = "en", now = Date.now() } = {}) {
  const he = locale === "he";
  const state = arrivalState(appointment, now);
  const tech = appointment?.technician;
  const who = tech || (he ? "הטכנאי שלכם" : "Your technician");
  switch (state) {
    case "completed": return he ? "העבודה הושלמה. תודה!" : "This visit is complete. Thank you!";
    case "cancelled": return he ? "הביקור בוטל." : "This visit has been cancelled.";
    case "arrived": return he ? `${who} הגיע.` : `${who} has arrived.`;
    case "due": return he ? `${who} בדרך והיה אמור להגיע. אם עוד לא הגיע, התקשרו אלינו.` : `${who} is on the way and is due now. If they have not arrived, please call us.`;
    case "on_the_way": {
      const mins = minutesUntilArrival(appointment, now);
      if (mins === null) return he ? `${who} בדרך אליכם.` : `${who} is on the way.`;
      return he ? `${who} בדרך אליכם — עוד כ-${Math.max(1, mins)} דקות.` : `${who} is on the way — about ${Math.max(1, mins)} minutes away.`;
    }
    default: return he ? "הביקור מתוכנן. נעדכן אתכם כשהטכנאי יצא לדרך." : "Your visit is booked. We will tell you the moment your technician sets off.";
  }
}

/** Human ETA sanity: 5 minutes to 8 hours, or nothing at all. */
export function normalizeEtaMinutes(value) {
  if (value == null || value === "") return null;
  const minutes = Math.round(Number(value));
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) return null;
  return minutes;
}

/**
 * The SMS a customer receives, with the link. Kept short on purpose: a segment
 * is 160 characters and every extra segment is billed.
 */
export function confirmationSms({ businessName, service, date, time, url, locale = "en" }) {
  const he = locale === "he";
  const when = [date, (time ?? "").slice(0, 5)].filter(Boolean).join(" ");
  return he
    ? `${businessName}: ${service} בתאריך ${when}. אישור או שינוי: ${url}`
    : `${businessName}: ${service} on ${when}. Confirm or change: ${url}`;
}
