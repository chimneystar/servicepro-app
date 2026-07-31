import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripSqlComments } from "./helpers/sql.mjs";
import {
  CALENDAR_MAX_EVENTS, CALENDAR_SCOPES, CALENDAR_TOKEN_TTL_DAYS,
  CALENDAR_WINDOW_FUTURE_DAYS, CALENDAR_WINDOW_PAST_DAYS,
  buildCalendar, calendarFeedAccess, calendarTokenExpiry, calendarWindow, canCreateFeed,
  foldIcsLine, icsDate, icsEscape, icsLocalDateTime, icsUtcStamp, redactEvent,
} from "../lib/core/calendar.mjs";

const NOW = "2026-07-31T12:00:00.000Z";
const live = {
  organization_id: "org-1", profile_id: "p-1", scope: "mine",
  expires_at: "2026-09-01T00:00:00.000Z", revoked_at: null,
};

// ---------------------------------------------------------------------------
// The token is a CREDENTIAL. These are the 023 §10 rules, applied here.
// ---------------------------------------------------------------------------

test("a live token serves its feed — the gate is proven in both directions", () => {
  const access = calendarFeedAccess(live, NOW);
  assert.equal(access.ok, true);
  assert.equal(access.scope, "mine");
  assert.equal(access.organizationId, "org-1");
  assert.equal(access.profileId, "p-1");
});

test("an EXPIRED token is refused at lookup, not merely at creation", () => {
  const access = calendarFeedAccess({ ...live, expires_at: "2026-07-30T00:00:00.000Z" }, NOW);
  assert.equal(access.ok, false);
  assert.equal(access.reason, "expired");
});

test("a token expiring exactly now is refused, not accepted on the boundary", () => {
  assert.equal(calendarFeedAccess({ ...live, expires_at: NOW }, NOW).reason, "expired");
});

test("a REVOKED token is refused immediately, even inside its window", () => {
  const access = calendarFeedAccess({ ...live, revoked_at: "2026-07-01T00:00:00.000Z" }, NOW);
  assert.equal(access.ok, false);
  assert.equal(access.reason, "revoked");
});

test("revocation is checked BEFORE expiry, so revoking is never masked by the clock", () => {
  const both = { ...live, expires_at: "2020-01-01T00:00:00.000Z", revoked_at: "2026-01-01T00:00:00.000Z" };
  assert.equal(calendarFeedAccess(both, NOW).reason, "revoked");
});

test("a NULL expiry is refused rather than treated as 'never expires'", () => {
  // This is exactly the shape of the portal-token defect 023 §10 closed: the
  // absence of a bound read as an unlimited one.
  assert.equal(calendarFeedAccess({ ...live, expires_at: null }, NOW).reason, "no_expiry");
  assert.equal(calendarFeedAccess({ ...live, expires_at: "nonsense" }, NOW).reason, "no_expiry");
});

test("an unknown token is refused without leaking why", () => {
  assert.equal(calendarFeedAccess(null, NOW).reason, "not_found");
  assert.equal(calendarFeedAccess(undefined, NOW).reason, "not_found");
});

test("an unknown scope is refused, never widened to the whole business", () => {
  assert.equal(calendarFeedAccess({ ...live, scope: "everything" }, NOW).reason, "unknown_scope");
  assert.equal(calendarFeedAccess({ ...live, scope: "" }, NOW).reason, "unknown_scope");
});

test("a 'mine' token with no profile is refused rather than defaulting to org-wide", () => {
  assert.equal(calendarFeedAccess({ ...live, profile_id: null }, NOW).reason, "not_found");
});

test("a technician cannot mint an organisation-wide feed; owner and office can", () => {
  assert.equal(canCreateFeed("tech", "organization").ok, false);
  assert.equal(canCreateFeed("tech", "organization").reason, "scope_not_permitted");
  assert.equal(canCreateFeed("tech", "mine").ok, true);
  assert.equal(canCreateFeed("owner", "organization").ok, true);
  assert.equal(canCreateFeed("office", "organization").ok, true);
});

test("an unknown scope cannot be created either", () => {
  assert.equal(canCreateFeed("owner", "everything").reason, "unknown_scope");
  assert.deepEqual([...CALENDAR_SCOPES], ["mine", "organization"]);
});

test("a minted token expires, and sooner than a portal link", () => {
  assert.equal(CALENDAR_TOKEN_TTL_DAYS, 90);
  assert.equal(calendarTokenExpiry("2026-07-31T00:00:00.000Z"), "2026-10-29T00:00:00.000Z");
  assert.equal(calendarFeedAccess({ ...live, expires_at: calendarTokenExpiry(NOW) }, NOW).ok, true);
});

