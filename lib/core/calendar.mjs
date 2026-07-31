// iCalendar feed (ledger 6c.7). Plain ESM, no dependency — RFC 5545 by hand.
//
// WHY THIS EXISTS
// ---------------
// Owners and technicians live in Google Calendar and this product exported
// nothing. A subscribable feed URL fixes that, but it is a CREDENTIAL: whoever
// holds the URL reads the schedule, for as long as it works, with no login.
//
// THE TOKEN RULES ARE THE ONES 023 §10 SETTLED ON for portal links, which were
// permanent and irrevocable until that migration bounded them. Applied here:
//
//   * EXPIRING.   90 days, enforced at LOOKUP (`calendarFeedAccess`), not only
//                 at creation — an expiry nothing checks is decoration. 90 and
//                 not 180 because a calendar subscription is re-added in ten
//                 seconds, unlike a payment link a customer was emailed.
//   * REVOCABLE.  `revoked_at` is checked FIRST, before expiry and before
//                 scope, so revoking is immediate and a still-in-window token
//                 is refused. Every token is individually revocable and
//                 rotatable, per device.
//   * NARROW.     A feed exposes only what a calendar needs. `redactEvent`
//                 removes price, notes, customer phone/email and every public
//                 document token. The portal keeps its nested tokens because it
//                 cannot work without them; a calendar can, so it does not get
//                 them. Scope `mine` is further limited to the holder's own
//                 jobs, and `organization` is refused for a technician.
//   * BOUNDED.    A window of −90/+365 days and a hard event cap, so a feed can
//                 never become an unbounded export of the whole business.
//
// Tests: tests/calendar-feed.test.mjs

/** What a feed may cover. `organization` is owner/office only — enforced here and at creation. */
export const CALENDAR_SCOPES = Object.freeze(["mine", "organization"]);

/** Days a feed token stays valid. Short, because re-subscribing is trivial. */
export const CALENDAR_TOKEN_TTL_DAYS = 90;
/** How far back and forward a feed reaches. A calendar does not need 2019. */
export const CALENDAR_WINDOW_PAST_DAYS = 90;
export const CALENDAR_WINDOW_FUTURE_DAYS = 365;
/** Hard cap on events in one feed response. */
export const CALENDAR_MAX_EVENTS = 2000;

/** Roles allowed to mint an organisation-wide feed. */
export const ORG_SCOPE_ROLES = Object.freeze(["owner", "office"]);

export function isCalendarScope(scope) {
  return CALENDAR_SCOPES.includes(String(scope ?? ""));
}

/**
 * May this role create a feed at this scope?
 * A technician gets their own schedule and only their own — an org-wide feed
 * would hand every customer address in the business to one long-lived URL.
 */
export function canCreateFeed(role, scope) {
  if (!isCalendarScope(scope)) return { ok: false, reason: "unknown_scope" };
  if (scope === "organization" && !ORG_SCOPE_ROLES.includes(String(role ?? ""))) {
    return { ok: false, reason: "scope_not_permitted" };
  }
  return { ok: true };
}

/**
 * Decide, at LOOKUP time, whether this token may serve a feed — and what of.
 *
 * Order matters and is asserted in the tests: revocation beats expiry beats
 * scope. A revoked token inside its window must be refused for the revocation,
 * not accepted because the clock says it is fine.
 *
 * @param {{profile_id?: string, organization_id?: string, scope?: string,
 *          expires_at?: string|null, revoked_at?: string|null} | null} row
 * @param {string} nowISO
 */
