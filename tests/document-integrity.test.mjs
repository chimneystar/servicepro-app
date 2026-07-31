import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripSqlComments } from "./helpers/sql.mjs";
import {
  MATERIAL_FIELDS, LOCK_CODES, MIN_REASON_LENGTH, NUMBERING_POLICY,
  REOPENABLE_LOCK_CODES, NUMBER_COLLISION_RETRIES, ACTIVE_CREDIT_STATUS,
  documentLock, isDocumentLocked, assertDocumentEditable,
  parseVersion, assertVersionMatch,
  nextAllocationFrom, shouldReleaseDocumentNumber, isUniqueViolation,
  validateVoid, validateCreditNote, validateCreditNoteCancel,
  validateReopen, canReopen,
  issuedCreditsMinor, remainingCreditableMinor, invoiceOutstandingMinor,
} from "../lib/core/documents.mjs";

// ===========================================================================
// Ledger 6a.1 / 6a.3 / 6a.5 / 6a.6.
//
// Every assertion below is written so it FAILS on the pre-change behaviour:
//   * before 6a.5, updateInvoice had no status guard at all, so
//     assertDocumentEditable would have had to answer ok:true for every one of
//     the locked cases;
//   * before 6a.6, there was no version column, so assertVersionMatch had
//     nothing to compare and every write was accepted;
//   * before 6a.1, void and credit note did not exist in any form;
//   * before 6a.3, next_document_number() bumped-then-returned with no max
//     awareness and no release, which nextAllocationFrom /
//     shouldReleaseDocumentNumber pin down.
//
// The structural assertions strip SQL comments FIRST, so a comment describing
// a guard can never satisfy a check for the guard.
// ===========================================================================

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const readSql = (name) => stripSqlComments(readFileSync(join(root, "db", name), "utf8"));
const MIGRATION = readSql("036_document_integrity.sql");
const RAW_MIGRATION = readFileSync(join(root, "db", "036_document_integrity.sql"), "utf8");

// ---------------------------------------------------------------------------
// 6a.5 — locking, proven in BOTH directions.
// ---------------------------------------------------------------------------

const draftInvoice = { status: "unpaid", signed_at: null, sent_at: null, paid_at: null, voided_at: null };
const draftEstimate = { status: "draft", signed_at: null, sent_at: null, voided_at: null };

test("a draft document is editable — the guard is not a cry-wolf", () => {
  // Stated first on purpose. A lock that refuses everything would break the
  // ordinary case (build a quote, tweak it, send it) far more often than the
  // bug it was written to fix, and nobody would notice for weeks.
  assert.equal(isDocumentLocked("invoice", draftInvoice), false);
  assert.equal(isDocumentLocked("estimate", draftEstimate), false);
  assert.equal(assertDocumentEditable("invoice", draftInvoice).ok, true);
  assert.equal(assertDocumentEditable("estimate", draftEstimate).ok, true);
});

test("an invoice is locked once it is SENT, SIGNED, PAID, part-paid or VOID", () => {
  // THE BUG: every one of these was freely editable. The customer's public
  // /p/<token> link is served from this same row, so an in-place edit changed
  // the figures they had already been shown, retroactively and silently.
  const cases = [
    [{ ...draftInvoice, sent_at: "2026-01-02T00:00:00Z" }, LOCK_CODES.SENT],
    [{ ...draftInvoice, signed_at: "2026-01-02T00:00:00Z" }, LOCK_CODES.SIGNED],
    [{ ...draftInvoice, status: "paid" }, LOCK_CODES.PAID],
    [{ ...draftInvoice, paid_at: "2026-01-02T00:00:00Z" }, LOCK_CODES.PAID],
    [{ ...draftInvoice, collected_minor: 1 }, LOCK_CODES.COLLECTED],
    [{ ...draftInvoice, status: "void" }, LOCK_CODES.VOIDED],
    [{ ...draftInvoice, voided_at: "2026-01-02T00:00:00Z" }, LOCK_CODES.VOIDED],
  ];
  for (const [doc, code] of cases) {
    const lock = documentLock("invoice", doc);
    assert.equal(lock.locked, true, `${JSON.stringify(doc)} must be locked`);
    assert.equal(lock.code, code);
    assert.equal(assertDocumentEditable("invoice", doc).ok, false);
  }
});

