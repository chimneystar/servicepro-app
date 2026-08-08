import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripSqlComments } from "./helpers/sql.mjs";
import {
  CONFIRMATION_STATES,
  APPOINTMENT_RESPONSES,
  tokenExpiryFor,
  tokenState,
  normalizeResponse,
  canRespond,
  arrivalState,
  minutesUntilArrival,
  describeArrival,
  normalizeEtaMinutes,
  confirmationSms,
} from "../lib/core/appointments.mjs";

// ---------------------------------------------------------------------------
// 6c.8 — reminders were one-way SMS; the customer could not confirm, and the
// "on my way" text had no arrival page. Token rules per db/023 §10.
// ---------------------------------------------------------------------------

const NOW = Date.UTC(2026, 6, 1, 9, 0); // 2026-07-01T09:00Z

test("the states are closed sets", () => {
  assert.deepEqual(CONFIRMATION_STATES, ["pending", "confirmed", "declined"]);
  assert.deepEqual(APPOINTMENT_RESPONSES, ["confirmed", "declined"]);
});

test("a link's expiry is tied to the APPOINTMENT, not to a fixed window", () => {
  // Minted three weeks early, it must still work on the day.
  const expiry = new Date(tokenExpiryFor("2026-07-20", NOW)).getTime();
  assert.ok(expiry > Date.UTC(2026, 6, 20, 23, 59), "must outlive the appointment");
  assert.ok(expiry < Date.UTC(2026, 6, 25), "and must not outlive it by a season");
});

test("a link for a past job still lives long enough to be useful", () => {
  const expiry = new Date(tokenExpiryFor("2026-06-01", NOW)).getTime();
  assert.ok(expiry >= NOW + 2 * 86400_000);
});

test("an unparseable date still produces a bounded expiry, never none", () => {
  const expiry = new Date(tokenExpiryFor("not-a-date", NOW)).getTime();
  assert.ok(Number.isFinite(expiry) && expiry > NOW);
});

test("REVOCATION is checked before expiry", () => {
  // A revoked link inside its window must be refused for the reason that
  // actually applies — 023 §10 had to retrofit exactly this onto the portal.
  const token = {
    expires_at: new Date(NOW + 86400_000).toISOString(),
    revoked_at: new Date(NOW - 60_000).toISOString(),
  };
  assert.deepEqual(tokenState(token, NOW), { valid: false, reason: "revoked" });
});

test("an expired link is refused", () => {
  assert.deepEqual(tokenState({ expires_at: new Date(NOW - 1000).toISOString() }, NOW), {
    valid: false,
    reason: "expired",
  });
});

test("a link with NO expiry is INVALID, not eternal", () => {
  // The permanent, irrevocable link is the defect 023 §10 existed to repair; it
  // is not repeated here, and the absence of a deadline fails closed.
  assert.deepEqual(tokenState({ expires_at: null }, NOW), { valid: false, reason: "no_expiry" });
  assert.deepEqual(tokenState(null, NOW), { valid: false, reason: "not_found" });
});

test("a live link is valid — proven the other way", () => {
  assert.deepEqual(
    tokenState({ expires_at: new Date(NOW + 3600_000).toISOString(), revoked_at: null }, NOW),
    { valid: true },
  );
});

test("only 'confirmed' and 'declined' are accepted; anything else is refused", () => {
  assert.equal(normalizeResponse("Confirmed"), "confirmed");
  assert.equal(normalizeResponse(" declined "), "declined");
  assert.equal(normalizeResponse("cancelled"), null);
  assert.equal(normalizeResponse("maybe"), null);
  assert.equal(normalizeResponse(undefined), null);
});

test("a finished or cancelled appointment cannot be answered", () => {
  assert.deepEqual(canRespond({ status: "done" }), { ok: false, error: "appointment_closed" });
  assert.deepEqual(canRespond({ status: "cancelled" }), { ok: false, error: "appointment_closed" });
  assert.deepEqual(canRespond({ status: "scheduled" }), { ok: true });
});

