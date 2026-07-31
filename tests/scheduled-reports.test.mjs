import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripSqlComments } from "./helpers/sql.mjs";
import {
  DIGEST_FREQUENCIES, digestPeriod, digestTotals, isDigestDue, isDigestFrequency, renderDigest,
} from "../lib/core/digest.mjs";
import { periodTotals } from "../lib/core/reporting.mjs";

const fmt = (minor) => `$${(minor / 100).toFixed(2)}`;

// ---------------------------------------------------------------------------
// Periods are CLOSED and in the past, so a digest can be reconciled against
// the screen. A "today so far" figure changes between two runs of the same job.
// ---------------------------------------------------------------------------

test("the daily digest covers yesterday, not today", () => {
  const p = digestPeriod("2026-07-31", "daily");
  assert.equal(p.start, "2026-07-30");
  assert.equal(p.end, "2026-07-30");
  assert.equal(p.key, "daily:2026-07-30");
});

test("the weekly digest covers the seven days ending yesterday", () => {
  const p = digestPeriod("2026-07-31", "weekly");
  assert.equal(p.start, "2026-07-24");
  assert.equal(p.end, "2026-07-30");
});

test("the monthly digest covers the last COMPLETE month, whatever day it runs", () => {
  for (const day of ["2026-07-01", "2026-07-15", "2026-07-31"]) {
    const p = digestPeriod(day, "monthly");
    assert.equal(p.start, "2026-06-01");
    assert.equal(p.end, "2026-06-30");
    assert.equal(p.key, "monthly:2026-06");
  }
});

test("month boundaries and leap years are handled", () => {
  assert.deepEqual(
    (({ start, end }) => ({ start, end }))(digestPeriod("2024-03-05", "monthly")),
    { start: "2024-02-01", end: "2024-02-29" },
  );
  assert.equal(digestPeriod("2026-01-01", "monthly").end, "2025-12-31");
  assert.equal(digestPeriod("2026-01-01", "daily").end, "2025-12-31");
});

test("an unknown frequency is refused, never silently defaulted", () => {
  assert.throws(() => digestPeriod("2026-07-31", "hourly"));
  assert.equal(isDigestFrequency("hourly"), false);
  assert.deepEqual([...DIGEST_FREQUENCIES], ["daily", "weekly", "monthly"]);
});

// ---------------------------------------------------------------------------
// The claim: exactly one digest per period, whatever the cron does.
// ---------------------------------------------------------------------------

const schedule = { enabled: true, frequency: "daily", last_period_key: null };

test("a due schedule fires", () => {
  const d = isDigestDue(schedule, "2026-07-31");
  assert.equal(d.due, true);
  assert.equal(d.period.key, "daily:2026-07-30");
});

test("a second run on the same night sends NOTHING", () => {
  const d = isDigestDue({ ...schedule, last_period_key: "daily:2026-07-30" }, "2026-07-31");
  assert.equal(d.due, false);
  assert.equal(d.reason, "already_sent");
});

test("the next night IS due again — the claim is per period, not permanent", () => {
  assert.equal(isDigestDue({ ...schedule, last_period_key: "daily:2026-07-30" }, "2026-08-01").due, true);
});

test("a cron outage produces ONE catch-up digest, not one per missed day", () => {
  // Down for a week; the period key for the run night is the only thing that
  // can be claimed, so there is no burst.
  const after = isDigestDue({ ...schedule, last_period_key: "daily:2026-07-20" }, "2026-07-31");
  assert.equal(after.due, true);
  assert.equal(after.period.key, "daily:2026-07-30");
});

test("a disabled schedule never fires", () => {
  assert.deepEqual(isDigestDue({ ...schedule, enabled: false }, "2026-07-31"), { due: false, reason: "disabled" });
});

test("a schedule that has not started yet does not back-fill", () => {
  const d = isDigestDue({ ...schedule, starts_on: "2026-08-15" }, "2026-07-31");
  assert.equal(d.due, false);
  assert.equal(d.reason, "not_started");
});

test("a malformed schedule is reported, not guessed at", () => {
  assert.equal(isDigestDue({ enabled: true, frequency: "fortnightly" }, "2026-07-31").reason, "unknown_frequency");
});

// ---------------------------------------------------------------------------
// THE RULE: the digest's money is the reporting engine's money. No fourth copy.
// ---------------------------------------------------------------------------

const input = {
  payments: [
    { normalized_status: "settled", base_amount_minor: 120000, refunded_minor: 0 },
    { normalized_status: "settled", base_amount_minor: 50000, refunded_minor: 1000 },
    { normalized_status: "failed", base_amount_minor: 999900, refunded_minor: 0 },
  ],
  invoices: [{ id: "i1", discount_minor: 5000, tax_rate_bps: 825 }],
  itemsByInvoice: { i1: [{ qty_milli: 2000, unit_price_minor: 30000, cost_minor: 9000, taxable: true }] },
  expensesMinor: 22000,
};

