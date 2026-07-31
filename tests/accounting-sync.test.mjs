import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACCOUNTING_SYNC_STATUS,
  ACCOUNTING_TARGETS,
  columnsFor,
  csvCell,
  decimalFromMilli,
  decimalFromMinor,
  externalRef,
  isAccountingTarget,
  mapRow,
  reconcile,
  toCsv,
} from "../lib/core/accounting.mjs";

// ---------------------------------------------------------------------------
// Idempotency — the thing the monthly CSV re-import did not have at all.
// ---------------------------------------------------------------------------

test("the export key is stable across runs, so a re-import updates instead of duplicating", () => {
  assert.equal(externalRef("invoice", "abc"), "SP-INVOICE-abc");
  assert.equal(externalRef("invoice", "abc"), externalRef("invoice", "abc"));
});

test("different rows and different kinds never share a key", () => {
  assert.notEqual(externalRef("invoice", "a"), externalRef("invoice", "b"));
  assert.notEqual(externalRef("invoice", "a"), externalRef("payment", "a"));
});

test("a blank id THROWS rather than producing a key every row would share", () => {
  assert.throws(() => externalRef("invoice", ""));
  assert.throws(() => externalRef("invoice", null));
  assert.throws(() => externalRef("", "a"));
});

test("every exported row carries its key in the column the importer round-trips", () => {
  const qb = mapRow("quickbooks", "invoices", { id: "i1", number: 5001, total_minor: 45000 });
  assert.equal(qb.PrivateNote, "SP-INVOICE-i1");
  const xero = mapRow("xero", "invoices", { id: "i1", number: 5001, total_minor: 45000 });
  assert.equal(xero.Reference, "SP-INVOICE-i1");
  assert.equal(mapRow("quickbooks", "payments", { id: "p1" }).PrivateNote, "SP-PAYMENT-p1");
  assert.equal(mapRow("xero", "expenses", { id: "e1" }).Reference, "SP-EXPENSE-e1");
});

// ---------------------------------------------------------------------------
// Money never becomes a float on the way to a ledger.
// ---------------------------------------------------------------------------

test("minor units become an exact decimal string", () => {
  assert.equal(decimalFromMinor(0), "0.00");
  assert.equal(decimalFromMinor(5), "0.05");
  assert.equal(decimalFromMinor(1999), "19.99");
  assert.equal(decimalFromMinor(100000), "1000.00");
  assert.equal(decimalFromMinor(-2550), "-25.50");
});

test("a float that reached the exporter is truncated, not rounded into a lie", () => {
  assert.equal(decimalFromMinor("1999"), "19.99");
  assert.equal(decimalFromMinor(undefined), "0.00");
  assert.equal(decimalFromMinor(NaN), "0.00");
});

test("no exported amount is produced by float division", () => {
  // 0.1 + 0.2 territory: 8637 cents must be exactly 86.37, every time.
  for (let cents = 0; cents < 3000; cents++) {
    const decimal = decimalFromMinor(cents);
    assert.equal(Math.round(Number(decimal) * 100), cents, `${cents} -> ${decimal}`);
  }
});

test("milli-quantities are exact too", () => {
  assert.equal(decimalFromMilli(1000), "1.000");
  assert.equal(decimalFromMilli(2500), "2.500");
  assert.equal(decimalFromMilli(1), "0.001");
});

test("a payment is exported NET of its refund", () => {
  const row = mapRow("quickbooks", "payments", {
    id: "p1",
    base_amount_minor: 50000,
    refunded_minor: 12500,
    paid_at: "2026-06-01T10:00:00Z",
  });
  assert.equal(row.Amount, "375.00");
  assert.equal(row.PaymentDate, "2026-06-01");
});

// ---------------------------------------------------------------------------
// Column mapping is the importers' own, and the CSV cannot be a formula.
// ---------------------------------------------------------------------------

test("each target gets its own headers, and an unknown target is refused", () => {
  assert.notDeepEqual(columnsFor("quickbooks", "invoices"), columnsFor("xero", "invoices"));
  assert.ok(columnsFor("xero", "invoices").includes("*ContactName"));
  assert.ok(columnsFor("quickbooks", "invoices").includes("InvoiceNo"));
  assert.throws(() => columnsFor("sage", "invoices"));
  assert.throws(() => columnsFor("xero", "payroll"));
  assert.equal(isAccountingTarget("sage"), false);
  assert.deepEqual([...ACCOUNTING_TARGETS], ["quickbooks", "xero"]);
});

test("a cell that would be read as a spreadsheet formula is neutralised", () => {
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("+SUM(A1)"), "'+SUM(A1)");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell("-5"), "'-5");
});

test("quotes, commas and newlines survive a round trip", () => {
  assert.equal(csvCell('He said "hi", loudly'), '"He said ""hi"", loudly"');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell(null), "");
});

