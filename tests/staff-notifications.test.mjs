import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripSqlComments } from "./helpers/sql.mjs";
import {
  STAFF_NOTIFICATION_TYPES, deliveryPlan, isStaffNotificationType, notificationKey,
  notificationOutcome, paymentNotificationRecipients, staffEmailEligibility, staffNotification,
} from "../lib/core/staff-notify.mjs";

// ---------------------------------------------------------------------------
// The claim key. A key that silently collapses deduplicates the whole business
// down to one notification, so every missing part must THROW rather than blank.
// ---------------------------------------------------------------------------

test("the notification key is deterministic and includes every part", () => {
  const key = notificationKey({ type: "job_assigned", relatedType: "job", relatedId: "j1", profileId: "p1" });
  assert.equal(key, "job_assigned:job:j1:p1");
  assert.equal(key, notificationKey({ type: "job_assigned", relatedType: "job", relatedId: "j1", profileId: "p1" }));
});

test("two different technicians on the same job get DIFFERENT keys", () => {
  const a = notificationKey({ type: "job_assigned", relatedType: "job", relatedId: "j1", profileId: "p1" });
  const b = notificationKey({ type: "job_assigned", relatedType: "job", relatedId: "j1", profileId: "p2" });
  assert.notEqual(a, b);
});

test("a missing part throws instead of producing a colliding key", () => {
  assert.throws(() => notificationKey({ type: "job_assigned", relatedType: "job", relatedId: "", profileId: "p1" }));
  assert.throws(() => notificationKey({ type: "job_assigned", relatedType: "job", relatedId: "j1", profileId: "" }));
  assert.throws(() => notificationKey({ type: "nonsense", relatedType: "job", relatedId: "j1", profileId: "p1" }));
});

test("only the declared notification types are accepted", () => {
  assert.equal(isStaffNotificationType("payment_received"), true);
  assert.equal(isStaffNotificationType("send_everything"), false);
  assert.equal(STAFF_NOTIFICATION_TYPES.includes("job_assigned"), true);
});

// ---------------------------------------------------------------------------
// The words, in both languages, and the URL that must resolve.
// ---------------------------------------------------------------------------

test("an assignment notification names the service, the customer and the time", () => {
  const n = staffNotification({
    type: "job_assigned", locale: "en", service: "Boiler service", customerName: "Dana Levi",
    scheduledDate: "2026-08-04", startTime: "09:30:00", jobId: "job-7",
  });
  assert.match(n.title, /assigned/i);
  assert.match(n.body, /Boiler service/);
  assert.match(n.body, /Dana Levi/);
  assert.match(n.body, /2026-08-04 09:30/);
  assert.equal(n.url, "/jobs/job-7");
});

test("a job with no time yet does not invent one", () => {
  const n = staffNotification({ type: "job_assigned", service: "Repair", jobId: "j" });
  assert.doesNotMatch(n.body, /undefined|NaN|—/);
});

test("Hebrew is a real translation, not the English string", () => {
  const en = staffNotification({ type: "job_assigned", locale: "en", service: "x", jobId: "j" });
  const he = staffNotification({ type: "job_assigned", locale: "he", service: "x", jobId: "j" });
  assert.notEqual(en.title, he.title);
  assert.match(he.title, /[֐-׿]/);
});

test("a payment notification carries the amount the caller formatted", () => {
  const n = staffNotification({
    type: "payment_received", amountLabel: "$412.50", customerName: "Dana Levi",
    invoiceNumber: "5012", invoiceId: "inv-1",
  });
  assert.match(n.title, /\$412\.50/);
  assert.match(n.body, /5012/);
  assert.equal(n.url, "/invoices/inv-1");
});

test("an unknown notification type is refused, never rendered blank", () => {
  assert.throws(() => staffNotification({ type: "wire_transfer" }));
});

// ---------------------------------------------------------------------------
// Recipients. Proven both ways: the wrong people are excluded AND the right
// people are actually included.
// ---------------------------------------------------------------------------

const team = [
  { id: "owner-1", role: "owner", active: true, can_manage_payments: false },
  { id: "office-yes", role: "office", active: true, can_manage_payments: true },
  { id: "office-no", role: "office", active: true, can_manage_payments: false },
  { id: "tech-1", role: "tech", active: true, can_manage_payments: true },
  { id: "owner-inactive", role: "owner", active: false, can_manage_payments: true },
];

test("payment notifications reach owners and finance-capable office members only", () => {
  assert.deepEqual(paymentNotificationRecipients(team), ["owner-1", "office-yes"]);
});