test("an estimate is locked once SENT, SIGNED, decided, part-paid or VOID", () => {
  const cases = [
    [{ ...draftEstimate, status: "sent" }, LOCK_CODES.SENT],
    [{ ...draftEstimate, sent_at: "2026-01-02T00:00:00Z" }, LOCK_CODES.SENT],
    [{ ...draftEstimate, status: "approved" }, LOCK_CODES.DECIDED],
    [{ ...draftEstimate, status: "rejected" }, LOCK_CODES.DECIDED],
    [{ ...draftEstimate, signed_at: "2026-01-02T00:00:00Z" }, LOCK_CODES.SIGNED],
    // A paid DEPOSIT is money against the estimate. It has to lock it, or the
    // quote the customer paid a deposit on could be re-priced underneath them.
    [{ ...draftEstimate, collected_minor: 250_00 }, LOCK_CODES.COLLECTED],
    [{ ...draftEstimate, voided_at: "2026-01-02T00:00:00Z" }, LOCK_CODES.VOIDED],
  ];
  for (const [doc, code] of cases) {
    assert.equal(documentLock("estimate", doc).code, code, JSON.stringify(doc));
  }
});

test("the lock message names BOTH what happened and what to do instead", () => {
  // A refusal with no way forward is how people end up editing rows by hand.
  const inv = assertDocumentEditable("invoice", { ...draftInvoice, status: "paid" });
  assert.match(inv.error, /paid/i);
  assert.match(inv.error, /credit note/i);
  assert.match(inv.error, /void/i);

  const est = assertDocumentEditable("estimate", { ...draftEstimate, status: "sent" });
  assert.match(est.error, /sent/i);
  assert.match(est.error, /reopen/i);
});

test("the lock message is available in Hebrew as well as English", () => {
  const he = assertDocumentEditable("invoice", { ...draftInvoice, status: "paid" }, { he: true });
  assert.notEqual(he.error, assertDocumentEditable("invoice", { ...draftInvoice, status: "paid" }).error);
  assert.match(he.error, /[֐-׿]/, "the Hebrew message must actually be Hebrew");
});

test("void beats paid beats signed beats sent — the precedence is fixed", () => {
  const everything = {
    status: "paid", signed_at: "x", sent_at: "x", paid_at: "x",
    voided_at: "2026-01-02T00:00:00Z", collected_minor: 100,
  };
  assert.equal(documentLock("invoice", everything).code, LOCK_CODES.VOIDED);
  assert.equal(documentLock("invoice", { ...everything, voided_at: null }).code, LOCK_CODES.PAID);
  assert.equal(
    documentLock("invoice", { ...everything, voided_at: null, status: "unpaid", paid_at: null }).code,
    LOCK_CODES.COLLECTED,
  );
});

// ---------------------------------------------------------------------------
// 6a.6 — optimistic concurrency.
// ---------------------------------------------------------------------------

test("a matching version is accepted", () => {
  const r = assertVersionMatch("estimate", "7", 7);
  assert.equal(r.ok, true);
  assert.equal(r.version, 7);
});

test("a STALE version is refused, and the message says what happened", () => {
  // THE BUG: with no version column, this write simply overwrote the other
  // person's. Nothing was shown, and neither user ever learned about it.
  const r = assertVersionMatch("estimate", "3", 5);
  assert.equal(r.ok, false);
  assert.equal(r.code, "stale_write");
  assert.match(r.error, /\b3\b/, "must name the version the user loaded");
  assert.match(r.error, /\b5\b/, "must name the version that is now current");
  assert.match(r.error, /NOT saved/i, "must say plainly that nothing was saved");
  assert.match(r.error, /reload/i, "must say what to do next");
});

test("a MISSING version is refused rather than assumed fresh", () => {
  // A form that forgets the field must not silently get the old last-write-wins
  // behaviour back — that is the defect wearing a disguise.
  for (const missing of [null, undefined, "", "  ", "abc", "-1", "0", "1.5", "1e3"]) {
    const r = assertVersionMatch("invoice", missing, 4);
    assert.equal(r.ok, false, `${JSON.stringify(missing)} must not pass as a version`);
  }
});

test("parseVersion accepts only whole versions from 1 up", () => {
  assert.equal(parseVersion("1"), 1);
  assert.equal(parseVersion(" 42 "), 42);
  assert.equal(parseVersion(9), 9);
  for (const bad of ["0", "-3", "1.0", "", null, undefined, "٣", "1x"]) {
    assert.equal(parseVersion(bad), null, `${JSON.stringify(bad)}`);
  }
});

test("an unknown current version does not block the save", () => {
  // A row read that came back without the column (an un-migrated database)
  // must not lock every user out of editing. Fail open here, because the
  // database-side guard is the one that must fail closed.
  assert.equal(assertVersionMatch("invoice", "2", null).ok, true);
});

// ---------------------------------------------------------------------------
// 6a.3 — numbering.
// ---------------------------------------------------------------------------

test("THE DECISION: gaps are allowed, numbers are never reused", () => {
  assert.equal(NUMBERING_POLICY.reuseBurnedNumbers, false);
  assert.equal(NUMBERING_POLICY.gapsAllowed, true);
  assert.equal(NUMBERING_POLICY.voidPreservesNumber, true);
});

