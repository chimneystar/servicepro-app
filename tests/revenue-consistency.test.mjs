import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// "Revenue" and "collected" must mean MONEY RECEIVED on every screen that says
// so. The same billed-versus-received mistake existed in THREE separate copies:
//
//   /reports            — fixed under ledger 2.4
//   dashboard "Collections" card
//   dashboard "Revenue · last 6 months" chart
//
// Each screen had its own inline calculation, so fixing one left the others
// wrong. They now share lib/core/reporting.mjs. This test exists so a fourth
// copy cannot quietly appear.
// ---------------------------------------------------------------------------

const readCode = (p) =>
  readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const MONEY_SCREENS = [
  "app/(app)/page.tsx",
  "app/(app)/reports/page.tsx",
  "app/(app)/reports/commission/page.tsx",
];

test("every screen reporting money received uses the shared calculation", () => {
  for (const file of MONEY_SCREENS) {
    const src = readCode(file);
    assert.ok(/from "@\/lib\/core\/reporting\.mjs"/.test(src),
      `${file} must use lib/core/reporting.mjs — an inline copy is how the three screens drifted apart`);
  }
});

// Billed and received are DIFFERENT questions and both are legitimate:
//   "Sales this month"  -> what we invoiced  -> invoice totals. Correct.
//   "Outstanding / due"  -> what we are owed  -> invoice totals. Correct.
//   "Revenue / collected" -> what arrived     -> payments. Only this one was wrong.
// The first version of this check flagged `monthSales` — a false positive on a
// card titled "Sales", where billing IS the right basis. Narrowed accordingly.
const CLAIMS_RECEIVED = /\b(collected|revenue)[A-Za-z0-9_]*\s*=\s*[^;\n]*\.reduce\([^;]*total_minor/i;

test("nothing that claims money RECEIVED is computed from invoice totals", () => {
  for (const file of MONEY_SCREENS) {
    const src = readCode(file);
    assert.ok(!CLAIMS_RECEIVED.test(src),
      `${file} derives a "collected"/"revenue" figure from invoice totals — that is what was BILLED, not what arrived`);
  }
});

test("billed-basis figures are left alone", () => {
  // Guard against over-correction: a future edit must not "fix" Sales or
  // Outstanding into payment-based figures, which would make them wrong.
  const src = readCode("app/(app)/page.tsx");
  assert.ok(/monthSales[\s\S]{0,120}total_minor/.test(src), "Sales must stay billed-basis");
  assert.ok(/dueSum[\s\S]{0,80}total_minor/.test(src), "Outstanding must stay billed-basis");
});

test("the dashboard reads payments, not just invoices, for its money cards", () => {
  const src = readCode("app/(app)/page.tsx");
  assert.ok(/from\("payments"\)/.test(src), "the dashboard must query payments to know what was collected");
  assert.ok(/COLLECTED_STATUSES/.test(src), "it must exclude declined and in-flight payments");
  assert.ok(/collectedMinor\(/.test(src), "the arithmetic must be the shared, tested one");
});

test("the detector would catch the original defect, and only that", () => {
  // Both-ways proof against the real pre-fix and post-fix source lines.
  const original = `const collected12 = paid.reduce((s, i) => s + i.total_minor, 0);`;
  assert.ok(CLAIMS_RECEIVED.test(original), "the check must fire on the code it was written for");

  const fixed = `const collected12 = collectedMinor(windowPayments ?? []);`;
  assert.ok(!CLAIMS_RECEIVED.test(fixed), "and stay silent on the fix");

  // And must NOT fire on the legitimately billed-basis figures beside it.
  const sales = `const monthSales = paid.filter((i) => i.issue_date >= start).reduce((s, i) => s + i.total_minor, 0);`;
  const due = `const dueSum = unpaid.reduce((s, i) => s + i.total_minor, 0);`;
  assert.ok(!CLAIMS_RECEIVED.test(sales), "Sales is billed-basis and must not be flagged");
  assert.ok(!CLAIMS_RECEIVED.test(due), "Outstanding is billed-basis and must not be flagged");
});

test("a rolling window is labelled as one", () => {
  // The dashboard cannot read every payment ever taken, so its money cards cover
  // a window. Presenting that as an all-time figure would be a quieter lie than
  // the one just fixed.
  const src = readFileSync(new URL("../app/(app)/page.tsx", import.meta.url), "utf8");
  assert.ok(/windowLabel/.test(src), "the window must be named in the UI");
  assert.ok(/last 12 months/.test(src) && /12 החודשים האחרונים/.test(src),
    "in both languages — a label that only exists in English lies to Hebrew users");
});