test("an office member without payments access is NOT told about a payment", () => {
  assert.equal(paymentNotificationRecipients(team).includes("office-no"), false);
});

test("a deactivated owner stops receiving notifications", () => {
  assert.equal(paymentNotificationRecipients(team).includes("owner-inactive"), false);
});

test("a technician is never told about money", () => {
  assert.equal(paymentNotificationRecipients(team).includes("tech-1"), false);
});

// ---------------------------------------------------------------------------
// Consent. Staff email defers to the SHARED contactEligibility rule, so the
// non-boolean refusal is inherited rather than re-implemented.
// ---------------------------------------------------------------------------

test("a teammate who turned notification email off is refused", () => {
  const result = staffEmailEligibility({ email: "sam@example.com", notify_email_opt_in: false, active: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "email_opt_out");
});

test("a teammate who left it on IS emailable — the gate is proven in both directions", () => {
  const result = staffEmailEligibility({ email: "sam@example.com", notify_email_opt_in: true, active: true });
  assert.deepEqual(result, { ok: true, to: "sam@example.com" });
});

test("a profile selected WITHOUT the opt-in column is refused, not assumed to consent", () => {
  assert.equal(staffEmailEligibility({ email: "sam@example.com", active: true }).reason, "email_opt_in_unknown");
  assert.equal(staffEmailEligibility({ email: "sam@example.com", notify_email_opt_in: null, active: true }).reason, "email_opt_in_unknown");
  assert.equal(staffEmailEligibility({ email: "sam@example.com", notify_email_opt_in: "true", active: true }).reason, "email_opt_in_unknown");
});

test("an inactive teammate is treated exactly as a deleted contact", () => {
  const result = staffEmailEligibility({ email: "sam@example.com", notify_email_opt_in: true, active: false });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "customer_deleted");
});