test("the feed window is bounded in both directions", () => {
  const w = calendarWindow("2026-07-31");
  assert.equal(w.start, "2026-05-02");
  assert.equal(w.end, "2027-07-31");
  assert.equal(CALENDAR_WINDOW_PAST_DAYS, 90);
  assert.equal(CALENDAR_WINDOW_FUTURE_DAYS, 365);
});

// ---------------------------------------------------------------------------
// The payload is NARROW. Money and tokens never leave through a passwordless URL.
// ---------------------------------------------------------------------------

const job = {
  id: "job-1", service: "Boiler service", scheduled_date: "2026-08-04", end_date: null,
  start_time: "09:30:00", end_time: "11:00:00", job_address: "1 High St", job_city: "Austin",
  status: "scheduled", updated_at: "2026-07-30T08:00:00.000Z",
  price_minor: 45000, notes: "gate code 4417", public_token: "secret-token",
  customers: { name: "Dana Levi", phone: "+15125550100", email: "dana@example.com" },
};

test("the exported event carries what a calendar needs", () => {
  const e = redactEvent(job);
  assert.equal(e.service, "Boiler service");
  assert.equal(e.customerName, "Dana Levi");
  assert.equal(e.address, "1 High St, Austin");
  assert.equal(e.startTime, "09:30:00");
});

test("price, notes, phone, email and every public token are STRIPPED", () => {
  const serialised = JSON.stringify(redactEvent(job));
  for (const secret of ["45000", "gate code", "secret-token", "+15125550100", "dana@example.com"]) {
    assert.equal(serialised.includes(secret), false, `${secret} must not reach a passwordless feed`);
  }
});

test("the rendered calendar leaks none of it either", () => {
  const ics = buildCalendar({ events: [redactEvent(job)], name: "Feed", origin: "https://x", stampISO: NOW });
  for (const secret of ["450.00", "45000", "gate code", "secret-token", "5125550100", "dana@example.com"]) {
    assert.equal(ics.includes(secret), false);
  }
  assert.match(ics, /SUMMARY:Boiler service — Dana Levi/);
});

// ---------------------------------------------------------------------------
// RFC 5545 correctness — a malformed feed silently fails to subscribe.
// ---------------------------------------------------------------------------

