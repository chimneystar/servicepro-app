import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTOMATION_ACTIONS, AUTOMATION_LOOKBACK_DAYS, AUTOMATION_MAX_ATTEMPTS, AUTOMATION_TRIGGERS,
  DEFAULT_OVERDUE_DAYS, SUPPORTED_AUTOMATIONS, automationRefusalMessage, automationWindowStart,
  isStaleRun, isWithinWindow, nextRunAction, overdueEventDate, validateAutomationRule,
} from "../lib/core/automation.mjs";

// ---------------------------------------------------------------------------
// The support matrix. Every pair the UI can produce is either implemented or
// refused — proven in both directions, because a matrix that refused everything
// would look identical to the bug it replaces (a rule that never fires).
// ---------------------------------------------------------------------------

test("every supported pair is accepted", () => {
  for (const trigger of AUTOMATION_TRIGGERS) {
    for (const action of SUPPORTED_AUTOMATIONS[trigger]) {
      const result = validateAutomationRule({ triggerType: trigger, actionType: action, message: "Thanks!" });
      assert.equal(result.ok, true, `${trigger} → ${action} must be accepted`);
      assert.equal(result.rule.triggerType, trigger);
      assert.equal(result.rule.actionType, action);
    }
  }
});

test("create_task is refused for triggers that have no job to attach it to", () => {
  // job_tasks.job_id is NOT NULL. An estimate has no job at all and an
  // invoice's job_id is nullable, so these rules could only ever fire into a
  // void. Refusing at creation is the visible failure; accepting was the silent one.
  for (const trigger of ["estimate_sent", "invoice_overdue"]) {
    const result = validateAutomationRule({ triggerType: trigger, actionType: "create_task", message: "Call them" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "unsupported_combination");
  }
  // ...and it IS allowed where it works.
  assert.equal(validateAutomationRule({ triggerType: "job_completed", actionType: "create_task", message: "Call them" }).ok, true);
});

test("unknown triggers and actions are refused by name", () => {
  assert.equal(validateAutomationRule({ triggerType: "customer_birthday", actionType: "send_sms", message: "hi" }).reason, "unknown_trigger");
  assert.equal(validateAutomationRule({ triggerType: "job_completed", actionType: "call_customer", message: "hi" }).reason, "unknown_action");
  assert.equal(validateAutomationRule({}).reason, "unknown_trigger");
  assert.deepEqual(AUTOMATION_ACTIONS, ["send_sms", "send_email", "create_task"]);
});

test("a rule with no message is refused — it would send an empty text", () => {
  assert.equal(validateAutomationRule({ triggerType: "job_completed", actionType: "send_sms", message: "  " }).reason, "missing_message");
  assert.equal(validateAutomationRule({ triggerType: "job_completed", actionType: "send_sms" }).reason, "missing_message");
  assert.equal(validateAutomationRule({ triggerType: "job_completed", actionType: "send_sms", message: "x".repeat(1001) }).reason, "message_too_long");
});

test("overdue days are validated, and default to the 14 the product already uses", () => {
  const base = { triggerType: "invoice_overdue", actionType: "send_sms", message: "Past due" };
  assert.equal(validateAutomationRule(base).rule.overdueDays, DEFAULT_OVERDUE_DAYS);
  assert.equal(validateAutomationRule({ ...base, overdueDays: "" }).rule.overdueDays, 14);
  assert.equal(validateAutomationRule({ ...base, overdueDays: "30" }).rule.overdueDays, 30);
  for (const bad of ["0", "-5", "400", "7.5", "abc"]) {
    assert.equal(validateAutomationRule({ ...base, overdueDays: bad }).reason, "invalid_overdue_days", `${bad} must be refused`);
  }
});

test("every refusal reason has a message in both languages", () => {
  for (const reason of ["unknown_trigger", "unknown_action", "unsupported_combination", "missing_message", "message_too_long", "invalid_overdue_days"]) {
    const en = automationRefusalMessage(reason, false);
    const he = automationRefusalMessage(reason, true);
    assert.ok(en.length > 10, `${reason} needs an English message`);
    assert.ok(he.length > 5, `${reason} needs a Hebrew message`);
    assert.notEqual(en, he);
  }
});

// ---------------------------------------------------------------------------
// The firing window. This is what stops a newly created rule from texting five
// years of finished jobs the first night it runs.
// ---------------------------------------------------------------------------

const NOW = "2026-07-31T02:00:00.000Z";

test("a brand-new rule cannot reach back before it existed", () => {
  const created = "2026-07-30T18:00:00.000Z";
  assert.equal(automationWindowStart(created, NOW), created,
    "the rule's own creation is later than the lookback, so it wins");
  const source = "2026-07-01T12:00:00.000Z"; // an old completed job
  assert.equal(isWithinWindow(source, automationWindowStart(created, NOW), NOW), false);
});

test("an old rule is still bounded by the lookback", () => {
  const created = "2020-01-01T00:00:00.000Z";
  const start = automationWindowStart(created, NOW);
  assert.equal(start, "2026-07-29T02:00:00.000Z", `${AUTOMATION_LOOKBACK_DAYS} days before now`);
  // A cron outage must not produce a burst of back-dated messages.
  assert.equal(isWithinWindow("2026-07-10T00:00:00.000Z", start, NOW), false);
  // ...but yesterday's work still fires. The window is not a wall.
  assert.equal(isWithinWindow("2026-07-30T09:00:00.000Z", start, NOW), true);
});

test("the window rejects the future and survives a malformed created_at", () => {
  const start = automationWindowStart("2020-01-01T00:00:00.000Z", NOW);
  assert.equal(isWithinWindow("2026-08-05T00:00:00.000Z", start, NOW), false, "a future row is not due yet");
  assert.equal(isWithinWindow("nonsense", start, NOW), false);
  assert.equal(automationWindowStart(null, NOW), "2026-07-29T02:00:00.000Z", "a missing created_at falls back to the lookback");
  assert.throws(() => automationWindowStart("2020-01-01", "not-a-date"));
});

test("an invoice becomes overdue by the calendar, not by being edited", () => {
  assert.equal(overdueEventDate("2026-07-17", 14), "2026-07-31");
  assert.equal(overdueEventDate("2026-02-20", 14), "2026-03-06");
  assert.equal(overdueEventDate("2024-02-20", 14), "2024-03-05", "leap year");
  assert.equal(overdueEventDate("2026-07-17T10:00:00Z", 0), "2026-07-17");
  assert.throws(() => overdueEventDate("whenever", 14));
});

// ---------------------------------------------------------------------------
// Idempotency. automation_runs is both the audit record and the claim.
// ---------------------------------------------------------------------------

test("a source with no run yet is claimed", () => {
  assert.equal(nextRunAction(null), "claim");
  assert.equal(nextRunAction(undefined), "claim");
});

test("a succeeded run is NEVER re-fired — this is the double-send guard", () => {
  assert.equal(nextRunAction({ status: "succeeded", attempts: 1 }), "skip");
  assert.equal(nextRunAction({ status: "succeeded", attempts: 9 }), "skip");
});

test("a deliberate skip is terminal — an opt-out is not retried nightly", () => {
  assert.equal(nextRunAction({ status: "skipped", attempts: 1 }), "skip");
});

test("a failed run IS retried, within a budget", () => {
  assert.equal(nextRunAction({ status: "failed", attempts: 1 }), "retry");
  assert.equal(nextRunAction({ status: "failed", attempts: AUTOMATION_MAX_ATTEMPTS - 1 }), "retry");
  // ...and then stops, so a permanently broken rule does not burn provider
  // credit every night for ever.
  assert.equal(nextRunAction({ status: "failed", attempts: AUTOMATION_MAX_ATTEMPTS }), "skip");
  assert.equal(nextRunAction({ status: "failed", attempts: 99 }), "skip");
  assert.equal(nextRunAction({ status: "failed" }), "retry", "a missing attempt count is treated as none used");
});

test("a run still marked running is not re-fired behind its own back", () => {
  // Nobody can tell whether the SMS went out, so the safe answer is 'skip' plus
  // a loud log — not a second text to a real customer.
  assert.equal(nextRunAction({ status: "running", attempts: 1 }), "skip");
  assert.equal(nextRunAction({ status: "pending", attempts: 0 }), "skip");
});

test("a stale claim is detectable so it can be reported rather than lost", () => {
  assert.equal(isStaleRun({ status: "running", created_at: "2026-07-30T00:00:00.000Z" }, NOW), true);
  assert.equal(isStaleRun({ status: "running", created_at: "2026-07-31T01:30:00.000Z" }, NOW), false, "half an hour is not stale");
  assert.equal(isStaleRun({ status: "failed", created_at: "2026-07-01T00:00:00.000Z" }, NOW), false, "only a claim can be stale");
  assert.equal(isStaleRun(null, NOW), false);
});

// ---------------------------------------------------------------------------
// Structural guards (comments stripped first — these files describe the bug
// they fix in prose, and prose must not be able to satisfy the check).
// ---------------------------------------------------------------------------

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");
const readRaw = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("comment stripping works before anything is asserted on it", () => {
  const stripped = read("app/(app)/operations/actions.ts");
  assert.ok(!/stored-but-inert|quietly ignored/.test(stripped), "block comments must be removed");
  assert.ok(/createAutomation/.test(stripped), "code must survive stripping");
});

test("rule creation refuses an unsupported pair instead of storing it", () => {
  const src = read("app/(app)/operations/actions.ts");
  assert.ok(/validateAutomationRule\(/.test(src), "the action must run the tested validator");
  assert.ok(/automationRefusalMessage\(/.test(src), "the refusal must reach the operator, with its reason");
  // The regression: trigger_type / action_type taken straight from the form.
  assert.ok(!/trigger_type:\s*text\(form, "triggerType"\)/.test(src),
    "an unvalidated trigger must not be stored");
  assert.ok(!/action_type:\s*text\(form, "actionType"\)/.test(src),
    "an unvalidated action must not be stored");
});

test("the executor records every attempt in automation_runs", () => {
  const src = read("lib/cron-tasks.ts");
  assert.ok(/from\("automation_runs"\)[\s\S]{0,400}insert\(/.test(src), "a run row must be created to claim the work");
  for (const status of ["succeeded", "failed", "skipped"]) {
    assert.ok(new RegExp(`status: "${status}"`).test(src), `a ${status} outcome must be written back`);
  }
  assert.ok(/nextRunAction\(/.test(src), "the executor must use the tested claim state machine");
  assert.ok(/automationWindowStart\(/.test(src), "the executor must bound its window");
});

test("the executor is bounded — no unlimited scan of a customer's history", () => {
  const src = read("lib/cron-tasks.ts");
  assert.ok(/AUTOMATION_SOURCE_LIMIT/.test(src), "source rows per rule must be capped");
  assert.ok(/\.limit\(AUTOMATION_SOURCE_LIMIT\)/.test(src));
});

test("migration 032 gives automation_runs its idempotency key and drops nothing", () => {
  const sql = readRaw("db/032_automation_execution.sql");
  assert.ok(/create unique index if not exists uq_automation_runs_rule_source/.test(sql),
    "without a unique index two concurrent crons could both claim the same source");
  assert.ok(/on public\.automation_runs \(rule_id, source_id\)/.test(sql));
  // The branch rule: a migration may add, never remove.
  const statements = sql.replace(/--.*$/gm, "");
  assert.ok(!/\bdrop\s+table\b/i.test(statements), "no table may be dropped");
  assert.ok(!/\bdrop\s+column\b/i.test(statements), "no column may be dropped");
  assert.ok(!/\bdelete\s+from\b/i.test(statements), "no data may be deleted");
  // Re-runnable.
  for (const guard of ["create table if not exists", "add column if not exists", "create index if not exists"]) {
    assert.ok(sql.includes(guard), `migration must be idempotent (${guard})`);
  }
});

test("migration 032 only references columns that exist", () => {
  // Several defects this session came from assuming a column name. Everything
  // 032 touches is checked against the migration that created it.
  const sql = readRaw("db/032_automation_execution.sql");
  const runs = readRaw("db/019_operations_growth.sql");
  assert.ok(/create table if not exists public\.automation_runs \([\s\S]*?rule_id[\s\S]*?source_id[\s\S]*?attempts/.test(runs),
    "automation_runs must really have rule_id, source_id and attempts");
  assert.ok(/create table if not exists public\.estimate_followups/.test(runs));
  assert.ok(/create table if not exists public\.campaigns/.test(runs));
  // campaign_deliveries is new here, and its parents are the two tables above.
  assert.ok(/references public\.campaigns\(id\)/.test(sql));
  assert.ok(/references public\.customers\(id\)/.test(sql));
  assert.ok(/unique \(campaign_id, customer_id, channel\)/.test(sql),
    "per-recipient uniqueness is what makes a resumed campaign safe");
});
