import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CAMPAIGN_SEGMENTS, INACTIVE_AFTER_DAYS, OUTREACH_CHANNELS, PAST_DUE_AFTER_DAYS,
  campaignChannels, contactEligibility, isKnownSegment, isoDaysBefore, truncateForSms,
} from "../lib/core/outreach.mjs";

// ---------------------------------------------------------------------------
// Consent. This is the legal one: a customer who replied STOP must not receive
// marketing. Proven in BOTH directions — refused when opted out, and actually
// sent when opted in, because a gate that only ever refuses would "pass" while
// silently sending nothing at all.
// ---------------------------------------------------------------------------

const optedIn = { name: "Dana Levi", phone: "+15125550100", email: "dana@example.com", sms_opt_in: true, email_opt_in: true };

test("a customer who replied STOP is refused on SMS, with the reason", () => {
  const result = contactEligibility({ ...optedIn, sms_opt_in: false }, "sms");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "sms_opt_out");
});

test("an email unsubscribe is refused on email, with the reason", () => {
  const result = contactEligibility({ ...optedIn, email_opt_in: false }, "email");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "email_opt_out");
});

test("opting out of one channel does NOT block the other", () => {
  // The over-correction is its own bug: replying STOP to texts must not also
  // stop the invoices a customer asked to receive by email.
  assert.deepEqual(contactEligibility({ ...optedIn, sms_opt_in: false }, "email"), { ok: true, to: "dana@example.com" });
  assert.deepEqual(contactEligibility({ ...optedIn, email_opt_in: false }, "sms"), { ok: true, to: "+15125550100" });
});

test("an opted-in customer IS contactable on both channels", () => {
  assert.deepEqual(contactEligibility(optedIn, "sms"), { ok: true, to: "+15125550100" });
  assert.deepEqual(contactEligibility(optedIn, "email"), { ok: true, to: "dana@example.com" });
});

test("a missing opt-in flag is refused rather than assumed to be consent", () => {
  // If a query forgets to select sms_opt_in, every row looks like consent.
  // That is how an entire opted-out list gets messaged, so `undefined` refuses.
  const { sms_opt_in, email_opt_in, ...noFlags } = optedIn;
  assert.equal(contactEligibility(noFlags, "sms").reason, "sms_opt_in_unknown");
  assert.equal(contactEligibility(noFlags, "email").reason, "email_opt_in_unknown");
  assert.equal(contactEligibility({ ...optedIn, sms_opt_in: null }, "sms").reason, "sms_opt_in_unknown");
});

test("missing or placeholder contact details are refused, not sent to", () => {
  assert.equal(contactEligibility({ ...optedIn, phone: "—" }, "sms").reason, "no_phone");
  assert.equal(contactEligibility({ ...optedIn, phone: "  " }, "sms").reason, "no_phone");
  assert.equal(contactEligibility({ ...optedIn, email: null }, "email").reason, "no_email");
  assert.equal(contactEligibility({ ...optedIn, email: "not-an-address" }, "email").reason, "no_email");
});

test("a deleted customer is never contacted, however they are opted in", () => {
  const deleted = { ...optedIn, deleted_at: "2026-01-01T00:00:00.000Z" };
  assert.equal(contactEligibility(deleted, "sms").reason, "customer_deleted");
  assert.equal(contactEligibility(deleted, "email").reason, "customer_deleted");
});

test("an unknown channel or missing customer refuses instead of throwing", () => {
  assert.equal(contactEligibility(optedIn, "carrier-pigeon").reason, "unknown_channel");
  assert.equal(contactEligibility(null, "sms").reason, "no_customer");
  assert.equal(contactEligibility(undefined, "email").reason, "no_customer");
  assert.deepEqual(OUTREACH_CHANNELS, ["sms", "email"]);
});

// ---------------------------------------------------------------------------
// Channel and segment expansion.
// ---------------------------------------------------------------------------

test("campaign channels expand exactly, and an unknown channel expands to nothing", () => {
  assert.deepEqual(campaignChannels("email"), ["email"]);
  assert.deepEqual(campaignChannels("sms"), ["sms"]);
  assert.deepEqual(campaignChannels("both"), ["email", "sms"]);
  // Not ["email"] and not everything: an unrecognised channel must send nothing.
  assert.deepEqual(campaignChannels("fax"), []);
  assert.deepEqual(campaignChannels(undefined), []);
});