export function calendarFeedAccess(row, nowISO) {
  if (!row || typeof row !== "object") return { ok: false, reason: "not_found" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };

  const now = new Date(nowISO).getTime();
  if (!Number.isFinite(now)) throw new TypeError(`invalid now: ${nowISO}`);

  // A NULL expiry is refused, not treated as "never expires". That is the exact
  // shape of the defect 023 §10 found in the portal token: the absence of a
  // bound read as an unlimited one.
  if (!row.expires_at) return { ok: false, reason: "no_expiry" };
  const expires = new Date(row.expires_at).getTime();
  if (!Number.isFinite(expires)) return { ok: false, reason: "no_expiry" };
  if (expires <= now) return { ok: false, reason: "expired" };

  if (!isCalendarScope(row.scope)) return { ok: false, reason: "unknown_scope" };
  if (!row.organization_id) return { ok: false, reason: "not_found" };
  if (row.scope === "mine" && !row.profile_id) return { ok: false, reason: "not_found" };

  return {
    ok: true,
    scope: String(row.scope),
    organizationId: String(row.organization_id),
    profileId: row.profile_id ? String(row.profile_id) : null,
  };
}

/** The expiry a newly minted or rotated token gets. */
export function calendarTokenExpiry(nowISO, ttlDays = CALENDAR_TOKEN_TTL_DAYS) {
  const now = new Date(nowISO);
  if (Number.isNaN(now.getTime())) throw new TypeError(`invalid now: ${nowISO}`);
  return new Date(now.getTime() + Number(ttlDays) * 86400000).toISOString();
}

/** The date window a feed reads. Anything outside it is simply not exported. */
export function calendarWindow(todayISO) {
  const day = String(todayISO ?? "").slice(0, 10);
  const base = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) throw new TypeError(`invalid date: ${todayISO}`);
  const shift = (days) => new Date(base.getTime() + days * 86400000).toISOString().slice(0, 10);
  return { start: shift(-CALENDAR_WINDOW_PAST_DAYS), end: shift(CALENDAR_WINDOW_FUTURE_DAYS) };
}

// ---------------------------------------------------------------------
//  RFC 5545 serialisation.
// ---------------------------------------------------------------------

