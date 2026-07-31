import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripSqlComments } from "./helpers/sql.mjs";
import {
  AGING_BUCKETS, CHARGEABLE_INVOICE_STATUSES, DUNNING_LADDER, DUNNING_STAGES,
  agingBucket, buildStatement, daysBetween, dunningKey, dunningMessage, dunningRung,
  nextDunningStage, statementMessage,
} from "../lib/core/statements.mjs";
import { collectedMinor } from "../lib/core/reporting.mjs";

const settled = (over) => ({ normalized_status: "settled", refunded_minor: 0, ...over });

// ---------------------------------------------------------------------------
// The statement. Integer-exact, and it must agree with the revenue report.
// ---------------------------------------------------------------------------

const invoices = [
  { id: "i1", number: 5001, issue_date: "2026-01-10", total_minor: 100000, status: "paid" },
  { id: "i2", number: 5002, issue_date: "2026-05-01", total_minor: 45000, status: "unpaid" },
  { id: "i3", number: 5003, issue_date: "2026-06-15", total_minor: 20000, status: "unpaid" },
];
const payments = [
  settled({ invoice_id: "i1", paid_at: "2026-01-20T10:00:00Z", base_amount_minor: 100000, method: "card" }),
  settled({ invoice_id: "i2", paid_at: "2026-05-20T10:00:00Z", base_amount_minor: 15000, method: "cash" }),
];

test("the closing balance is charges minus collected cash, to the cent", () => {
  const s = buildStatement({ invoices, payments, asOf: "2026-07-01" });
  assert.equal(s.chargesMinor, 165000);
  assert.equal(s.paymentsMinor, 115000);
  assert.equal(s.balanceMinor, 50000);
});

test("the running balance on the last line equals the closing balance", () => {
  const s = buildStatement({ invoices, payments, asOf: "2026-07-01" });
  assert.equal(s.lines[s.lines.length - 1].balanceMinor, s.balanceMinor);
});

