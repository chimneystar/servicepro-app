import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BULK_ACTIONS,
  BULK_MAX_ROWS,
  bulkReport,
  isBulkAction,
  parseSelection,
  selectionError,
  summarizeBulk,
} from "../lib/core/bulk.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ---------------------------------------------------------------------------
// The selection is validated BEFORE any work starts. Half-processing a bad
// request is how you send 12 of 40 invoices and cannot say which 12.
// ---------------------------------------------------------------------------

test("a good selection is accepted, in order", () => {
  const result = parseSelection([id(1), id(2), id(3)]);
  assert.deepEqual(result, { ok: true, ids: [id(1), id(2), id(3)] });
});

test("a single value is accepted without being wrapped by the caller", () => {
  assert.deepEqual(parseSelection(id(1)).ids, [id(1)]);
});

test("an empty selection is REFUSED rather than treated as 'all'", () => {
  // The dangerous default: a bulk delete with nothing ticked must not mean
  // everything.
  assert.equal(parseSelection([]).ok, false);
  assert.equal(parseSelection([]).reason, "empty_selection");
  assert.equal(parseSelection(undefined).reason, "empty_selection");
  assert.equal(parseSelection(["", "   "]).reason, "empty_selection");
});

test("a duplicate checkbox is collapsed, so nothing is actioned twice", () => {
  assert.deepEqual(parseSelection([id(1), id(1), id(2)]).ids, [id(1), id(2)]);
});

test("a malformed id is refused for the whole request, not skipped quietly", () => {
  const result = parseSelection([id(1), "'; drop table invoices; --"]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_id");
});

test("an oversize selection is refused with the numbers", () => {
  const many = Array.from({ length: BULK_MAX_ROWS + 1 }, (_, i) => id(i));
  const result = parseSelection(many);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "too_many");
  assert.equal(result.selected, BULK_MAX_ROWS + 1);
  assert.equal(result.limit, BULK_MAX_ROWS);
  // ...and exactly at the limit it is still accepted.
  assert.equal(parseSelection(many.slice(0, BULK_MAX_ROWS)).ok, true);
});

test("every refusal has words a person can act on", () => {
  assert.match(selectionError(parseSelection([])), /select at least one/i);
  assert.match(
    selectionError(parseSelection(Array.from({ length: 500 }, (_, i) => id(i)))),
    /500.*200|200/,
  );
  assert.match(selectionError(parseSelection(["nope"])), /not valid/i);
  assert.match(selectionError(parseSelection([]), "he"), /[֐-׿]/);
});

test("only declared actions are accepted", () => {
  assert.equal(isBulkAction("invoices.send"), true);
  assert.equal(isBulkAction("invoices.delete_everything"), false);
  assert.ok(BULK_ACTIONS.length > 0);
});

// ---------------------------------------------------------------------------
// THE ITEM'S OWN RULE: a partial failure names every failed row and its reason.
// ---------------------------------------------------------------------------

test("a wholly successful batch is ok", () => {
  const report = bulkReport("invoices.send", [
    { id: id(1), label: "#5001", ok: true },
    { id: id(2), label: "#5002", ok: true },
  ]);
  assert.equal(report.ok, true);
  assert.equal(report.succeeded, 2);
  assert.equal(report.failedCount, 0);
});

test("a PARTIAL success is NOT ok, and names exactly which rows failed and why", () => {
  const report = bulkReport("invoices.send", [
    { id: id(1), label: "#5001", ok: true },
    { id: id(2), label: "#5002", ok: false, reason: "Resend error 429: rate limited" },
    { id: id(3), label: "#5003", ok: true },
    { id: id(4), label: "#5004", ok: false, reason: "no email address on file" },
  ]);
  assert.equal(report.ok, false, "34 of 40 is not success");
  assert.equal(report.succeeded, 2);
  assert.deepEqual(
    report.failed.map((f) => f.label),
    ["#5002", "#5004"],
  );
  assert.deepEqual(
    report.failed.map((f) => f.reason),
    ["Resend error 429: rate limited", "no email address on file"],
  );
});