test("allocation never re-issues a number already in use", () => {
  // THE BUG: /settings lets an owner set the next number by hand. Setting it
  // BACKWARDS made next_document_number() return a number a document already
  // held — a duplicate, or (with the unique constraint) a raw 23505.
  assert.equal(nextAllocationFrom(5000, 0), 5001, "fresh org: counter + 1, unchanged behaviour");
  assert.equal(nextAllocationFrom(5000, 4999), 5001, "counter ahead of use: counter wins");
  assert.equal(nextAllocationFrom(10, 5200), 5201, "counter walked backwards: highest-used wins");
  assert.equal(nextAllocationFrom(0, 0), 1);
});

test("a burned number is handed back ONLY if the counter has not moved", () => {
  assert.equal(shouldReleaseDocumentNumber(5001, 5001), true, "nobody else allocated: give it back");
  assert.equal(shouldReleaseDocumentNumber(5002, 5001), false, "someone else allocated: keep the gap");
  assert.equal(shouldReleaseDocumentNumber(5000, 5001), false);
  for (const bad of [null, undefined, "x", 0, -1]) {
    assert.equal(shouldReleaseDocumentNumber(bad, 5001), false);
    assert.equal(shouldReleaseDocumentNumber(5001, bad), false);
  }
});

test("a unique violation is recognised so it can be retried, not shown raw", () => {
  assert.equal(isUniqueViolation({ code: "23505" }), true);
  assert.equal(isUniqueViolation({ message: 'duplicate key value violates unique constraint "x"' }), true);
  assert.equal(isUniqueViolation({ code: "23503" }), false, "a foreign-key error is not a collision");
  assert.equal(isUniqueViolation({ message: "network error" }), false);
  assert.equal(isUniqueViolation(null), false);
  assert.ok(NUMBER_COLLISION_RETRIES >= 1);
});

// ---------------------------------------------------------------------------
// 6a.1 — void.
// ---------------------------------------------------------------------------

test("an unpaid, sent invoice CAN be voided with a reason", () => {
  const r = validateVoid("invoice", { ...draftInvoice, sent_at: "x" }, { reason: "duplicate of #1043" });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.reason, "duplicate of #1043");
});

test("voiding requires a real reason", () => {
  for (const bad of ["", "   ", "no", "oops", null, undefined]) {
    const r = validateVoid("invoice", draftInvoice, { reason: bad });
    assert.equal(r.ok, false, `${JSON.stringify(bad)} must not be an acceptable reason`);
    assert.equal(r.code, "reason_required");
    assert.match(r.error, new RegExp(String(MIN_REASON_LENGTH)));
  }
});

test("a document with money collected against it CANNOT be voided", () => {
  // Voiding says the sale never happened. Once money has changed hands that is
  // false, and the correct instrument is a credit note. Getting this wrong
  // would leave a payment sitting against a document that claims never to have
  // existed.
  const r = validateVoid("invoice", { ...draftInvoice, sent_at: "x" }, {
    reason: "customer changed their mind", collectedMinor: 250_00,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "money_collected");
  assert.match(r.error, /250\.00/);
  assert.match(r.error, /credit note/i);
});

test("voiding twice is refused, and a deleted document cannot be voided", () => {
  const already = validateVoid("invoice", { ...draftInvoice, voided_at: "x" }, { reason: "duplicate entry" });
  assert.equal(already.ok, false);
  assert.equal(already.code, "already_void");

  const byStatus = validateVoid("invoice", { ...draftInvoice, status: "void" }, { reason: "duplicate entry" });
  assert.equal(byStatus.code, "already_void");

  const deleted = validateVoid("estimate", { ...draftEstimate, deleted_at: "x" }, { reason: "duplicate entry" });
  assert.equal(deleted.ok, false);
  assert.equal(deleted.code, "deleted");
});

// ---------------------------------------------------------------------------
// 6a.1 — credit notes.
// ---------------------------------------------------------------------------

const invoice = (total, extra = {}) => ({ id: "i1", status: "unpaid", total_minor: total, ...extra });
const credit = (amount, status = ACTIVE_CREDIT_STATUS) => ({ amount_minor: amount, status });

test("a credit note within the invoice total is permitted", () => {
  const r = validateCreditNote(invoice(1000_00), [], { amountMinor: 250_00, reason: "wrong quantity billed" });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.amountMinor, 250_00);
});

test("credit notes can never exceed the invoice they correct", () => {
  // Over-crediting drives the receivable negative, and every downstream reader
  // would report revenue the business never had.
  const notes = [credit(600_00), credit(300_00)];
  assert.equal(issuedCreditsMinor(notes), 900_00);
  assert.equal(remainingCreditableMinor(invoice(1000_00), notes), 100_00);

  const ok = validateCreditNote(invoice(1000_00), notes, { amountMinor: 100_00, reason: "final adjustment" });
  assert.equal(ok.ok, true, ok.error);

  const over = validateCreditNote(invoice(1000_00), notes, { amountMinor: 100_01, reason: "final adjustment" });
  assert.equal(over.ok, false);
  assert.equal(over.code, "exceeds_invoice");
  assert.match(over.error, /100\.00/);
});