test("cash is computed by the SHARED reporting rule, not re-summed here", () => {
  const s = buildStatement({ invoices, payments, asOf: "2026-07-01" });
  assert.equal(s.paymentsMinor, collectedMinor(payments));
  const source = readFileSync(new URL("../lib/core/statements.mjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  assert.match(source, /import\s*\{\s*collectedMinor\s*\}\s*from\s*"\.\/reporting\.mjs"/);
  assert.doesNotMatch(source, /normalized_status/, "a second copy of the collected-status rule would drift");
});

test("a failed card does not reduce what the customer owes", () => {
  const withFailure = [...payments, { invoice_id: "i3", paid_at: "2026-06-20T10:00:00Z", base_amount_minor: 20000, normalized_status: "failed" }];
  const s = buildStatement({ invoices, payments: withFailure, asOf: "2026-07-01" });
  assert.equal(s.balanceMinor, 50000);
});

test("a refund is added back to the balance", () => {
  const refunded = [settled({ invoice_id: "i1", paid_at: "2026-01-20T10:00:00Z", base_amount_minor: 100000, refunded_minor: 25000 })];
  const s = buildStatement({ invoices: [invoices[0]], payments: refunded, asOf: "2026-07-01" });
  assert.equal(s.paymentsMinor, 75000);
  assert.equal(s.balanceMinor, 25000);
});

test("a draft or void invoice is NEVER billed on a statement", () => {
  const withDraft = [...invoices, { id: "i9", number: 5009, issue_date: "2026-06-20", total_minor: 999900, status: "draft" }];
  assert.equal(buildStatement({ invoices: withDraft, payments, asOf: "2026-07-01" }).balanceMinor, 50000);
  const withVoid = [...invoices, { id: "i8", number: 5008, issue_date: "2026-06-20", total_minor: 999900, status: "void" }];
  assert.equal(buildStatement({ invoices: withVoid, payments, asOf: "2026-07-01" }).balanceMinor, 50000);
  // ...and the statuses that ARE billed still are.
  assert.deepEqual([...CHARGEABLE_INVOICE_STATUSES].sort(), ["overdue", "paid", "unpaid"]);
});

test("a deleted invoice is excluded even when its status says unpaid", () => {
  const withDeleted = [...invoices, { id: "i7", number: 5007, issue_date: "2026-06-20", total_minor: 5000, status: "unpaid", deleted_at: "2026-06-21T00:00:00Z" }];
  assert.equal(buildStatement({ invoices: withDeleted, payments, asOf: "2026-07-01" }).balanceMinor, 50000);
});

test("a payment against an invoice not on this statement cannot reduce the balance", () => {
  const foreign = [...payments, settled({ invoice_id: "someone-elses", paid_at: "2026-06-01T00:00:00Z", base_amount_minor: 50000 })];
  assert.equal(buildStatement({ invoices, payments: foreign, asOf: "2026-07-01" }).balanceMinor, 50000);
});

test("nothing dated after asOf appears on the statement", () => {
  const s = buildStatement({ invoices, payments, asOf: "2026-05-10" });
  assert.equal(s.lines.some((l) => l.date > "2026-05-10"), false);
  assert.equal(s.balanceMinor, 100000 + 45000 - 100000);
});

test("a windowed statement folds earlier activity into the OPENING balance, losing nothing", () => {
  const full = buildStatement({ invoices, payments, asOf: "2026-07-01" });
  const windowed = buildStatement({ invoices, payments, asOf: "2026-07-01", since: "2026-05-01" });
  assert.equal(windowed.openingMinor, 0); // i1 charged 1000.00 and paid 1000.00 before the window
  assert.equal(windowed.balanceMinor, full.balanceMinor, "a narrower window must not change what is owed");
  assert.ok(windowed.lines.length < full.lines.length);
});

test("an unpaid invoice from before the window still shows in the opening balance", () => {
  const s = buildStatement({ invoices, payments: [], asOf: "2026-07-01", since: "2026-05-01" });
  assert.equal(s.openingMinor, 100000);
  assert.equal(s.balanceMinor, 165000);
});

test("an invalid asOf is refused rather than silently producing an empty statement", () => {
  assert.throws(() => buildStatement({ invoices, payments, asOf: "not-a-date" }));
});

// ---------------------------------------------------------------------------
// Aging.
// ---------------------------------------------------------------------------

test("aging splits per open invoice, not by one age for the account", () => {
  const s = buildStatement({ invoices, payments, asOf: "2026-07-01" });
  // i2 issued 2026-05-01 -> 61 days, 300.00 outstanding. i3 -> 16 days, 200.00.
  assert.equal(s.aging.current, 20000);
  assert.equal(s.aging.d61_90, 30000);
  assert.equal(s.aging.d31_60, 0);
  assert.equal(s.pastDueMinor, 30000);
});

test("a fully paid invoice appears in no aging bucket", () => {
  const s = buildStatement({ invoices: [invoices[0]], payments: [payments[0]], asOf: "2026-07-01" });
  assert.equal(Object.values(s.aging).reduce((a, b) => a + b, 0), 0);
  assert.equal(s.openInvoices.length, 0);
});

test("bucket boundaries are exact on both sides", () => {
  assert.equal(agingBucket(0), "current");
  assert.equal(agingBucket(30), "current");
  assert.equal(agingBucket(31), "d31_60");
  assert.equal(agingBucket(60), "d31_60");
  assert.equal(agingBucket(61), "d61_90");
  assert.equal(agingBucket(90), "d61_90");
  assert.equal(agingBucket(91), "d90_plus");
  assert.equal(agingBucket(100000), "d90_plus");
  assert.equal(AGING_BUCKETS.length, 4);
});

test("day counting is UTC-anchored and survives a DST boundary", () => {
  assert.equal(daysBetween("2026-03-01", "2026-03-31"), 30);
  assert.equal(daysBetween("2026-03-07", "2026-03-09"), 2); // US DST weekend
  assert.equal(daysBetween("2026-07-01", "2026-07-01"), 0);
});

// ---------------------------------------------------------------------------
// The dunning ladder — the escalation that ENDS.
// ---------------------------------------------------------------------------

test("nothing is sent before the first rung is earned", () => {
  assert.equal(nextDunningStage({ ageDays: 6, outstandingMinor: 10000 }, []), null);
});

test("each rung fires in turn as the invoice ages", () => {
  const at = (days, sent) => nextDunningStage({ ageDays: days, outstandingMinor: 10000 }, sent)?.stage ?? null;
  assert.equal(at(7, []), "reminder");
  assert.equal(at(14, ["reminder"]), "overdue");
  assert.equal(at(30, ["reminder", "overdue"]), "second_notice");
  assert.equal(at(45, ["reminder", "overdue", "second_notice"]), "final_notice");
});

test("a rung is never sent twice", () => {
  assert.equal(nextDunningStage({ ageDays: 20, outstandingMinor: 10000 }, ["reminder", "overdue"]), null);
});

test("the ladder ENDS — after the final notice nothing more is ever sent", () => {
  const all = [...DUNNING_STAGES];
  for (const age of [45, 100, 400, 5000]) {
    assert.equal(nextDunningStage({ ageDays: age, outstandingMinor: 10000 }, all), null);
  }
});

test("switching this on against an ancient invoice sends ONE final notice, not four messages", () => {
  // The whole point of taking the HIGHEST earned rung rather than the lowest
  // unsent one: a 300-day-old book must not produce a four-night barrage.
  const first = nextDunningStage({ ageDays: 300, outstandingMinor: 10000 }, []);
  assert.equal(first.stage, "final_notice");
  assert.equal(nextDunningStage({ ageDays: 301, outstandingMinor: 10000 }, ["final_notice"]), null);
});

test("the ladder never goes backwards", () => {
  // A final notice went out; an earlier rung was somehow never recorded. It
  // must not now be sent, because that reads as de-escalation to the customer.
  assert.equal(nextDunningStage({ ageDays: 60, outstandingMinor: 10000 }, ["final_notice"]), null);
});

test("a settled invoice is dunned no further, whatever its age", () => {
  assert.equal(nextDunningStage({ ageDays: 400, outstandingMinor: 0 }, []), null);
  assert.equal(nextDunningStage({ ageDays: 400, outstandingMinor: -500 }, []), null);
});

test("the ladder's rungs are strictly increasing in both age and severity", () => {
  for (let i = 1; i < DUNNING_LADDER.length; i++) {
    assert.ok(DUNNING_LADDER[i].afterDays > DUNNING_LADDER[i - 1].afterDays);
    assert.ok(DUNNING_LADDER[i].severity > DUNNING_LADDER[i - 1].severity);
  }
});

test("the claim key is unique per invoice and stage, and refuses nonsense", () => {
  assert.equal(dunningKey("inv-1", "overdue"), "inv-1:overdue");
  assert.notEqual(dunningKey("inv-1", "overdue"), dunningKey("inv-1", "reminder"));
  assert.throws(() => dunningKey("", "overdue"));
  assert.throws(() => dunningKey("inv-1", "shouting"));
});

test("each rung has a channel and its own escalating words", () => {
  const bodies = new Set();
  for (const stage of DUNNING_STAGES) {
    const m = dunningMessage({ stage, firstName: "Dana", businessName: "Acme", invoiceNumber: "5012", amountLabel: "$450.00", balanceLabel: "$500.00", link: "https://x/p/t" });
    assert.equal(m.channel, dunningRung(stage).channel);
    assert.match(m.body, /Dana/);
    assert.match(m.body, /Acme/);
    assert.match(m.body, /5012/);
    assert.match(m.body, /https:\/\/x\/p\/t/);
    bodies.add(m.body);
  }
  assert.equal(bodies.size, DUNNING_STAGES.length, "every rung must say something different");
});

test("the final notice says what happens next; the first reminder does not threaten", () => {
  const base = { businessName: "Acme", invoiceNumber: "1", amountLabel: "$1.00", balanceLabel: "$1.00" };
  assert.match(dunningMessage({ ...base, stage: "final_notice" }).body, /collection/i);
  assert.doesNotMatch(dunningMessage({ ...base, stage: "reminder" }).body, /collection/i);
});

test("a message with no payment link contains no dangling text", () => {
  const m = dunningMessage({ stage: "overdue", businessName: "Acme", invoiceNumber: "1", amountLabel: "$1.00", balanceLabel: "$1.00" });
  assert.doesNotMatch(m.body, /undefined|null|here:\s*$/);
});

test("dunning messages exist in Hebrew too", () => {
  const he = dunningMessage({ stage: "overdue", locale: "he", businessName: "אקמה", invoiceNumber: "1", amountLabel: "₪1", balanceLabel: "₪1" });
  assert.match(he.body, /[֐-׿]/);
});

test("the statement covering note carries the balance and the date", () => {
  const m = statementMessage({ firstName: "Dana", businessName: "Acme", balanceLabel: "$500.00", asOf: "2026-07-01", link: "https://x/s" });
  assert.match(m.subject, /2026-07-01/);
  assert.match(m.body, /\$500\.00/);
  assert.match(m.body, /https:\/\/x\/s/);
});

// ---------------------------------------------------------------------------
// Structural: consent, claim-then-release, and a migration that drops nothing.
// ---------------------------------------------------------------------------

const code = (path) => readFileSync(new URL(path, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

test("the dunning sender honours the SHARED opt-out rule", () => {
  const cron = code("../lib/cron-tasks.ts");
  assert.match(cron, /runDunning/);
  const start = cron.indexOf("export async function runDunning");
  assert.ok(start > -1);
  const body = cron.slice(start, start + 7000);
  assert.match(body, /contactEligibility/);
  assert.doesNotMatch(body, /sms_opt_in\s*===\s*false/, "an inline consent check would be the second copy");
});

test("the dunning sender claims, and RELEASES the claim on failure", () => {
  const cron = code("../lib/cron-tasks.ts");
  const start = cron.indexOf("export async function runDunning");
  const body = cron.slice(start, start + 7000);
  assert.match(body, /dunning_events/);
  assert.match(body, /status:\s*"failed"|status:\s*'failed'/);
  assert.match(body, /catch/);
});

test("statement sending honours opt-out too", () => {
  const statements = code("../lib/statements.ts");
  assert.match(statements, /contactEligibility/);
  assert.doesNotMatch(statements, /email_opt_in\s*===\s*false/);
});

test("migration 040 adds the dunning claim with a unique constraint and drops nothing", () => {
  const sql = stripSqlComments(readFileSync(new URL("../db/040_communications.sql", import.meta.url), "utf8"));
  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+public\.dunning_events/i);
  assert.match(sql, /unique\s*\(\s*invoice_id\s*,\s*stage\s*\)/i);
  assert.doesNotMatch(sql, /drop\s+table/i);
});