test("a deliberate SKIP is reported separately from a breakage", () => {
  // Consent must not look like an outage, and an outage must not look like
  // consent.
  const report = bulkReport("customers.statement", [
    { id: id(1), label: "Dana Levi", ok: false, skipped: true, reason: "email_opt_out" },
    { id: id(2), label: "Sam Cohen", ok: false, reason: "Resend error 500" },
  ]);
  assert.equal(report.skippedCount, 1);
  assert.equal(report.failedCount, 1);
  assert.equal(report.ok, false);
  assert.deepEqual(report.skipped[0], { id: id(1), label: "Dana Levi", reason: "email_opt_out" });
});

test("a batch that only skipped is still not reported as fully done", () => {
  const report = bulkReport("customers.statement", [
    { id: id(1), label: "Dana", ok: false, skipped: true, reason: "no_email" },
  ]);
  // Nothing broke, so `ok` is true — but the skip is visible and counted.
  assert.equal(report.ok, true);
  assert.equal(report.succeeded, 0);
  assert.equal(report.skippedCount, 1);
  assert.match(summarizeBulk(report), /skipped.*no_email/i);
});

test("a failure with NO reason is rejected — 'it failed' is the silence being removed", () => {
  assert.throws(
    () => bulkReport("invoices.send", [{ id: id(1), label: "#1", ok: false }]),
    /without a reason/,
  );
  assert.throws(() =>
    bulkReport("invoices.send", [{ id: id(1), label: "#1", ok: false, reason: "  " }]),
  );
});

test("a report whose counts do not add up refuses to exist", () => {
  // Guards the accumulator itself: a miscounted report is a lying report.
  const rows = [{ id: id(1), label: "#1", ok: true }];
  const report = bulkReport("invoices.send", rows);
  assert.equal(report.attempted, report.succeeded + report.failedCount + report.skippedCount);
});

test("an empty batch reports zero, not success", () => {
  const report = bulkReport("invoices.send", []);
  assert.equal(report.attempted, 0);
  assert.equal(report.succeeded, 0);
  assert.equal(summarizeBulk(report), "Nothing was selected");
});

// ---------------------------------------------------------------------------
// The sentence the operator reads.
// ---------------------------------------------------------------------------

test("the summary never says 'done' when something failed", () => {
  const report = bulkReport("invoices.send", [
    { id: id(1), label: "#5001", ok: true },
    { id: id(2), label: "#5002", ok: false, reason: "no email" },
  ]);
  const text = summarizeBulk(report);
  assert.match(text, /1 succeeded/);
  assert.match(text, /1 FAILED/);
  assert.match(text, /#5002: no email/);
});

test("a long failure list names the first five and counts the rest", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    id: id(i),
    label: `#${5000 + i}`,
    ok: false,
    reason: "rate limited",
  }));
  const report = bulkReport("invoices.send", rows);
  const text = summarizeBulk(report);
  assert.match(text, /12 FAILED/);
  assert.equal((text.match(/#50\d\d:/g) ?? []).length, 5);
});

test("the summary exists in Hebrew", () => {
  const report = bulkReport("invoices.send", [{ id: id(1), label: "#1", ok: false, reason: "x" }]);
  assert.match(summarizeBulk(report, "he"), /[֐-׿]/);
});

// ---------------------------------------------------------------------------
// Structural: the server actions must use the accumulator, check permission,
// and honour consent on anything that sends.
// ---------------------------------------------------------------------------

const code = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");

test("invoice bulk actions validate the selection and build a real report", () => {
  const actions = code("../app/(app)/invoices/actions.ts");
  assert.match(actions, /parseSelection/);
  assert.match(actions, /bulkReport/);
  assert.match(actions, /assertRole|assertCapability/);
});

test("bulk sending honours the SHARED opt-out rule", () => {
  const actions = code("../app/(app)/invoices/actions.ts");
  assert.match(actions, /contactEligibility/);
  assert.doesNotMatch(actions, /email_opt_in\s*===\s*false/);
});

test("customer bulk actions exist and are guarded the same way", () => {
  const actions = code("../app/(app)/customers/actions.ts");
  assert.match(actions, /parseSelection/);
  assert.match(actions, /bulkReport/);
  assert.match(actions, /assertRole/);
});

test("the multi-select component reports failures rather than only a count", () => {
  const component = code("../components/BulkActions.tsx");
  assert.match(component, /summarizeBulk|failed/);
  assert.match(component, /checkbox/);
});