test("only the three implemented segments are accepted", () => {
  for (const segment of CAMPAIGN_SEGMENTS) assert.equal(isKnownSegment(segment), true);
  for (const segment of ["", "everyone", "vip", null, undefined]) assert.equal(isKnownSegment(segment), false);
});

// ---------------------------------------------------------------------------
// Date maths used to build the past-due and inactive audiences.
// ---------------------------------------------------------------------------

test("isoDaysBefore counts calendar days, across month and year boundaries", () => {
  assert.equal(isoDaysBefore("2026-07-31", 14), "2026-07-17");
  assert.equal(isoDaysBefore("2026-03-01", 1), "2026-02-28");
  assert.equal(isoDaysBefore("2024-03-01", 1), "2024-02-29", "leap year");
  assert.equal(isoDaysBefore("2026-01-05", 10), "2025-12-26");
  assert.equal(isoDaysBefore("2026-07-31T23:30:00.000Z", 0), "2026-07-31", "a timestamp is accepted");
  assert.throws(() => isoDaysBefore("not-a-date", 1));
});

test("the audience thresholds match the definitions the screens promise", () => {
  assert.equal(PAST_DUE_AFTER_DAYS, 14, "same 14 days the overdue nudge already uses");
  assert.equal(INACTIVE_AFTER_DAYS, 365);
});

test("SMS bodies are truncated so one blast cannot silently cost six segments", () => {
  assert.equal(truncateForSms("short message"), "short message");
  const long = "x".repeat(600);
  assert.equal(truncateForSms(long).length, 480);
  assert.ok(truncateForSms(long).endsWith("…"));
  assert.equal(truncateForSms("  padded  "), "padded");
});

// ---------------------------------------------------------------------------
// Structural guards. Comments are stripped first: every one of these files
// DESCRIBES the opt-out rule in prose, so a naive scan matches the description
// and reports a compliance that is not there.
// ---------------------------------------------------------------------------

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

test("comment stripping works before anything is asserted on it", () => {
  const stripped = read("lib/cron-tasks.ts");
  assert.ok(!/legal problem/.test(stripped), "block comments must be removed");
  assert.ok(/runGrowthOutreach/.test(stripped), "code must survive stripping");
});

test("every new sending path checks consent through the tested rule", () => {
  const cron = read("lib/cron-tasks.ts");
  assert.ok(/contactEligibility\(/.test(cron), "the cron sender must consult the consent rule");
  // Two senders (campaigns, estimate follow-ups) plus the automation actions.
  assert.ok((cron.match(/contactEligibility\(/g) ?? []).length >= 3,
    "each of the campaign, follow-up and automation paths must check consent");
  const growth = read("app/(app)/growth/actions.ts");
  assert.ok(/contactEligibility\(/.test(growth), "issuing a referral code must check consent too");
});

test("the campaign sender records a refusal instead of skipping in silence", () => {
  const cron = read("lib/cron-tasks.ts");
  assert.ok(/status: "skipped", reason: eligibility\.reason/.test(cron),
    "a customer deliberately not contacted must be as visible as one who was");
});

test("a failed send releases its claim so it can be retried", () => {
  const cron = read("lib/cron-tasks.ts");
  assert.ok(/status: "failed"/.test(cron), "failures must be recorded, not swallowed");
  assert.ok(/retryable \? "scheduled" : "sent"/.test(cron),
    "a campaign with retryable failures must go back to scheduled, not be declared sent");
  assert.ok(/exhausted \? "failed" : "scheduled"/.test(cron),
    "a follow-up must retry within a budget and then fail visibly");
});

test("the daily cron actually invokes both new senders", () => {
  const route = read("app/api/cron/daily/route.ts");
  assert.ok(/runAutomationRules/.test(route), "automation rules must run on the daily cron");
  assert.ok(/runGrowthOutreach/.test(route), "campaigns and follow-ups must run on the daily cron");
});