test("a CANCELLED credit note stops counting against the ceiling", () => {
  const notes = [credit(1000_00, "cancelled")];
  assert.equal(issuedCreditsMinor(notes), 0);
  const r = validateCreditNote(invoice(1000_00), notes, { amountMinor: 1000_00, reason: "reissued correctly" });
  assert.equal(r.ok, true, r.error);
});

test("a fully credited or voided invoice takes no further credit", () => {
  const full = validateCreditNote(invoice(500_00), [credit(500_00)], { amountMinor: 1_00, reason: "one more" });
  assert.equal(full.code, "fully_credited");

  const voided = validateCreditNote(invoice(500_00, { voided_at: "x" }), [], { amountMinor: 1_00, reason: "one more" });
  assert.equal(voided.code, "voided");
});

test("a credit note amount must be a positive whole number of minor units", () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, "50", null, undefined]) {
    const r = validateCreditNote(invoice(1000_00), [], { amountMinor: bad, reason: "billing correction" });
    assert.equal(r.ok, false, `${JSON.stringify(bad)} must be refused`);
    assert.equal(r.code, "invalid_amount");
  }
});

test("a credit note needs a reason too", () => {
  const r = validateCreditNote(invoice(1000_00), [], { amountMinor: 10_00, reason: "typo" });
  assert.equal(r.ok, false);
  assert.equal(r.code, "reason_required");
});

test("the balance nets credits off the bill, not off the money received", () => {
  // A credit note reduces the DEBT. It does not un-receive a payment: the money
  // is still in the business's bank account until it is refunded, and treating
  // the two as one would double-count every correction.
  const inv = invoice(1000_00);
  assert.equal(invoiceOutstandingMinor(inv, { collectedMinor: 0, creditNotes: [] }), 1000_00);
  assert.equal(invoiceOutstandingMinor(inv, { collectedMinor: 400_00, creditNotes: [] }), 600_00);
  assert.equal(invoiceOutstandingMinor(inv, { collectedMinor: 0, creditNotes: [credit(250_00)] }), 750_00);
  assert.equal(invoiceOutstandingMinor(inv, { collectedMinor: 400_00, creditNotes: [credit(250_00)] }), 350_00);
  // Over-credited plus over-paid never goes negative.
  assert.equal(invoiceOutstandingMinor(inv, { collectedMinor: 900_00, creditNotes: [credit(900_00)] }), 0);
});

test("cancelling a credit note is recorded, and only once", () => {
  const ok = validateCreditNoteCancel({ id: "c1", status: "issued" }, { reason: "issued against the wrong invoice" });
  assert.equal(ok.ok, true, ok.error);

  const twice = validateCreditNoteCancel({ id: "c1", status: "cancelled" }, { reason: "issued in error again" });
  assert.equal(twice.code, "already_cancelled");

  const noReason = validateCreditNoteCancel({ id: "c1", status: "issued" }, { reason: "x" });
  assert.equal(noReason.code, "reason_required");
});

// ---------------------------------------------------------------------------
// 6a.5 — the one audited exit.
// ---------------------------------------------------------------------------

test("a SENT or DECIDED estimate can be reopened with a reason", () => {
  for (const doc of [
    { ...draftEstimate, status: "sent" },
    { ...draftEstimate, sent_at: "x" },
    { ...draftEstimate, status: "approved" },
    { ...draftEstimate, status: "rejected" },
  ]) {
    assert.equal(canReopen("estimate", doc), true, JSON.stringify(doc));
    const r = validateReopen("estimate", doc, { reason: "customer asked to change the scope" });
    assert.equal(r.ok, true, r.error);
  }
});

test("a SIGNED, part-paid or voided estimate cannot be reopened", () => {
  const cases = [
    [{ ...draftEstimate, signed_at: "x" }, {}],
    [{ ...draftEstimate, voided_at: "x" }, {}],
    [{ ...draftEstimate, status: "sent" }, { collectedMinor: 100_00 }],
  ];
  for (const [doc, opts] of cases) {
    assert.equal(canReopen("estimate", doc, opts), false, JSON.stringify(doc));
    const r = validateReopen("estimate", doc, { reason: "we want to change it", ...opts });
    assert.equal(r.ok, false);
    assert.match(r.error, /duplicate/i, "must point at the instrument that does work");
  }
});

test("an INVOICE can never be reopened — that is what credit notes are for", () => {
  assert.equal(canReopen("invoice", { ...draftInvoice, sent_at: "x" }), false);
  const r = validateReopen("invoice", { ...draftInvoice, sent_at: "x" }, { reason: "we made a mistake" });
  assert.equal(r.ok, false);
  assert.equal(r.code, "not_reopenable");
  assert.match(r.error, /credit note/i);
});

