import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const readCode = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// ---------------------------------------------------------------------------
// Accounting export. PostgREST caps a response at 1000 rows, so a single
// unpaginated request silently truncated the ledger sent to the accountant.
// ---------------------------------------------------------------------------

test("every export branch paginates", () => {
  const src = readCode("app/(app)/reports/export/actions.ts");
  assert.ok(/fetchAllPages/.test(src), "a single request silently stops at the 1000-row cap");
  // Count CALL sites only — `fetchAllPages<` also matches the declaration.
  const calls = src.match(/await fetchAllPages</g) ?? [];
  assert.ok(
    calls.length >= 3,
    `invoices, payments and expenses must all page (found ${calls.length})`,
  );
  assert.ok(/\.range\(a, b\)/.test(src), "paging must actually use range()");

  // STRONGER THAN A COUNT. A fixed count of 3 passed for the wrong reason the
  // moment a fourth export branch was added: it failed on a legitimate
  // addition and would have passed on an UNPAGED one that replaced an existing
  // branch. The real rule is that EVERY read in this file is paged, so a new
  // branch cannot quietly stop at 1000 rows.
  const unpaged = [];
  for (const chunk of src.split(/supabase\s*\.\s*from\(/).slice(1)) {
    const statement = chunk.split(";")[0];
    if (!/\.select\(/.test(statement)) continue; // not a read at all
    if (/\.(insert|upsert|update|delete)\(/.test(statement)) continue; // a write; its .select() returns the new row
    if (/count:\s*"exact"/.test(statement)) continue; // a head count returns no rows
    if (!/\.range\(a, b\)/.test(statement))
      unpaged.push(statement.split("\n")[0].trim().slice(0, 70));
  }
  assert.deepEqual(
    unpaged,
    [],
    `these reads are not paged and will silently truncate:\n  ${unpaged.join("\n  ")}`,
  );
});

test("payments are filtered in SQL, not in JavaScript", () => {
  const src = readCode("app/(app)/reports/export/actions.ts");
  assert.ok(
    !/\.filter\(\(p: any\) => \{ const d = \(p\.paid_at/.test(src),
    "filtering after an unbounded fetch lets the row cap decide which payments the accountant sees",
  );
  assert.ok(
    /gte\("paid_at"/.test(src) && /lte\("paid_at"/.test(src),
    "the date range belongs in the query",
  );
});

test("the payments export distinguishes settled money from failed and refunded", () => {
  const src = readCode("app/(app)/reports/export/actions.ts");
  for (const column of ["Refunded", "Status"]) {
    assert.ok(src.includes(`"${column}"`), `an accountant cannot reconcile without ${column}`);
  }
  assert.ok(/refunded_minor/.test(src) && /normalized_status/.test(src));
});

test("an invalid date range is rejected before any query runs", () => {
  const src = readCode("app/(app)/reports/export/actions.ts");
  assert.ok(/invalid_range/.test(src));
});

test("a runaway export refuses rather than hanging", () => {
  const src = readCode("app/(app)/reports/export/actions.ts");
  assert.ok(/export_too_large/.test(src), "unbounded paging must have a ceiling");
});

// ---------------------------------------------------------------------------
// Currency. Onboarding offered ILS and EUR while the payment layer is USD-only,
// so a business could be set up with no working payment method at all.
// ---------------------------------------------------------------------------

test("no screen offers a currency the payment layer cannot serve", () => {
  for (const file of ["app/onboarding/page.tsx", "app/(app)/settings/SettingsForm.tsx"]) {
    const src = readCode(file);
    assert.ok(!/value="ILS"|"ILS \(₪\)"/.test(src), `${file} still offers ILS`);
    assert.ok(!/value="EUR"|"EUR \(€\)"/.test(src), `${file} still offers EUR`);
  }
});

test("currency is pinned server-side, because the form is not the boundary", () => {
  for (const file of ["app/onboarding/page.tsx", "app/(app)/settings/actions.ts"]) {
    const src = readCode(file);
    assert.ok(
      /const currency = "USD"/.test(src),
      `${file} must not take the currency from the request body — a crafted POST would bypass the UI`,
    );
  }
});

test("the database agrees with the payment layer", () => {
  const sql = read("db/026_usd_only.sql").toLowerCase();
  assert.ok(
    /check \(currency = 'usd'\)/.test(sql),
    "the constraint must match what payments can actually process",
  );
  assert.ok(
    /update public\.organizations set currency = 'usd'/.test(sql),
    "existing rows must be reconciled",
  );
});

test("language support is NOT reduced by the currency decision", () => {
  // Guarding against collateral damage: the product is bilingual, and currency
  // and language are independent settings.
  const i18n = read("lib/i18n.ts");
  assert.ok(
    /export const LOCALES: Locale\[\] = \["en", "he"\]/.test(i18n),
    "Hebrew must remain a supported language",
  );
  const settings = readCode("app/(app)/settings/SettingsForm.tsx");
  assert.ok(/\["he", "עברית"\]/.test(settings), "the Hebrew option must remain in settings");
});