/** Escape a TEXT value: backslash, semicolon, comma, and newline become \n. */
export function icsEscape(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Fold a content line to 75 OCTETS, continuing with a single space.
 *
 * Octets, not characters: a Hebrew service name is two or three bytes per
 * character, and folding on character count produces lines Google silently
 * rejects. Multi-byte sequences are never split.
 */
export function foldIcsLine(line) {
  const bytes = Buffer.from(String(line ?? ""), "utf8");
  if (bytes.length <= 75) return String(line ?? "");
  const parts = [];
  let offset = 0;
  let limit = 75;
  while (offset < bytes.length) {
    let take = Math.min(limit, bytes.length - offset);
    // Never cut inside a UTF-8 sequence: back off to a lead byte.
    while (take > 0 && offset + take < bytes.length && (bytes[offset + take] & 0xc0) === 0x80)
      take -= 1;
    if (take <= 0) take = Math.min(limit, bytes.length - offset);
    parts.push(bytes.subarray(offset, offset + take).toString("utf8"));
    offset += take;
    limit = 74; // continuation lines carry a leading space
  }
  return parts.join("\r\n ");
}

const pad = (n) => String(n).padStart(2, "0");

/** `YYYYMMDD` for an all-day (DATE) value. */
export function icsDate(dayISO) {
  const day = String(dayISO ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new TypeError(`invalid date: ${dayISO}`);
  return day.replace(/-/g, "");
}

/**
 * `YYYYMMDDTHHMMSS` — a FLOATING local time, deliberately without a Z.
 *
 * The job stores a wall-clock date and time in the business's own timezone and
 * this product has no per-job timezone. Stamping Z would claim UTC and shift
 * every appointment by the office's offset. Floating time means "9am wherever
 * you are", which is what a technician's calendar should say.
 */
export function icsLocalDateTime(dayISO, time) {
  const day = icsDate(dayISO);
  const parts = String(time ?? "").split(":");
  const h = Number(parts[0] ?? 0),
    m = Number(parts[1] ?? 0),
    s = Number(parts[2] ?? 0);
  if (![h, m, s].every((n) => Number.isFinite(n))) throw new TypeError(`invalid time: ${time}`);
  return `${day}T${pad(h)}${pad(m)}${pad(Math.trunc(s))}`;
}

/** UTC stamp for DTSTAMP / LAST-MODIFIED, which are genuinely absolute. */
export function icsUtcStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new TypeError(`invalid timestamp: ${iso}`);
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * Turn a job row into the ONLY fields a calendar gets.
 *
 * Everything not listed here is dropped on purpose. `price_minor`, `notes`,
 * the customer's phone and email, and every `public_token` in the product stay
 * out of a URL that needs no password.
 */
export function redactEvent(job) {
  const customer = job?.customers ?? job?.customer ?? null;
  return {
    id: String(job?.id ?? ""),
    service: String(job?.service ?? "").trim(),
    customerName: String(customer?.name ?? "").trim(),
    date: String(job?.scheduled_date ?? "").slice(0, 10),
    endDate: job?.end_date ? String(job.end_date).slice(0, 10) : null,
    startTime: job?.start_time ? String(job.start_time) : null,
    endTime: job?.end_time ? String(job.end_time) : null,
    address: [job?.job_address, job?.job_city].filter(Boolean).join(", "),
    status: String(job?.status ?? ""),
    updatedAt: job?.updated_at ?? job?.created_at ?? null,
  };
}

/** The next day, for the exclusive DTEND an all-day VEVENT requires. */
function nextDay(dayISO) {
  const d = new Date(`${dayISO}T00:00:00.000Z`);
  return new Date(d.getTime() + 86400000).toISOString().slice(0, 10);
}

/**
 * One VEVENT. Cancelled jobs are exported with STATUS:CANCELLED rather than
 * omitted, so a cancellation actually disappears from a subscriber's calendar
 * instead of lingering because the feed simply stopped mentioning it.
 */
export function buildEvent(event, { origin = "", stampISO }) {
  const lines = [];
  const uid = `job-${event.id}@servicepro`;
  lines.push("BEGIN:VEVENT");
  lines.push(`UID:${uid}`);
  lines.push(`DTSTAMP:${icsUtcStamp(stampISO)}`);

  if (event.startTime) {
    const endDay = event.endDate && event.endDate >= event.date ? event.endDate : event.date;
    lines.push(`DTSTART:${icsLocalDateTime(event.date, event.startTime)}`);
    // No end time recorded: a one-hour block, because a zero-length event is
    // invisible in most calendars and an all-day one is a lie.
    if (event.endTime) lines.push(`DTEND:${icsLocalDateTime(endDay, event.endTime)}`);
    else lines.push(`DTEND:${icsLocalDateTime(endDay, addHour(event.startTime))}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(event.date)}`);
    lines.push(
      `DTEND;VALUE=DATE:${icsDate(nextDay(event.endDate && event.endDate >= event.date ? event.endDate : event.date))}`,
    );
  }

  const summary = [event.service, event.customerName].filter(Boolean).join(" — ") || "Job";
  lines.push(`SUMMARY:${icsEscape(summary)}`);
  if (event.address) lines.push(`LOCATION:${icsEscape(event.address)}`);
  if (origin) lines.push(`URL:${icsEscape(`${origin}/jobs/${event.id}`)}`);
  lines.push(`STATUS:${event.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`);
  if (event.updatedAt) lines.push(`LAST-MODIFIED:${icsUtcStamp(event.updatedAt)}`);
  lines.push("END:VEVENT");
  return lines;
}

function addHour(time) {
  const [h, m] = String(time)
    .split(":")
    .map((n) => Number(n) || 0);
  return `${pad((h + 1) % 24)}:${pad(m)}:00`;
}

/**
 * The whole document. CRLF line endings, because RFC 5545 says so and at least
 * one major client treats bare LF as a malformed calendar.
 */
export function buildCalendar({ events, name, origin = "", stampISO }) {
  const capped = (events ?? []).slice(0, CALENDAR_MAX_EVENTS);
  const out = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ServicePro//Schedule Feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(name || "ServicePro")}`,
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  for (const event of capped) {
    if (!event?.id || !event?.date) continue;
    out.push(...buildEvent(event, { origin, stampISO }));
  }
  out.push("END:VCALENDAR");
  return out.map(foldIcsLine).join("\r\n") + "\r\n";
}