test("reopening an UNLOCKED estimate is refused as pointless, not silently done", () => {
  const r = validateReopen("estimate", draftEstimate, { reason: "just because" });
  assert.equal(r.ok, false);
  assert.equal(r.code, "not_locked");
  assert.match(r.error, /edit it directly/i);
});

test("reopening needs a reason", () => {
  const r = validateReopen("estimate", { ...draftEstimate, status: "sent" }, { reason: "no" });
  assert.equal(r.code, "reason_required");
});

// ===========================================================================
// Structural assertions against db/036_document_integrity.sql.
//
// Comments are stripped FIRST (see tests/helpers/sql.mjs), so a comment
// describing a guard cannot satisfy a check for the guard. Every one of these
// was verified RED against the pre-change database files: 035 is the highest
// migration on the branch and contains none of these objects.
// ===========================================================================

test("the migration drops nothing except its own triggers and policies", () => {
  // The branch already shipped one migration that dropped policy names which
  // did not exist, so the "fix" silently did nothing. A migration that drops a
  // TABLE, COLUMN or FUNCTION is the version of that mistake that loses data.
  const forbidden = MIGRATION.match(/drop\s+(table|column|type|schema|function|index|constraint)\b/gi) ?? [];
  assert.deepEqual(forbidden, [], `036 must drop nothing: ${forbidden.join(", ")}`);

  // The drops it DOES contain must all be `drop … if exists` on an object it
  // recreates in the same file.
  for (const m of MIGRATION.matchAll(/drop\s+(trigger|policy)\s+(if\s+exists\s+)?(\S+)/gi)) {
    assert.ok(m[2], `"${m[0]}" must be guarded with IF EXISTS`);
    assert.ok(
      new RegExp(`create\\s+${m[1]}\\s+${m[3].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(MIGRATION),
      `${m[1]} ${m[3]} is dropped but never recreated`,
    );
  }
});

test("every column the migration adds is added IF NOT EXISTS (re-runnable)", () => {
  const adds = [...MIGRATION.matchAll(/alter\s+table\s+\S+\s+add\s+column\s+(if\s+not\s+exists\s+)?(\w+)/gi)];
  assert.ok(adds.length >= 14, `expected the new integrity columns, found ${adds.length}`);
  for (const m of adds) assert.ok(m[1], `add column ${m[2]} must be IF NOT EXISTS`);
});

test("the migration adds the version column to BOTH document tables (6a.6)", () => {
  for (const table of ["estimates", "invoices"]) {
    assert.match(
      MIGRATION,
      new RegExp(`alter\\s+table\\s+public\\.${table}\\s+add\\s+column\\s+if\\s+not\\s+exists\\s+version\\b`, "i"),
      `${table} must gain a version column`,
    );
  }
  assert.match(MIGRATION, /new\.version\s*:=\s*coalesce\(old\.version,\s*0\)\s*\+\s*1/i);
  for (const t of ["estimates", "invoices"]) {
    assert.match(MIGRATION, new RegExp(`create\\s+trigger\\s+trg_${t}_version\\s+before\\s+update\\s+on\\s+public\\.${t}`, "i"));
  }
});

test("the unique constraint on (organization_id, number) is added conditionally", () => {
  // schema.sql declares it inline, so a blind `add constraint` would leave a
  // second redundant unique index on every existing database.
  assert.match(MIGRATION, /pg_constraint/i, "must look for an existing constraint before adding one");
  assert.match(MIGRATION, /contype\s*=\s*'u'/i);
  assert.match(MIGRATION, /unique\s*\(\s*organization_id\s*,\s*number\s*\)/i);
  // The baseline really does have it — asserted here so the claim in the
  // migration header is checked rather than believed.
  const schema = readSql("schema.sql");
  const uniques = schema.match(/unique\s*\(organization_id,\s*number\)/gi) ?? [];
  assert.equal(uniques.length, 2, "schema.sql should declare it on estimates AND invoices");
});

test("allocation is serialised and max-aware (6a.3)", () => {
  // THE BUG: the old body was a bare `update … set counter = counter + 1
  // returning counter`. Two sessions read the same row and the /settings
  // override could walk the counter back onto a number already in use.
  const fn = MIGRATION.split("create or replace function public.allocate_document_number")[1] ?? "";
  assert.ok(fn, "allocate_document_number must be defined");
  assert.match(fn, /for\s+update/i, "must take a row lock on the organisation");
  assert.match(fn, /greatest\(\s*invoice_counter,\s*used\s*\)/i);
  assert.match(fn, /greatest\(\s*estimate_counter,\s*used\s*\)/i);
  assert.match(fn, /max\(number\)/i, "must consider the numbers actually in use");
});

test("release_document_number is a compare-and-set, never a blind rollback", () => {
  const fn = MIGRATION.split("create or replace function public.release_document_number")[1] ?? "";
  assert.ok(fn, "release_document_number must be defined");
  for (const counter of ["invoice_counter", "estimate_counter", "credit_note_counter"]) {
    assert.match(
      fn, new RegExp(`${counter}\\s*=\\s*p_number\\b`, "i"),
      `the release must only fire when ${counter} still equals the allocated number`,
    );
  }
  assert.match(fn, /not\s+exists\s*\(\s*select/i, "must refuse to release a number something already holds");
  assert.match(fn, /forbidden/i, "must not let one tenant move another tenant's counter");
});

test("the credit-note ledger is append-only: no delete policy, no delete grant", () => {
  assert.match(MIGRATION, /create\s+table\s+if\s+not\s+exists\s+public\.credit_notes/i);
  assert.match(MIGRATION, /alter\s+table\s+public\.credit_notes\s+enable\s+row\s+level\s+security/i);
  assert.match(MIGRATION, /grant\s+select,\s*insert,\s*update\s+on\s+public\.credit_notes\s+to\s+authenticated/i);
  assert.doesNotMatch(MIGRATION, /grant\s+delete\s+on\s+public\.credit_notes/i);
  assert.doesNotMatch(MIGRATION, /create\s+policy\s+\w+\s+on\s+public\.credit_notes\s+for\s+delete/i);
  assert.match(MIGRATION, /revoke\s+all\s+on\s+public\.credit_notes\s+from\s+anon/i);
});

test("credit notes are gated on the same authority as refunds", () => {
  assert.match(MIGRATION, /can_refund_payments\(\)/);
  // …and the migration refuses to run at all if that function is missing,
  // rather than creating a policy that rejects everything at 3am.
  assert.match(MIGRATION, /to_regprocedure\('public\.can_refund_payments\(\)'\)\s+is\s+null/i);
});

test("credited_minor is a DERIVED cache, exactly like payments.refunded_minor", () => {
  assert.match(MIGRATION, /alter\s+table\s+public\.invoices\s+add\s+column\s+if\s+not\s+exists\s+credited_minor/i);
  const fn = MIGRATION.split("create or replace function public.sync_invoice_credited_total")[1] ?? "";
  assert.ok(fn, "the sync function must exist");
  assert.match(fn, /sum\(amount_minor\)/i);
  assert.match(fn, /status\s*=\s*'issued'/i, "a cancelled credit note must not count");
  assert.match(MIGRATION, /create\s+trigger\s+trg_credit_notes_sync[\s\S]{0,200}?after\s+insert\s+or\s+update\s+or\s+delete/i);
});

test("the database refuses an over-credit, not only the action", () => {
  const fn = MIGRATION.split("create or replace function public.guard_credit_note_amount")[1] ?? "";
  assert.ok(fn);
  assert.match(fn, /already\s*\+\s*new\.amount_minor\s*>\s*billed/i);
  assert.match(fn, /credit_exceeds_invoice/);
  assert.match(fn, /c\.id\s*<>\s*new\.id/i, "must exclude the row being updated from its own ceiling");
  assert.match(MIGRATION, /create\s+trigger\s+trg_credit_notes_guard\s+before\s+insert\s+or\s+update/i);
});

test("the lock guard enforces exactly the MATERIAL_FIELDS list (6a.5)", () => {
  // Two guards that disagree about what is material would be worse than one.
  const guard = MIGRATION.split("create or replace function public.guard_document_lock")[1] ?? "";
  assert.ok(guard, "guard_document_lock must exist");
  const declared = [...guard.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  for (const field of MATERIAL_FIELDS) {
    assert.ok(declared.includes(field), `${field} is material in JS but not guarded in SQL`);
  }
  const cols = (guard.match(/cols\s+text\[\]\s*:=\s*array\[([\s\S]*?)\]/i) ?? [])[1] ?? "";
  const sqlFields = [...cols.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    [...sqlFields].sort(), [...MATERIAL_FIELDS].sort(),
    "the SQL material-field list and MATERIAL_FIELDS must be the same set",
  );
});

test("the lock guard is attached to the documents AND to their line items", () => {
  for (const t of ["estimates", "invoices"]) {
    assert.match(MIGRATION, new RegExp(`create\\s+trigger\\s+trg_${t}_lock\\s+before\\s+update\\s+on\\s+public\\.${t}`, "i"));
  }
  for (const t of ["estimate_items", "invoice_items"]) {
    assert.match(
      MIGRATION,
      new RegExp(`create\\s+trigger\\s+trg_${t}_lock\\s+before\\s+insert\\s+or\\s+update\\s+or\\s+delete\\s+on\\s+public\\.${t}`, "i"),
      `${t} must be guarded too — locking the total while leaving the items writable is worse than either alone`,
    );
  }
});

test("the SQL lock definition matches documentLock() branch for branch", () => {
  const fn = MIGRATION.split("create or replace function public.document_lock_code")[1] ?? "";
  assert.ok(fn, "document_lock_code must exist");
  const body = fn.split("$$")[1] ?? "";
  const order = [...body.matchAll(/then\s+'(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(order, ["voided", "paid", "signed", "decided", "sent"],
    "the SQL precedence must match LOCK_CODES precedence in lib/core/documents.mjs");
  // 'collected' is deliberately absent from the SQL — a row trigger cannot see
  // settled payments. Asserted so the omission is a decision, not a gap.
  assert.ok(!order.includes("collected"));
  // Read from the RAW file: this one is a documented decision, and stripping
  // comments would remove the very thing being checked.
  assert.match(RAW_MIGRATION, /money-collected leg of the lock is checked in the server action/i);
});

test("a document number can never be changed once issued", () => {
  const guard = MIGRATION.split("create or replace function public.guard_document_lock")[1] ?? "";
  assert.match(guard, /new\.number\s+is\s+distinct\s+from\s+old\.number/i);
  assert.match(guard, /document_number_immutable/);
});

test("coming OUT of a lock is refused except as an audited estimate reopen", () => {
  // Without this the status dropdown was a one-click unlock: approved → draft
  // cleared the basis of the lock, and the next save rewrote the figures.
  const guard = MIGRATION.split("create or replace function public.guard_document_lock")[1] ?? "";
  assert.match(guard, /old_code\s+is\s+not\s+null\s+and\s+new_code\s+is\s+null/i);
  assert.match(guard, /document_unlock_refused/);
  assert.match(guard, /reopen_reason/);
  assert.match(guard, /is\s+not\s+distinct\s+from\s+old\.reopen_reason/i,
    "a reopen must carry a NEW reason, not repeat the last one");
  // 'paid' is exempt on purpose: Mark due and the refund path both un-pay an
  // invoice, and breaking those would be a regression, not a fix.
  assert.match(guard, /old_code\s*<>\s*'paid'/i);
  assert.deepEqual([...REOPENABLE_LOCK_CODES], ["sent", "decided"]);
  assert.match(guard, /old_code\s+not\s+in\s*\(\s*'sent'\s*,\s*'decided'\s*\)/i);
});

test("a voided document can no longer be paid or signed", () => {
  // Without this the void would be cosmetic: /p/<token> would still take money.
  const pay = MIGRATION.split("create or replace function public.guard_payment_request_document")[1] ?? "";
  assert.ok(pay, "the payment-request guard must exist");
  assert.match(pay, /document_voided/);
  assert.match(MIGRATION, /create\s+trigger\s+trg_payment_requests_document_guard\s+before\s+insert\s+on\s+public\.payment_requests/i);

  const approve = MIGRATION.split("create or replace function public.approve_document")[1] ?? "";
  assert.ok(approve, "approve_document must be re-created with the void guard");
  assert.equal((approve.match(/voided_at\s+is\s+null/gi) ?? []).length, 2,
    "both the estimate and the invoice update must exclude a voided document");
});

test("re-creating approve_document does NOT lose migration 023's sign-once guard", () => {
  // 023 fixed re-signing destroying the original evidence. Copying a function
  // body forward is exactly how such a fix gets silently reverted.
  const approve = MIGRATION.split("create or replace function public.approve_document")[1] ?? "";
  assert.equal((approve.match(/signed_at\s+is\s+null/gi) ?? []).length, 2, "sign-once must survive on both tables");
  assert.match(approve, /deleted_at\s+is\s+null[\s\S]*?deleted_at\s+is\s+null/i);
  assert.match(approve, /status\s+in\s*\('draft','sent'\)\s+then\s+'approved'::estimate_status/i);
  assert.match(approve, /left\(coalesce\(p_sig,\s*''\),\s*400000\)/i);
  assert.match(approve, /grant\s+execute\s+on\s+function\s+public\.approve_document\(uuid,\s*text,\s*text\)\s+to\s+anon,\s*authenticated/i);
});

test("every security-definer function in 036 pins its search_path", () => {
  const defs = [...MIGRATION.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)[\s\S]*?as\s+\$\$/gi)];
  assert.ok(defs.length >= 8);
  for (const d of defs) {
    assert.match(d[0], /set\s+search_path\s*=/i, `public.${d[1]} must pin search_path`);
  }
});

// ===========================================================================
// The rules exist AND are actually called.
//
// This project already shipped one module (lib/core/scheduling.mjs) that was
// written, tested and invoked by nothing for months. Pure logic with no call
// site is a very convincing way to fail. Comments are stripped first here too.
// ===========================================================================

/** Strip block comments and whole-line `//` comments from JS/TS source. */
function stripJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}
const readSrc = (...parts) => stripJsComments(readFileSync(join(root, ...parts), "utf8"));

test("updateDocument actually enforces the lock and the version (6a.5 + 6a.6)", () => {
  const src = readSrc("lib", "documents.ts");
  const update = src.split("export async function updateDocument")[1]?.split("export ")[0] ?? "";
  assert.ok(update, "updateDocument must exist");
  assert.match(update, /editableRule\(/, "must ask whether the document is still editable");
  assert.match(update, /assertVersionMatch\(/, "must compare the submitted version");
  assert.match(update, /\.eq\("version",/, "the UPDATE itself must be conditional on the version");
  assert.match(update, /\.select\(/, "without .select() a zero-row update looks like a success");
  assert.match(update, /collectedMinor\(/, "a part-paid document must be locked too");
});

test("no document insert bypasses the safe numbering path (6a.3)", () => {
  const src = readSrc("lib", "documents.ts");
  assert.ok(!/next_document_number/.test(src.replace(/allocateNumber[\s\S]{0,200}?rpc\("next_document_number"[^)]*\)/, "")),
    "next_document_number must only be reached through allocateNumber()");
  for (const fn of ["createDocument", "duplicateDocument"]) {
    const body = src.split(`export async function ${fn}`)[1]?.split("\nexport ")[0] ?? "";
    assert.match(body, /insertNumbered\(/, `${fn} must allocate through insertNumbered`);
  }
  const insert = src.split("async function insertNumbered")[1]?.split("\n/**")[0] ?? "";
  assert.match(insert, /isUniqueViolation\(/, "a collision must be retried, not shown as a raw 23505");
  assert.match(insert, /releaseNumber\(/, "a non-collision failure must hand the number back");
});

test("the correction actions are reachable from the invoice and estimate screens", () => {
  const invoiceActions = readSrc("app", "(app)", "invoices", "actions.ts");
  for (const name of ["voidInvoice", "createCreditNote", "voidCreditNote", "markInvoiceSent"]) {
    assert.match(invoiceActions, new RegExp(`export async function ${name}\\b`), `${name} must be a server action`);
  }
  const estimateActions = readSrc("app", "(app)", "estimates", "actions.ts");
  for (const name of ["voidEstimate", "reopenEstimate", "markEstimateSent"]) {
    assert.match(estimateActions, new RegExp(`export async function ${name}\\b`), `${name} must be a server action`);
  }
  const ui = readSrc("components", "DocCorrections.tsx");
  for (const call of ["voidInvoice", "voidEstimate", "createCreditNote", "voidCreditNote", "reopenEstimate"]) {
    assert.match(ui, new RegExp(`\\b${call}\\(`), `${call} must be wired to a control`);
  }
  for (const page of [["app", "(app)", "invoices", "[id]", "page.tsx"], ["app", "(app)", "estimates", "[id]", "page.tsx"]]) {
    assert.match(readSrc(...page), /<DocCorrections/, `${page.join("/")} must render the corrections panel`);
  }
});

test("the edit form carries the version, and both edit screens supply it", () => {
  assert.match(readSrc("components", "DocEditor.tsx"), /name="version"/,
    "without this field every save is a blind last-write-wins again");
  for (const kind of ["invoices", "estimates"]) {
    const page = readSrc("app", "(app)", kind, "[id]", "edit", "page.tsx");
    assert.match(page, /version:\s*(inv|est)\.version/, `${kind} edit page must pass the loaded version`);
    assert.match(page, /assertDocumentEditable/, `${kind} edit page must not open an editor that cannot save`);
  }
});

test("sending a document is what stamps sent_at, in BOTH places that send", () => {
  // Recording it in only one of the two would leave the other as a quiet way to
  // put a document in front of a customer and keep editing it afterwards.
  for (const component of ["DocDetailActions.tsx", "DocList.tsx"]) {
    const src = readSrc("components", component);
    assert.match(src, /markInvoiceSent|markEstimateSent/, `${component} must record the send`);
  }
  const lib = readSrc("lib", "documents.ts");
  const mark = lib.split("export async function markDocumentSent")[1]?.split("\nexport ")[0] ?? "";
  assert.match(mark, /\.is\("sent_at",\s*null\)/, "sent_at must be one-way: never re-stamped");
});

test("a locked document can no longer be soft-deleted into a numbering hole", () => {
  const src = readSrc("lib", "documents.ts");
  const del = src.split("export async function softDeleteDocument")[1]?.split("\nexport ")[0] ?? "";
  assert.match(del, /documentLock\(/, "delete must consult the same lock as edit");
  assert.match(del, /Void it instead/i, "must name the instrument that does work");
});

test("the numbering decision is written down in the migration, not just in code", () => {
  // Stated as a comment on purpose — this assertion reads the RAW file, because
  // the decision itself is documentation and a stripped file would not have it.
  assert.match(RAW_MIGRATION, /GAPS ARE ACCEPTED, NUMBERS ARE\s*--?\s*NEVER REUSED/i);
  assert.match(RAW_MIGRATION, /voiding PRESERVES the number/i);
});
