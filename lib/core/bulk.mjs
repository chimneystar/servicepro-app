// Bulk operations on lists (ledger 6c.10). Plain ESM.
//
// WHY THIS EXISTS
// ---------------
// Nothing in the product had multi-select. Sending 40 invoices was 40 clicks,
// and re-assigning a day of jobs was one click per job.
//
// THE RULE THIS MODULE ENCODES: a bulk action that partially fails must report
// EXACTLY which rows failed and why. A silent partial success on 40 invoices is
// worse than a refusal — the operator believes 40 went out, 6 did not, and
// nobody finds out until a customer complains. So:
//
//   * `ok` is true only when NOTHING failed. There is no "mostly worked".
//   * Every failure carries the row's human label (invoice #5012, not a uuid)
//     and a reason, and `bulkReport` refuses to build a report whose counts do
//     not add up — a miscounted report is a lying report.
//   * The selection itself is validated before any work starts: empty, oversize
//     and malformed ids are refused up front rather than half-processed.
//
// Tests: tests/bulk-operations.test.mjs

/** Ceiling on one bulk request. Above this, the operator filters first. */
export const BULK_MAX_ROWS = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate and normalise a selection coming off a form.
 *
 * Duplicates are collapsed — a double-submitted checkbox must not send the same
 * invoice twice — and order is preserved so the report reads like the list.
 */
export function parseSelection(raw, { max = BULK_MAX_ROWS } = {}) {
  const values = Array.isArray(raw) ? raw : (raw === undefined || raw === null ? [] : [raw]);
  const seen = new Set();
  const ids = [];
  for (const value of values) {
    const id = String(value ?? "").trim();
    if (!id) continue;
    if (!UUID.test(id)) return { ok: false, reason: "invalid_id" };
    if (seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    ids.push(id);
  }
  if (!ids.length) return { ok: false, reason: "empty_selection" };
  if (ids.length > max) return { ok: false, reason: "too_many", limit: max, selected: ids.length };
  return { ok: true, ids };
}

/** Every bulk action the product offers, so an unknown one is refused not guessed. */
export const BULK_ACTIONS = Object.freeze([
  "invoices.send", "invoices.mark_paid", "invoices.mark_unpaid", "invoices.statement",
  "customers.statement", "customers.opt_out_sms", "customers.opt_out_email",
]);

export function isBulkAction(action) {
  return BULK_ACTIONS.includes(String(action ?? ""));
}

/**
 * Build the report.
 *
 * `results`: [{ id, label, ok, reason }]. A result with ok:false and no reason
 * is itself rejected — "it failed" without a why is the silence being removed.
 */
export function bulkReport(action, results) {
  const rows = results ?? [];
  const failed = [];
  const skipped = [];
  let succeeded = 0;

  for (const row of rows) {
    const id = String(row?.id ?? "");
    const label = String(row?.label ?? id);
    if (row?.ok === true) { succeeded += 1; continue; }
    const reason = String(row?.reason ?? "").trim();
    if (!reason) throw new TypeError(`bulk result for ${id} failed without a reason`);
    // A DELIBERATE refusal (opted out, nothing to send) is reported separately
    // from a breakage. Both are visible; conflating them makes consent look
    // like an outage and an outage look like consent.
    (row?.skipped === true ? skipped : failed).push({ id, label, reason });
  }

  const attempted = rows.length;
  if (succeeded + failed.length + skipped.length !== attempted) {
    throw new Error("bulkReport counts do not add up");
  }

  return {
    action: String(action ?? ""),
    ok: failed.length === 0,
    attempted, succeeded,
    failed, skipped,
    failedCount: failed.length,
    skippedCount: skipped.length,
  };
}

/**
 * One sentence an operator can act on.
 *
 * It never says "done" when anything failed, and it NAMES the rows — up to
 * five, then a count, because a 40-row failure list in a toast is unreadable
 * but "6 failed" with no names is unactionable.
 */
export function summarizeBulk(report, locale = "en") {
  const he = locale === "he";
  const parts = [];
  if (report.succeeded > 0) {
    parts.push(he ? `${report.succeeded} בוצעו` : `${report.succeeded} succeeded`);
  }
  if (report.skippedCount > 0) {
    const detail = report.skipped.map((r) => `${r.label}: ${r.reason}`).slice(0, 5).join("; ");
    parts.push(he ? `${report.skippedCount} דולגו — ${detail}` : `${report.skippedCount} skipped — ${detail}`);
  }
  if (report.failedCount > 0) {
    const detail = report.failed.map((r) => `${r.label}: ${r.reason}`).slice(0, 5).join("; ");
    parts.push(he ? `${report.failedCount} נכשלו — ${detail}` : `${report.failedCount} FAILED — ${detail}`);
  }
  if (!parts.length) return he ? "לא נבחר דבר" : "Nothing was selected";
  return parts.join(" · ");
}

/** Human text for the refusal reasons `parseSelection` can return. */
export function selectionError(result, locale = "en") {
  const he = locale === "he";
  if (result?.reason === "empty_selection") return he ? "לא נבחרו שורות" : "Select at least one row first";
  if (result?.reason === "too_many") {
    return he
      ? `נבחרו ${result.selected} שורות; המקסימום הוא ${result.limit}`
      : `${result.selected} rows selected; the maximum in one action is ${result.limit}`;
  }
  if (result?.reason === "invalid_id") return he ? "הבחירה אינה תקינה" : "That selection is not valid";
  return he ? "הבחירה נדחתה" : "Selection refused";
}