test("the CSV has the header row and one line per row, CRLF-separated", () => {
  const rows = [
    mapRow("quickbooks", "payments", {
      id: "p1",
      base_amount_minor: 1000,
      paid_at: "2026-01-01T00:00:00Z",
      customer_name: "Dana, Levi",
    }),
    mapRow("quickbooks", "payments", {
      id: "p2",
      base_amount_minor: 2000,
      paid_at: "2026-01-02T00:00:00Z",
    }),
  ];
  const csv = toCsv("quickbooks", "payments", rows);
  const lines = csv.split("\r\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0], columnsFor("quickbooks", "payments").join(","));
  assert.ok(lines[1].includes('"Dana, Levi"'));
});

// ---------------------------------------------------------------------------
// Two-way match — the part manual re-import could never do.
// ---------------------------------------------------------------------------

const local = [
  { ref: "SP-INVOICE-a", amountMinor: 45000, date: "2026-06-01" },
  { ref: "SP-INVOICE-b", amountMinor: 12000, date: "2026-06-02" },
  { ref: "SP-INVOICE-c", amountMinor: 30000, date: "2026-06-03" },
];

test("two identical sides reconcile, and say so", () => {
  const result = reconcile(local, local);
  assert.equal(result.balanced, true);
  assert.equal(result.matched.length, 3);
  assert.equal(result.localTotalMinor, result.remoteTotalMinor);
});

test("a row we billed that never reached the ledger is named", () => {
  const result = reconcile(local, local.slice(0, 2));
  assert.equal(result.balanced, false);
  assert.deepEqual(
    result.missingRemote.map((r) => r.ref),
    ["SP-INVOICE-c"],
  );
  assert.equal(result.missingLocal.length, 0);
});

test("money in the ledger that this product does not have is a DIFFERENT answer", () => {
  const result = reconcile(local.slice(0, 2), local);
  assert.deepEqual(
    result.missingLocal.map((r) => r.ref),
    ["SP-INVOICE-c"],
  );
  assert.equal(result.missingRemote.length, 0);
});

test("the same row with DIFFERENT money is the finding that matters", () => {
  const remote = [local[0], { ...local[1], amountMinor: 12500 }, local[2]];
  const result = reconcile(local, remote);
  assert.equal(result.balanced, false);
  assert.deepEqual(result.amountMismatch, [
    { ref: "SP-INVOICE-b", localMinor: 12000, remoteMinor: 12500, differenceMinor: -500 },
  ]);
  assert.equal(result.matched.length, 2, "a mismatch must not also count as matched");
});

test("'balanced' is false whenever ANY problem list is non-empty", () => {
  assert.equal(reconcile(local, []).balanced, false);
  assert.equal(reconcile([], local).balanced, false);
  assert.equal(
    reconcile(local, [{ ...local[0], amountMinor: 1 }, local[1], local[2]]).balanced,
    false,
  );
  assert.equal(reconcile([], []).balanced, true);
});

test("a row with no reference cannot silently reconcile against anything", () => {
  const result = reconcile([...local, { ref: "", amountMinor: 99999 }], local);
  assert.equal(result.balanced, true, "an unkeyed row is not exported and not matched");
  assert.equal(result.localTotalMinor, 87000);
});

// ---------------------------------------------------------------------------
// The honest assessment. This item is PARTIAL and the code says so.
// ---------------------------------------------------------------------------

test("the module states it is PARTIAL and lists exactly what remains", () => {
  assert.equal(ACCOUNTING_SYNC_STATUS.status, "partial");
  assert.ok(ACCOUNTING_SYNC_STATUS.remaining.length >= 4);
  assert.match(ACCOUNTING_SYNC_STATUS.remaining.join(" "), /OAuth/i);
  assert.match(ACCOUNTING_SYNC_STATUS.reason, /credential/i);
});

test("NO fake integration ships: there is no OAuth flow, token store or API client", () => {
  const source = readFileSync(new URL("../lib/core/accounting.mjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
  // "OAuth" appears once, in ACCOUNTING_SYNC_STATUS.remaining, as the honest
  // statement of what is missing — so the smells here are the CODE of an
  // integration, not the word.
  for (const smell of [
    "fetch(",
    "access_token",
    "refresh_token",
    "client_secret",
    "Authorization:",
    "api.xero.com",
    "intuit.com",
  ]) {
    assert.equal(
      source.toLowerCase().includes(smell.toLowerCase()),
      false,
      `an unproven ${smell} must not ship`,
    );
  }
  assert.match(source, /remaining:/, "what is missing must be stated in the module itself");
});

test("the export screen tells the owner it is PARTIAL rather than implying a sync", () => {
  const page = readFileSync(
    new URL("../app/(app)/reports/export/page.tsx", import.meta.url),
    "utf8",
  );
  const client = readFileSync(
    new URL("../app/(app)/reports/export/ExportClient.tsx", import.meta.url),
    "utf8",
  );
  const both = `${page}\n${client}`;
  assert.match(both, /ACCOUNTING_SYNC_STATUS|not connected|PARTIAL|partial/i);
});
