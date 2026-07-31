import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creditedMinor, openBalanceMinor, SETTLED_STATUSES } from "../lib/payments/core.mjs";

// ---------------------------------------------------------------------------
// THE BUG: a customer paid a 30% deposit on an estimate, the estimate was
// converted to an invoice, and the invoice then asked for 100% of the job.
// Deposits live on payments.estimate_id; the invoice only ever looked at
// payments.invoice_id, so the deposit was invisible.
// ---------------------------------------------------------------------------

const deposit = (minor) => ({ base_amount_minor: minor, refunded_minor: 0, normalized_status: "settled", estimate_id: "est-1", invoice_id: null });
const onInvoice = (minor, status = "settled") => ({ base_amount_minor: minor, refunded_minor: 0, normalized_status: status, estimate_id: null, invoice_id: "inv-1" });

test("a paid deposit is credited against the converted invoice", () => {
  const jobTotal = 500_00;
  const paidDeposit = 150_00; // 30%

  // What the customer should now be asked for.
  assert.equal(openBalanceMinor(jobTotal, [deposit(paidDeposit)]), 350_00);

  // The regression itself: ignoring the estimate row bills the full amount.
  const invoiceRowsOnly = [];
  assert.equal(openBalanceMinor(jobTotal, invoiceRowsOnly), 500_00,
    "this is the overbilling the fix removes — it must remain the answer when the deposit is not included");
});

test("deposit plus final payment closes the invoice exactly", () => {
  const rows = [deposit(150_00), onInvoice(350_00)];
  assert.equal(creditedMinor(rows), 500_00);
  assert.equal(openBalanceMinor(500_00, rows), 0);
});

test("an invoice never created from an estimate is unaffected", () => {
  assert.equal(openBalanceMinor(500_00, [onInvoice(200_00)]), 300_00);
});

// ---------------------------------------------------------------------------
// Money that has not actually arrived must not read as collected.
// ---------------------------------------------------------------------------

test("declined and in-flight payments are NOT counted as collected", () => {
  for (const status of ["failed", "processing", "pending", "cancelled", "requires_action", ""]) {
    assert.equal(creditedMinor([onInvoice(500_00, status)]), 0, `status ${JSON.stringify(status)} must not count`);
  }
  // A three-day ACH in flight leaves the full balance outstanding.
  assert.equal(openBalanceMinor(500_00, [onInvoice(500_00, "processing")]), 500_00);
});

test("settled and partially_refunded DO count (not a cry-wolf filter)", () => {
  // The other half of the both-ways proof: a filter that rejects everything
  // would also make the balance wrong, just in the opposite direction.
  assert.equal(creditedMinor([onInvoice(500_00, "settled")]), 500_00);
  assert.equal(creditedMinor([onInvoice(500_00, "partially_refunded")]), 500_00);
  assert.deepEqual(SETTLED_STATUSES, ["settled", "partially_refunded"]);
});

test("refunds are subtracted, and cannot push a payment negative", () => {
  assert.equal(creditedMinor([{ base_amount_minor: 500_00, refunded_minor: 200_00, normalized_status: "partially_refunded" }]), 300_00);
  assert.equal(creditedMinor([{ base_amount_minor: 500_00, refunded_minor: 900_00, normalized_status: "partially_refunded" }]), 0,
    "an over-refund must not become negative credit and silently inflate another payment");
});

test("an overpaid invoice reports zero owed, never a negative balance", () => {
  assert.equal(openBalanceMinor(100_00, [onInvoice(150_00)]), 0);
});

test("balance math stays in integer minor units", () => {
  // 33 payments of 3.33 must not drift the way float arithmetic would.
  const rows = Array.from({ length: 33 }, () => onInvoice(3_33));
  assert.equal(creditedMinor(rows), 109_89);
  assert.ok(Number.isInteger(creditedMinor(rows)));
  assert.equal(openBalanceMinor(110_00, rows), 11);
});

test("missing and malformed fields degrade to zero rather than NaN", () => {
  assert.equal(creditedMinor(null), 0);
  assert.equal(creditedMinor([]), 0);
  assert.equal(creditedMinor([{ normalized_status: "settled" }]), 0);
  assert.equal(openBalanceMinor(undefined, null), 0);
  assert.ok(!Number.isNaN(creditedMinor([{ base_amount_minor: "oops", normalized_status: "settled" }])));
});

test("legacy rows using amount_minor still credit", () => {
  // Older payment rows predate base_amount_minor.
  assert.equal(creditedMinor([{ amount_minor: 250_00, normalized_status: "settled" }]), 250_00);
});

// ---------------------------------------------------------------------------
// Structural: the link the whole fix depends on must exist and be used.
// ---------------------------------------------------------------------------

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("invoices carry the estimate they were converted from", () => {
  const sql = read("db/024_deposit_credit.sql");
  assert.ok(/alter table public\.invoices add column if not exists estimate_id/.test(sql));
  assert.ok(/invoices_estimate_org_fk/.test(sql), "the link must be tenant-safe by composite FK");
  assert.ok(/c\.matches = 1/.test(sql), "the backfill must skip ambiguous matches rather than guess");
});

test("conversion records the link and refuses to run twice", () => {
  const src = read("app/(app)/estimates/actions.ts");
  assert.ok(/estimate_id: est\.id/.test(src), "without this the deposit can never be credited");
  assert.ok(/eq\("estimate_id", estimateId\)/.test(src), "a repeat call must return the existing invoice");
});

test("the balance readers agree with each other", () => {
  const server = read("lib/payments/server.ts");
  const page = read("app/(app)/invoices/[id]/page.tsx");
  for (const [name, src] of [["server", server], ["invoice page", page]]) {
    assert.ok(/estimate_id\.eq\.|estimate_id/.test(src), `${name} must credit the originating estimate`);
    assert.ok(/partially_refunded/.test(src), `${name} must count only settled money`);
    assert.ok(/refunded_minor/.test(src), `${name} must subtract refunds`);
  }
});
