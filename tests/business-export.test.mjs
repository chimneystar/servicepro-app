import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  EXPORT_TABLES, EXCLUDED_TABLES, NOT_INCLUDED,
  SECRET_COLUMNS, REDACTED,
  isSecretColumn, redactDeep, exportContract,
  EXPORT_PAGE_SIZE, EXPORT_MAX_PAGES, pageRange, isLastPage,
} from "../lib/core/export-manifest.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const readCode = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const dbDir = new URL("../db/", import.meta.url);
const allSql = readdirSync(dbDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(new URL(f, dbDir), "utf8").replace(/--[^\n]*/g, ""))
  .join("\n");

/** Every table declared anywhere in db/*.sql. */
function declaredTables() {
  const found = new Set();
  for (const match of allSql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_]+)/gi)) {
    found.add(match[1]);
  }
  return found;
}

/** Every column ever declared for a table (create table body + add column). */
function declaredColumns() {
  const columns = new Map();
  const add = (table, column) => {
    if (!columns.has(table)) columns.set(table, new Set());
    columns.get(table).add(column);
  };
  for (const match of allSql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_]+)\s*\(([\s\S]*?)\n\s*\)\s*;/gi)) {
    const table = match[1];
    // Split on TOP-LEVEL commas only. Several migrations declare four columns on
    // one line and wrap `check (...)` / `references ...(id)` in parentheses, so a
    // line-based or naive comma split finds a fraction of the real columns — and
    // a test that cannot see a column cannot notice it is missing from the export.
    let depth = 0;
    let current = "";
    const parts = [];
    for (const character of match[2]) {
      if (character === "(") depth++;
      else if (character === ")") depth--;
      if (character === "," && depth === 0) { parts.push(current); current = ""; } else current += character;
    }
    parts.push(current);
    for (const part of parts) {
      const column = part.trim().match(/^([a-z_][a-z0-9_]*)\s+[a-z"]/i);
      if (column && !/^(primary|unique|check|constraint|foreign|exclude|like)$/i.test(column[1])) add(table, column[1]);
    }
  }
  for (const match of allSql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?public\.([a-z_]+)([\s\S]*?);/gi)) {
    for (const column of match[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) {
      add(match[1], column[1]);
    }
  }
  return columns;
}

// ---------------------------------------------------------------------------
// Ledger 6a.7 — whole-business export.
//
// Before this, an owner could not take their own data out: three per-entity
// accounting CSVs and a per-customer privacy JSON, nothing else. The two ways
// this feature can fail dishonestly are (a) a file that looks complete and is
// short, and (b) a file that carries someone's credentials. Both are tested.
// ---------------------------------------------------------------------------

test("the manifest is real: every exported table exists in db/*.sql", () => {
  const declared = declaredTables();
  for (const entry of EXPORT_TABLES) {
    assert.ok(declared.has(entry.table), `${entry.table} is exported but never created in db/*.sql`);
  }
  assert.ok(EXPORT_TABLES.length >= 90, `expected the whole business, got ${EXPORT_TABLES.length} tables`);
});

test("every exported table is scoped by a column it actually has, and paged on one too", () => {
  const columns = declaredColumns();
  for (const entry of EXPORT_TABLES) {
    const owned = columns.get(entry.table);
    assert.ok(owned, `no columns found for ${entry.table}`);
    assert.ok(owned.has(entry.orgKey), `${entry.table}.${entry.orgKey} does not exist — the export would 400`);
    assert.ok(owned.has(entry.order), `${entry.table}.${entry.order} does not exist — paging would 400`);
  }
});

test("no table the business owns is silently missing from the export", () => {
  // A new migration that adds a tenant table must either export it or say why.
  // Otherwise the owner's "complete backup" quietly stops covering it.
  const columns = declaredColumns();
  const exported = new Set(EXPORT_TABLES.map((e) => e.table));
  const excused = new Set(EXCLUDED_TABLES.map((e) => e.table));
  const missing = [];
  for (const [table, owned] of columns) {
    if (!owned.has("organization_id")) continue;
    if (exported.has(table) || excused.has(table)) continue;
    missing.push(table);
  }
  assert.deepEqual(missing, [], `tenant tables neither exported nor excused: ${missing.join(", ")}`);
});

test("every exclusion carries a reason, and the reasons are shown to the owner", () => {
  assert.ok(EXCLUDED_TABLES.length > 0);
  for (const entry of EXCLUDED_TABLES) {
    assert.ok(entry.reason && entry.reason.length > 20, `${entry.table} is excluded with no real reason`);
  }
  // The two tables that hold provider credentials must be excluded outright,
  // not merely column-redacted.
  const excluded = EXCLUDED_TABLES.map((e) => e.table);
  assert.ok(excluded.includes("merchant_secrets"));
  assert.ok(excluded.includes("payment_checkout_secrets"));
  // ...and neither may sneak back in through the include list.
  const exported = EXPORT_TABLES.map((e) => e.table);
  for (const table of excluded) assert.ok(!exported.includes(table), `${table} is both excluded and exported`);
});

// --- Credentials out, business data in -------------------------------------

test("every bearer token in the schema is recognised as a secret", () => {
  // Enumerated from db/*.sql, not from memory. Each of these authenticates
  // someone: holding the string IS being that customer / that invitee.
  for (const column of [
    "portal_token", "public_token", "helcim_checkout_token",
    "token", "auth_secret", "p256dh", "endpoint",
    "encrypted_api_token", "encrypted_secret_token",
  ]) {
    assert.equal(isSecretColumn(column), true, `${column} must never be exported`);
  }
  // The safety net catches names nobody has written yet.
  for (const column of ["session_token", "refresh_token", "webhook_secret", "api_key", "password_hash"]) {
    assert.equal(isSecretColumn(column), true, `${column} must be caught by the pattern net`);
  }
});

test("the owner's own business data is NOT withheld — this is the half that makes it useful", () => {
  // The GDPR export's mistake was shipping cost and margin to the CUSTOMER.
  // The opposite mistake — withholding them from the OWNER — would make this
  // export a decoration rather than a copy of the business.
  for (const column of [
    "cost_minor", "job_expenses_minor", "commission_pct", "total_minor",
    "amount_minor", "notes", "phone", "email", "address", "signature_data",
    "reference", "reason_code", "industry_key", "run_key", "pack_item_key",
    "idempotency_key", "connected_account_id", "stripe_session_id",
  ]) {
    assert.equal(isSecretColumn(column), false, `${column} is the owner's own data and must be exported`);
  }
});

test("redaction replaces the value and keeps the key, so a withheld column is visible as withheld", () => {
  const row = { id: "1", name: "Ada", portal_token: "live-token-abc", phone: "555" };
  const out = redactDeep(row);
  assert.equal(out.portal_token, REDACTED);
  assert.ok("portal_token" in out, "dropping the key makes a deliberate omission look like a bug");
  assert.equal(out.name, "Ada");
  assert.equal(out.phone, "555");
  assert.equal(out.id, "1");
});

test("redaction reaches inside audit_log's row snapshots", () => {
  // audit_log.old_data / new_data are whole-row jsonb. A top-level-only pass
  // would leave every portal_token the business ever had inside the audit trail
  // while the customers table itself looked clean.
  const auditRow = {
    table_name: "customers",
    old_data: { id: "c1", portal_token: "old-secret", name: "Ada" },
    new_data: { id: "c1", portal_token: "new-secret", name: "Ada", nested: [{ public_token: "deep-secret", total_minor: 100 }] },
  };
  const out = redactDeep(auditRow);
  assert.equal(out.old_data.portal_token, REDACTED);
  assert.equal(out.new_data.portal_token, REDACTED);
  assert.equal(out.new_data.nested[0].public_token, REDACTED);
  assert.equal(out.new_data.nested[0].total_minor, 100, "money must survive redaction");
  assert.equal(out.old_data.name, "Ada");
  const serialised = JSON.stringify(out);
  for (const secret of ["old-secret", "new-secret", "deep-secret"]) {
    assert.ok(!serialised.includes(secret), `${secret} escaped into the export`);
  }
});

test("redaction survives nulls, arrays, primitives and cycles-by-depth without throwing", () => {
  assert.equal(redactDeep(null), null);
  assert.equal(redactDeep(7), 7);
  assert.equal(redactDeep("plain"), "plain");
  assert.deepEqual(redactDeep([{ token: "x" }, 2]), [{ token: REDACTED }, 2]);
  let deep = { token: "leaf" };
  for (let i = 0; i < 60; i++) deep = { level: deep };
  assert.doesNotThrow(() => redactDeep(deep));
});

// --- Pagination -------------------------------------------------------------

test("paging arithmetic covers every row exactly once", () => {
  assert.equal(EXPORT_PAGE_SIZE, 1000, "PostgREST's default cap is the page size");
  assert.deepEqual(pageRange(0), { from: 0, to: 999 });
  assert.deepEqual(pageRange(1), { from: 1000, to: 1999 });
  assert.deepEqual(pageRange(2), { from: 2000, to: 2999 });
  // No gap and no overlap between consecutive pages — an off-by-one here drops
  // or duplicates one row per thousand, invisibly.
  for (let page = 0; page < 25; page++) {
    assert.equal(pageRange(page + 1).from, pageRange(page).to + 1);
    assert.equal(pageRange(page).to - pageRange(page).from + 1, EXPORT_PAGE_SIZE);
  }
  assert.deepEqual(pageRange(-3), { from: 0, to: 999 }, "a nonsense page must not read backwards");
});

test("a full page is never the last one; a short page always is", () => {
  // This is the exact bug that truncated the accounting export: a request that
  // returns exactly 1000 rows looks finished and is not.
  assert.equal(isLastPage(1000), false);
  assert.equal(isLastPage(999), true);
  assert.equal(isLastPage(0), true);
  assert.equal(isLastPage(1), true);
});

test("the shared pager stops, refuses runaway reads, and is the one used everywhere", () => {
  const lib = readCode("lib/export.ts");
  assert.match(lib, /pageThrough/);
  assert.match(lib, /export_too_large/, "unbounded paging needs a ceiling");
  assert.match(lib, /EXPORT_MAX_PAGES/);
  assert.ok(EXPORT_MAX_PAGES >= 100, "the ceiling must not be so low it refuses a real business");
  // The accounting export must use the same implementation, or the two will
  // eventually disagree about what "all of it" means.
  const accounting = readCode("app/(app)/reports/export/actions.ts");
  assert.match(accounting, /from "@\/lib\/export"/, "the accounting export must share the pager");
  assert.doesNotMatch(accounting, /async function fetchAllPages/, "a second copy of the pager will drift");
});

// --- The route --------------------------------------------------------------

test("the export route is owner-only and cannot reach another tenant", () => {
  const route = readCode("app/api/export/business/route.ts");
  assert.match(route, /profile\.role !== "owner"/, "the whole business is an owner-only download");
  assert.match(route, /status: 401/);
  assert.match(route, /status: 403/);
  // The organisation comes from the session profile, never from the request.
  assert.match(route, /profile\.organization_id/);
  assert.match(route, /\.eq\(entry\.orgKey, orgId\)/, "every table query is tenant-scoped explicitly");
  assert.doesNotMatch(route, /searchParams|request\.url/, "no tenant identifier may come from the caller");
});

test("the export route pages and redacts — the two ways it could lie", () => {
  const route = readCode("app/api/export/business/route.ts");
  assert.match(route, /pageThrough/, "a plain select() stops at 1000 rows with no error");
  assert.match(route, /\.range\(from, to\)/);
  assert.match(route, /redactDeep\(row\)/, "every row is redacted on the way out");
  assert.doesNotMatch(route, /\.select\("\*"\)[^;]*\n[^;]*JSON\.stringify\(row\)/, "rows must not be serialised unredacted");
});

test("the export states its own completeness rather than hoping", () => {
  const route = readCode("app/api/export/business/route.ts");
  assert.match(route, /problems\.push/, "a table that fails to read must be recorded");
  assert.match(route, /"incomplete"/, "and must mark the whole file incomplete");
  assert.match(route, /rowCounts/, "the owner needs to be able to sanity-check the counts");
  assert.match(route, /controller\.error/, "a mid-stream failure must break the file, not truncate it quietly");
});

// --- What the UI promises ---------------------------------------------------

test("the screen tells the owner what is NOT in the file", () => {
  assert.ok(NOT_INCLUDED.length >= 3);
  const joined = NOT_INCLUDED.join(" ").toLowerCase();
  assert.ok(joined.includes("storage"), "files in storage are the omission a reader is most likely to assume away");
  assert.ok(joined.includes("password") || joined.includes("credential"));

  const page = readCode("app/(app)/reports/export/page.tsx");
  assert.match(page, /notIncluded/, "the exclusions must be rendered, not just declared");
  assert.match(page, /excluded/);
  assert.match(page, /meta\.status/, "the reader must be told to verify completeness");
  assert.match(page, /\/api\/export\/business/, "and there must be a way to actually start it");
  assert.match(page, /role !== "owner"/, "non-owners are told why they cannot, not shown a broken button");
});

test("the contract shown in the UI is the same one the route enforces", () => {
  const contract = exportContract();
  assert.equal(contract.tableCount, EXPORT_TABLES.length);
  assert.deepEqual(contract.excluded, EXCLUDED_TABLES);
  assert.deepEqual(contract.notIncluded, NOT_INCLUDED);
  assert.deepEqual(contract.redactedColumns, [...SECRET_COLUMNS].sort());
  assert.equal(contract.format, "JSON");
});