test("TEXT values escape backslash, semicolon, comma and newline", () => {
  assert.equal(icsEscape("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  assert.equal(icsEscape(null), "");
});

test("a service name containing a comma cannot break the line into a second property", () => {
  const ics = buildCalendar({ events: [redactEvent({ ...job, service: "Repair, replace; test" })], name: "F", stampISO: NOW });
  assert.match(ics, /SUMMARY:Repair\\, replace\\; test/);
});

test("lines fold at 75 octets with a leading space, and never mid-character", () => {
  const long = `SUMMARY:${"א".repeat(120)}`;
  const folded = foldIcsLine(long);
  for (const line of folded.split("\r\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, `line is ${Buffer.byteLength(line, "utf8")} octets`);
  }
  // Unfolding must give back exactly the original: no character was split.
  assert.equal(folded.split("\r\n ").join(""), long);
});

test("a short line is not folded at all", () => {
  assert.equal(foldIcsLine("SUMMARY:short"), "SUMMARY:short");
});

test("timed events use FLOATING local time — a Z would shift every appointment", () => {
  const ics = buildCalendar({ events: [redactEvent(job)], name: "F", stampISO: NOW });
  assert.match(ics, /DTSTART:20260804T093000\r\n/);
  assert.match(ics, /DTEND:20260804T110000\r\n/);
  assert.equal(/DTSTART:\d{8}T\d{6}Z/.test(ics), false);
  assert.equal(icsLocalDateTime("2026-08-04", "09:30:00"), "20260804T093000");
});

test("DTSTAMP is genuinely absolute and does carry Z", () => {
  assert.equal(icsUtcStamp("2026-07-31T12:00:00.000Z"), "20260731T120000Z");
  const ics = buildCalendar({ events: [redactEvent(job)], name: "F", stampISO: NOW });
  assert.match(ics, /DTSTAMP:20260731T120000Z/);
});

test("a job with no time becomes an all-day event with an EXCLUSIVE end date", () => {
  const ics = buildCalendar({ events: [redactEvent({ ...job, start_time: null, end_time: null })], name: "F", stampISO: NOW });
  assert.match(ics, /DTSTART;VALUE=DATE:20260804/);
  assert.match(ics, /DTEND;VALUE=DATE:20260805/);
  assert.equal(icsDate("2026-08-04"), "20260804");
});

test("a job with a start but no end gets an hour, not a zero-length event", () => {
  const ics = buildCalendar({ events: [redactEvent({ ...job, end_time: null })], name: "F", stampISO: NOW });
  assert.match(ics, /DTEND:20260804T103000/);
});

test("a multi-day job spans to its end date", () => {
  const ics = buildCalendar({ events: [redactEvent({ ...job, end_date: "2026-08-06" })], name: "F", stampISO: NOW });
  assert.match(ics, /DTEND:20260806T110000/);
});

test("a cancelled job is EXPORTED as cancelled, so it disappears from the subscriber", () => {
  const ics = buildCalendar({ events: [redactEvent({ ...job, status: "cancelled" })], name: "F", stampISO: NOW });
  assert.match(ics, /STATUS:CANCELLED/);
  assert.match(ics, /UID:job-job-1@servicepro/);
});

test("a live job is exported as confirmed", () => {
  const ics = buildCalendar({ events: [redactEvent(job)], name: "F", stampISO: NOW });
  assert.match(ics, /STATUS:CONFIRMED/);
});

test("the document is well-formed, CRLF-terminated and balanced", () => {
  const ics = buildCalendar({ events: [redactEvent(job), redactEvent({ ...job, id: "job-2" })], name: "My feed", stampISO: NOW });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal(ics.split("BEGIN:VEVENT").length - 1, 2);
  assert.equal(ics.split("END:VEVENT").length - 1, 2);
  assert.equal(/[^\r]\n/.test(ics), false, "every line must end CRLF");
});

test("an empty feed is still a valid calendar, not an error", () => {
  const ics = buildCalendar({ events: [], name: "Empty", stampISO: NOW });
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.equal(ics.includes("BEGIN:VEVENT"), false);
});

test("a row with no date is skipped rather than emitting a broken VEVENT", () => {
  const ics = buildCalendar({ events: [{ id: "x", date: "" }, redactEvent(job)], name: "F", stampISO: NOW });
  assert.equal(ics.split("BEGIN:VEVENT").length - 1, 1);
});

test("the feed is capped, so it can never become a full export of the business", () => {
  const many = Array.from({ length: CALENDAR_MAX_EVENTS + 50 }, (_, i) => redactEvent({ ...job, id: `job-${i}` }));
  const ics = buildCalendar({ events: many, name: "F", stampISO: NOW });
  assert.equal(ics.split("BEGIN:VEVENT").length - 1, CALENDAR_MAX_EVENTS);
});

// ---------------------------------------------------------------------------
// Structural: the route must enforce the token, and the table must be bounded.
// ---------------------------------------------------------------------------

const code = (path) => readFileSync(new URL(path, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

test("the feed route evaluates the token on EVERY request and caches nothing", () => {
  const route = code("../app/api/calendar/[token]/route.ts");
  assert.match(route, /calendarFeedAccess/);
  assert.match(route, /dynamic\s*=\s*"force-dynamic"/);
  assert.match(route, /no-store/);
  assert.match(route, /404|401/);
});

test("the feed route selects only redactable columns — no price, no notes, no token", () => {
  const route = code("../app/api/calendar/[token]/route.ts");
  const selects = [...route.matchAll(/\.select\(\s*[`"']([^`"']+)/g)].map((m) => m[1]).join(" ");
  for (const forbidden of ["price_minor", "notes", "public_token", "phone", "email"]) {
    assert.equal(selects.includes(forbidden), false, `the feed query must not select ${forbidden}`);
  }
});

test("migration 040 bounds the feed token: expiry, revocation, scope", () => {
  const sql = stripSqlComments(readFileSync(new URL("../db/040_communications.sql", import.meta.url), "utf8"));
  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+public\.calendar_feed_tokens/i);
  assert.match(sql, /expires_at\s+timestamptz\s+not\s+null/i);
  assert.match(sql, /revoked_at\s+timestamptz/i);
  assert.match(sql, /calendar_feed_tokens_scope_check[\s\S]{0,200}check\s*\(\s*scope\s+in\s*\(\s*'mine'\s*,\s*'organization'\s*\)/i);
  // The scope is enforced at the DATABASE too, so a forged form post cannot do
  // what the screen refuses.
  assert.match(sql, /assert_calendar_feed_scope/);
  assert.match(sql, /technician may only subscribe to their own schedule/i);
  assert.match(sql, /alter\s+table\s+public\.calendar_feed_tokens\s+enable\s+row\s+level\s+security/i);
  assert.match(sql, /revoke\s+all\s+on\s+public\.calendar_feed_tokens\s+from\s+anon/i);
});