test("a leaked link cannot hammer the row", () => {
  assert.deepEqual(canRespond({ status: "scheduled", customer_response_count: 10 }), {
    ok: false,
    error: "too_many_responses",
  });
  assert.deepEqual(canRespond({ status: "scheduled", customer_response_count: 9 }), { ok: true });
});

test("arrival state is derived, so it can never be left stale", () => {
  assert.equal(arrivalState({ status: "scheduled" }, NOW), "scheduled");
  assert.equal(
    arrivalState(
      { status: "scheduled", on_my_way_at: new Date(NOW - 300_000).toISOString(), eta_minutes: 20 },
      NOW,
    ),
    "on_the_way",
  );
  assert.equal(
    arrivalState(
      {
        status: "scheduled",
        on_my_way_at: new Date(NOW - 300_000).toISOString(),
        arrived_at: new Date(NOW).toISOString(),
      },
      NOW,
    ),
    "arrived",
  );
  assert.equal(
    arrivalState({ status: "done", completed_at: new Date(NOW).toISOString() }, NOW),
    "completed",
  );
  assert.equal(arrivalState({ status: "cancelled" }, NOW), "cancelled");
});

test("an ETA that ran out becomes DUE, never a false 'arrived'", () => {
  // Nobody told us they arrived. Saying so would be a lie the customer acts on.
  const late = {
    status: "scheduled",
    on_my_way_at: new Date(NOW - 3600_000).toISOString(),
    eta_minutes: 15,
  };
  assert.equal(arrivalState(late, NOW), "due");
  assert.match(describeArrival(late, { locale: "en", now: NOW }), /call us/i);
});

test("minutes until arrival, or null when nothing is known", () => {
  assert.equal(
    minutesUntilArrival(
      { on_my_way_at: new Date(NOW - 300_000).toISOString(), eta_minutes: 20 },
      NOW,
    ),
    15,
  );
  assert.equal(minutesUntilArrival({ on_my_way_at: new Date(NOW).toISOString() }, NOW), null);
  assert.equal(minutesUntilArrival({}, NOW), null);
});

test("the customer sentence names the technician and adapts to the state", () => {
  const onWay = {
    status: "scheduled",
    technician: "Ada",
    on_my_way_at: new Date(NOW - 300_000).toISOString(),
    eta_minutes: 20,
  };
  assert.match(describeArrival(onWay, { locale: "en", now: NOW }), /Ada is on the way/);
  assert.match(describeArrival(onWay, { locale: "en", now: NOW }), /15 minutes/);
  assert.match(describeArrival({ status: "scheduled" }, { locale: "en", now: NOW }), /booked/i);
  assert.ok(describeArrival(onWay, { locale: "he", now: NOW }).includes("Ada"));
});

test("an implausible ETA is dropped rather than shown", () => {
  assert.equal(normalizeEtaMinutes(20), 20);
  assert.equal(normalizeEtaMinutes("45"), 45);
  assert.equal(normalizeEtaMinutes(1), null); // under 5 minutes
  assert.equal(normalizeEtaMinutes(600), null); // over 8 hours
  assert.equal(normalizeEtaMinutes(""), null);
  assert.equal(normalizeEtaMinutes("soon"), null);
});

test("the confirmation SMS carries the link and stays short", () => {
  const body = confirmationSms({
    businessName: "Acme",
    service: "Boiler service",
    date: "2026-07-02",
    time: "09:00:00",
    url: "https://x.test/p/t/visit",
  });
  assert.match(body, /Acme/);
  assert.match(body, /https:\/\/x\.test\/p\/t\/visit/);
  assert.match(body, /09:00/);
  assert.ok(body.length <= 160, `one SMS segment, got ${body.length}`);
});