test("digestTotals is IDENTICAL to periodTotals, field for field", () => {
  assert.deepEqual(digestTotals(input), periodTotals(input));
});

test("a failed payment is not collected revenue in the digest either", () => {
  assert.equal(digestTotals(input).collectedMinor, 120000 + 49000);
});

test("digest.mjs contains no revenue arithmetic of its own", () => {
  // Comments stripped first: a promise in prose must not satisfy this.
  const source = readFileSync(new URL("../lib/core/digest.mjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  assert.match(source, /import\s*\{\s*periodTotals\s*\}\s*from\s*"\.\/reporting\.mjs"/);
  for (const smell of ["tax_rate_bps", "qty_milli", "cost_minor", "discount_minor", "unit_price_minor", "/ 100", "* 100"]) {
    assert.equal(source.includes(smell), false, `digest.mjs must not compute ${smell} itself`);
  }
});

test("renderDigest refuses to format money itself — the caller owns the currency", () => {
  assert.throws(() => renderDigest({ totals: digestTotals(input), period: digestPeriod("2026-07-31", "daily") }));
});

test("every headline figure reaches the email, unchanged", () => {
  const totals = digestTotals(input);
  const out = renderDigest({ totals, period: digestPeriod("2026-07-31", "daily"), orgName: "Acme", format: fmt });
  assert.match(out.body, new RegExp(fmt(totals.collectedMinor).replace("$", "\\$")));
  assert.match(out.body, new RegExp(fmt(totals.netProfitMinor).replace("$", "\\$")));
  assert.match(out.subject, /Acme/);
  assert.match(out.subject, /2026-07-30/);
});

test("optional counts appear when supplied and are absent when not", () => {
  const totals = digestTotals(input);
  const period = digestPeriod("2026-07-31", "weekly");
  const with_ = renderDigest({ totals, period, format: fmt, counts: { openInvoices: 7, outstandingMinor: 88000, jobsCompleted: 12 } });
  assert.match(with_.body, /Open invoices: 7/);
  assert.match(with_.body, /Jobs completed: 12/);
  const without = renderDigest({ totals, period, format: fmt });
  assert.equal(/Open invoices/.test(without.body), false);
});

test("the digest exists in Hebrew", () => {
  const out = renderDigest({ totals: digestTotals(input), period: digestPeriod("2026-07-31", "daily"), locale: "he", format: fmt });
  assert.match(out.body, /[֐-׿]/);
});

test("a zero period still produces a real digest rather than an empty message", () => {
  const totals = digestTotals({ payments: [], invoices: [], itemsByInvoice: {}, expensesMinor: 0 });
  const out = renderDigest({ totals, period: digestPeriod("2026-07-31", "daily"), orgName: "Acme", format: fmt });
  assert.match(out.body, /\$0\.00/);
  assert.equal(out.rows.length >= 5, true);
});

// ---------------------------------------------------------------------------
// Structural: it runs on the EXISTING cron, honours consent, claims and releases.
// ---------------------------------------------------------------------------

const code = (path) => readFileSync(new URL(path, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

test("the digest runs on the existing daily cron, not a new endpoint", () => {
  const route = code("../app/api/cron/daily/route.ts");
  assert.match(route, /runScheduledReports/);
  assert.match(route, /from\s*"@\/lib\/cron-tasks"/);
});

test("the digest reads its revenue through the shared engine, not an inline query sum", () => {
  const cron = code("../lib/cron-tasks.ts");
  const start = cron.indexOf("export async function runScheduledReports");
  assert.ok(start > -1);
  const body = cron.slice(start, start + 9000);
  assert.match(body, /digestTotals|periodTotals/);
  assert.doesNotMatch(body, /tax_rate_bps\s*\*|total_minor\s*\*/);
});

test("the digest claims its period before sending and marks failure visibly", () => {
  const cron = code("../lib/cron-tasks.ts");
  const start = cron.indexOf("export async function runScheduledReports");
  const body = cron.slice(start, start + 9000);
  assert.match(body, /report_deliveries/);
  assert.match(body, /"failed"|'failed'/);
});

test("migration 040 creates the schedule and its per-period claim", () => {
  const sql = stripSqlComments(readFileSync(new URL("../db/040_communications.sql", import.meta.url), "utf8"));
  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+public\.report_schedules/i);
  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+public\.report_deliveries/i);
  assert.match(sql, /unique\s*\(\s*schedule_id\s*,\s*period_key\s*\)/i);
});