test("staff eligibility DELEGATES to the shared rule rather than re-implementing it", () => {
  const source = readFileSync(new URL("../lib/core/staff-notify.mjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  assert.match(source, /import\s*\{\s*contactEligibility\s*\}\s*from\s*"\.\/outreach\.mjs"/);
  // The tell-tale of a second copy: the module must not test the flag itself.
  assert.doesNotMatch(source, /email_opt_in\s*===\s*false/);
  assert.doesNotMatch(source, /typeof\s+\w+\.email_opt_in/);
});

// ---------------------------------------------------------------------------
// The email fallback — the point of the whole item.
// ---------------------------------------------------------------------------

test("email is NOT sent when the push actually landed on a device", () => {
  const plan = deliveryPlan({ pushAvailable: true, pushDelivered: 2, emailAvailable: true, emailEligible: true });
  assert.deepEqual(plan.channels, ["inapp", "push"]);
  assert.equal(plan.emailFallback, false);
  assert.equal(plan.emailSkipReason, "push_delivered");
});

test("email IS sent when push delivered to nobody — the silence this item removes", () => {
  const plan = deliveryPlan({ pushAvailable: true, pushDelivered: 0, emailAvailable: true, emailEligible: true });
  assert.deepEqual(plan.channels, ["inapp", "push", "email"]);
  assert.equal(plan.emailFallback, true);
});

test("email IS sent when push is not configured at all", () => {
  const plan = deliveryPlan({ pushAvailable: false, emailAvailable: true, emailEligible: true });
  assert.deepEqual(plan.channels, ["inapp", "email"]);
});

test("an urgent notification emails even when the push landed", () => {
  const plan = deliveryPlan({ pushAvailable: true, pushDelivered: 1, emailAvailable: true, emailEligible: true, urgent: true });
  assert.equal(plan.emailFallback, true);
});

test("a refused email is skipped WITH its reason, never silently", () => {
  assert.equal(deliveryPlan({ pushAvailable: false, emailAvailable: false }).emailSkipReason, "no_email_provider");
  assert.equal(deliveryPlan({ pushAvailable: false, emailAvailable: true, emailEligible: false }).emailSkipReason, "not_eligible");
});

test("the in-app inbox row is always attempted, whatever else is available", () => {
  for (const input of [{}, { pushAvailable: true }, { emailAvailable: true }]) {
    assert.equal(deliveryPlan(input).channels[0], "inapp");
  }
});

// ---------------------------------------------------------------------------
// Outcome reporting — "inbox only" is an honest state, not a failure.
// ---------------------------------------------------------------------------

test("inbox-only is reported as inbox_only, not as success and not as failure", () => {
  const out = notificationOutcome({ inapp: { recorded: true }, push: { delivered: 0 }, email: { sent: false } });
  assert.equal(out.status, "inbox_only");
  assert.equal(out.ok, true);
  assert.deepEqual(out.reached, []);
});

test("a reached channel is named", () => {
  const out = notificationOutcome({ inapp: { recorded: true }, push: { delivered: 3 }, email: { sent: true } });
  assert.equal(out.status, "sent");
  assert.deepEqual(out.reached, ["push", "email"]);
});

test("losing even the inbox row is a failure, not a quiet success", () => {
  const out = notificationOutcome({ inapp: { recorded: false }, push: { delivered: 0 }, email: { sent: false } });
  assert.equal(out.status, "failed");
  assert.equal(out.ok, false);
});

// ---------------------------------------------------------------------------
// Structural: the sender must exist, must reuse lib/push.ts, and must claim
// before it sends. Comments are stripped so a promise in prose cannot pass.
// ---------------------------------------------------------------------------

const code = (path) => readFileSync(new URL(path, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

test("lib/notify.ts sends staff notifications through the EXISTING push sender", () => {
  const notify = code("../lib/notify.ts");
  assert.match(notify, /from\s*"@\/lib\/push"/);
  assert.match(notify, /sendPushToProfile/);
  // A second web-push implementation would be the defect. There must be none.
  assert.doesNotMatch(notify, /aes128gcm|encryptPushPayload|buildVapidAuthorization/);
});

test("the staff notification claims its inbox row BEFORE sending, and releases on failure", () => {
  const notify = code("../lib/notify.ts");
  // The INSERT, not the import line, is the claim. Comparing against the
  // import would pass however the function were ordered.
  const claimAt = notify.indexOf('from("staff_notifications").insert');
  const sendAt = notify.indexOf("await sendPushToProfile(");
  assert.ok(claimAt > -1, "the inbox row must be inserted");
  assert.ok(sendAt > -1, "the existing push sender must be used");
  assert.ok(claimAt < sendAt, "the inbox row must be claimed before the push is attempted");
  // ...and released, so a transient failure cannot suppress the notification
  // permanently the way an un-released reminder_log row would.
  assert.match(notify, /from\("staff_notifications"\)\.delete\(\)/, "a failed claim must be released");
  const releaseAt = notify.indexOf('from("staff_notifications").delete()');
  assert.ok(releaseAt > sendAt, "the release must be in the failure path, after the attempt");
});

test("the email address is RESOLVED — `profiles` has no email column", () => {
  // Without this step every staff email would be refused as `no_email` and the
  // fallback would silently never fire. The login address lives in auth.users
  // and only the service role can read it.
  const notify = code("../lib/notify.ts");
  assert.match(notify, /auth\.admin\.getUserById/);
  assert.match(notify, /notify_email/);
  assert.match(notify, /export async function staffContact/);
  // The opt-out is still checked by the SHARED rule, and before the lookup.
  const contact = notify.slice(notify.indexOf("export async function staffContact"));
  const gateAt = contact.indexOf("staffEmailEligibility");
  const lookupAt = contact.indexOf("resolveStaffEmail");
  assert.ok(gateAt > -1 && lookupAt > -1 && gateAt < lookupAt, "consent must be checked before the address is looked up");
});

test("the cron uses the SAME resolution, not a second copy", () => {
  const cron = code("../lib/cron-tasks.ts");
  assert.match(cron, /import\s*\{\s*staffContact\s*\}\s*from\s*"@\/lib\/notify"/);
  assert.doesNotMatch(cron, /auth\.admin\.getUserById/, "a second address resolver would drift");
});

test("job assignment now raises a staff notification, not only a push", () => {
  const push = code("../lib/push.ts");
  assert.match(push, /notifyJobAssigned/);
  const notify = code("../lib/notify.ts");
  assert.match(notify, /notifyJobAssignedStaff|notifyStaff/);
});

test("migration 040 creates the inbox with a UNIQUE claim, and drops nothing", () => {
  const sql = stripSqlComments(readFileSync(new URL("../db/040_communications.sql", import.meta.url), "utf8"));
  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+public\.staff_notifications/i);
  assert.match(sql, /unique\s*\(\s*organization_id\s*,\s*dedupe_key\s*\)/i);
  assert.doesNotMatch(sql, /drop\s+table/i);
  assert.doesNotMatch(sql, /drop\s+column/i);
});