// ---------------------------------------------------------------------------
// Structural. Comments stripped first.
// ---------------------------------------------------------------------------
const migration = stripSqlComments(
  readFileSync(new URL("../db/039_scheduling_sales.sql", import.meta.url), "utf8"),
);
const jobActions = stripSqlComments(
  readFileSync(new URL("../app/(app)/jobs/[id]/actions.ts", import.meta.url), "utf8"),
);
const visitPage = stripSqlComments(
  readFileSync(new URL("../app/p/[token]/visit/page.tsx", import.meta.url), "utf8"),
);
const visitClient = stripSqlComments(
  readFileSync(new URL("../app/p/[token]/visit/VisitClient.tsx", import.meta.url), "utf8"),
);

test("the token table enforces expiry and revocation in its own shape", () => {
  assert.match(migration, /create table if not exists public\.appointment_tokens/);
  // NOT NULL: a link cannot be minted without a deadline.
  assert.match(migration, /expires_at\s+timestamptz not null/);
  assert.match(migration, /revoked_at\s+timestamptz/);
  // One live link per job — re-issuing revokes rather than leaving two live.
  assert.match(
    migration,
    /create unique index if not exists uq_appointment_tokens_live[\s\S]*?where revoked_at is null/,
  );
  assert.match(migration, /revoke all on public\.appointment_tokens from anon/);
});

test("public_appointment exposes only this appointment", () => {
  const fn = /create or replace function public\.public_appointment[\s\S]*?\$\$;/.exec(migration);
  assert.ok(fn);
  assert.match(fn[0], /revoked_at is null and expires_at > now\(\)/);
  // What a leaked link must NOT reach: money, documents, contact details.
  for (const forbidden of [
    "price_minor",
    "total_minor",
    "public_token",
    "invoice",
    "job_address",
    "customers",
  ]) {
    assert.doesNotMatch(
      fn[0],
      new RegExp(forbidden),
      `public_appointment must not expose ${forbidden}`,
    );
  }
  // First name only.
  assert.match(fn[0], /split_part\(coalesce\(p\.full_name, ''\), ' ', 1\)/);
});

test("responding is bounded, refuses a closed job, and does not cancel it", () => {
  const fn = /create or replace function public\.respond_to_appointment[\s\S]*?\$\$;/.exec(
    migration,
  );
  assert.ok(fn);
  assert.match(fn[0], /p_response not in \('confirmed','declined'\)/);
  assert.match(fn[0], /customer_response_count, 0\) >= 10/);
  assert.match(fn[0], /j\.status in \('done','cancelled'\)/);
  // A declined appointment is NOT auto-cancelled: that would let a leaked link
  // wipe a technician's day.
  assert.doesNotMatch(fn[0], /set status = 'cancelled'/);
  assert.match(fn[0], /insert into public\.audit_log/);
});

test("the job screen can issue and REVOKE the link", () => {
  assert.match(jobActions, /export async function sendAppointmentConfirmation/);
  assert.match(jobActions, /export async function revokeAppointmentLink/);
  const revoke = /export async function revokeAppointmentLink[\s\S]*?\n}/.exec(jobActions)[0];
  assert.match(revoke, /revoked_at: new Date\(\)\.toISOString\(\)/);
});

test("SMS consent is enforced, and an UNSET flag is refused too", () => {
  const send = /export async function sendAppointmentConfirmation[\s\S]*?\n}/.exec(jobActions)[0];
  // `!== true` refuses null as well as false: a query that forgot the column
  // would otherwise look like universal consent.
  assert.match(send, /sms_opt_in !== true/);
});

test("'on my way' now carries an ETA and a live page", () => {
  const onMyWay = /export async function setOnMyWay[\s\S]*?\n}/.exec(jobActions)[0];
  assert.match(onMyWay, /on_my_way_eta_minutes/);
  assert.match(onMyWay, /mintAppointmentToken/);
  assert.match(onMyWay, /\/visit/);
  assert.match(jobActions, /export async function markArrived/);
});

test("the arrival page exists and answers through the RPC", () => {
  assert.match(visitPage, /public_appointment/);
  assert.match(visitClient, /respond_to_appointment/);
  assert.match(visitClient, /arrivalState/);
});
