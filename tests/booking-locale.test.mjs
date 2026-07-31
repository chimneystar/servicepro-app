// ---------------------------------------------------------------------------
// A5 + A6 — what a business publishes for online booking, and in which
// language.
//
// A5: db/020_booking_experience.sql:78-79 seeded booking_services.name_he from
//     jt.name (the ENGLISH job-type name) and its sync trigger's
//     `on conflict do update` set name_en only, so the Hebrew name was wrong
//     from the first insert and could never correct itself.
// A6: db/005_more.sql:8 defaults organizations.job_types to a fixed HVAC list,
//     so a chimney sweep advertised "AC Install", while the twelve bilingual
//     trade packs in lib/industry-packs.ts fed only the price book.
//
// These assertions are written against the EFFECTIVE state of the database —
// the last definition of a function or trigger across the whole migration
// sequence — and against the real application source, never against a single
// file's existence. Run unchanged on the pre-fix tree, the sync-trigger, repair
// and bilingual-column checks find 020's definitions and FAIL; that is what
// makes them probes rather than documentation.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { stripSqlComments } from "./helpers/sql.mjs";
import { codeShape } from "./helpers/source-shape.mjs";

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
// Canonical token-stream spelling of a TypeScript source. The A6 probes assert
// on the SHAPE of declarations and calls — which pack declares which service,
// which table is inserted into — never on where the line breaks fall. Reading
// through `codeShape` keeps them asserting exactly that after ledger 6.4
// reformatted the tree; proven both ways in tests/source-shape.test.mjs.
const readCode = (relative) => codeShape(read(relative), relative);
// Missing file reads as empty so each probe fails on its own claim rather than
// taking the whole file down at import time (this is how they were proven RED).
const readOrEmpty = (relative) => {
  try {
    return read(relative);
  } catch {
    return "";
  }
};
const dbDir = new URL("../db/", import.meta.url);

/** Every numbered migration, in the order an operator applies them. */
const MIGRATIONS = readdirSync(dbDir)
  .filter((name) => /^\d{3}_.*\.sql$/.test(name))
  .sort()
  .map((name) => ({ name, sql: readFileSync(new URL(name, dbDir), "utf8") }));

const ALL_SQL = MIGRATIONS.map((m) => stripSqlComments(m.sql)).join("\n");
const MIGRATION_041 = readOrEmpty("db/041_booking_locale_packs.sql");
const SQL_041 = stripSqlComments(MIGRATION_041);

/**
 * The body of the LAST `create or replace function public.<name>(` in the
 * applied order — i.e. what the database actually ends up running. Reading a
 * single file would let a later migration silently reintroduce the defect.
 */
function effectiveFunction(name) {
  let found = null;
  for (const { sql } of MIGRATIONS) {
    const clean = stripSqlComments(sql);
    const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, "gi");
    let match;
    while ((match = re.exec(clean))) {
      const open = clean.indexOf("$$", match.index);
      const close = clean.indexOf("$$", open + 2);
      if (open === -1 || close === -1) continue;
      found = clean.slice(match.index, close + 2);
    }
  }
  return found;
}

/** The last `create [or replace] trigger <name>` definition, same reasoning. */
function effectiveTrigger(name) {
  let found = null;
  for (const { sql } of MIGRATIONS) {
    const clean = stripSqlComments(sql);
    const re = new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?trigger\\s+${name}\\b([\\s\\S]*?);`,
      "gi",
    );
    let match;
    while ((match = re.exec(clean))) found = match[0];
  }
  return found;
}

/** Columns added to a table anywhere in the sequence, plus its create-table. */
function columnsOf(table) {
  const columns = new Set();
  const create = new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`,
    "i",
  );
  const found = ALL_SQL.match(create);
  if (found) {
    for (const line of found[1].split("\n")) {
      const column = line.trim().match(/^([a-z_][a-z0-9_]*)\s+[a-z]/i);
      if (column && !/^(primary|unique|check|constraint|foreign|exclude)$/i.test(column[1]))
        columns.add(column[1].toLowerCase());
    }
  }
  const added = new RegExp(
    `alter\\s+table\\s+public\\.${table}\\s+add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?([a-z_][a-z0-9_]*)`,
    "gi",
  );
  let match;
  while ((match = added.exec(ALL_SQL))) columns.add(match[1].toLowerCase());
  return columns;
}

/** The balanced `{ ... }` block that follows a source marker. */
function blockAfter(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `marker not found: ${marker}`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced block after ${marker}`);
}

const HEBREW = /[֐-׿]/;

// ---------------------------------------------------------------------------
// A5 — the Hebrew name is Hebrew, and it can correct itself
// ---------------------------------------------------------------------------

test("A5: the sync trigger maintains the Hebrew name, not only the English one", () => {
  const fn = effectiveFunction("sync_booking_service_from_job_type");
  assert.ok(fn, "public.sync_booking_service_from_job_type() must exist");
  const onConflict = fn.slice(fn.indexOf("on conflict"));
  assert.ok(onConflict.includes("on conflict"), "the upsert must have an on-conflict branch");
  // THE DEFECT: 020's branch set name_en, duration_min, price_minor and sort.
  // A name_he it never writes is a name_he that can never be corrected.
  assert.match(onConflict, /name_he\s*=/, "on conflict do update must set name_he");
  assert.match(onConflict, /name_en\s*=/, "on conflict do update must still set name_en");
});

test("A5: the trigger never copies the English job-type name into name_he", () => {
  const fn = effectiveFunction("sync_booking_service_from_job_type");
  const values = fn.slice(fn.indexOf("values"), fn.indexOf("on conflict"));
  // 020: values(new.organization_id,new.id,new.name,new.name,...) — the third
  // and fourth arguments are name_en and name_he, both the English name.
  assert.doesNotMatch(
    values.replace(/\s+/g, ""),
    /new\.name,new\.name/,
    "name_he must not be seeded from the English job-type name",
  );
  assert.match(fn, /resolve_booking_service_names/, "the trigger must resolve the two names");
});

test("A5: translating a job type re-syncs its booking service", () => {
  const trigger = effectiveTrigger("trg_job_type_booking_service");
  assert.ok(trigger, "trg_job_type_booking_service must exist");
  assert.match(trigger, /\bname_he\b/, "the trigger must fire when the Hebrew name changes");
  assert.match(trigger, /\bname_en\b/, "the trigger must fire when the English name changes");
  assert.match(
    trigger,
    /\bname\b/,
    "renaming a job type must still re-sync (020 behaviour preserved)",
  );
  assert.match(
    trigger,
    /duration_min[\s\S]*default_price_minor[\s\S]*sort/,
    "020's columns must all still fire it",
  );
});

test("A5: the repair is re-runnable by the owner, not a one-shot backfill", () => {
  const fn = effectiveFunction("repair_booking_service_names");
  assert.ok(fn, "a callable repair function must exist");
  // Re-runnable means: callable by the app, scoped, and returning what it did.
  assert.match(
    SQL_041,
    /grant\s+execute\s+on\s+function\s+public\.repair_booking_service_names\(uuid\)\s+to\s+authenticated/i,
  );
  assert.match(
    SQL_041,
    /revoke\s+all\s+on\s+function\s+public\.repair_booking_service_names\(uuid\)\s+from\s+public,\s*anon/i,
  );
  assert.match(fn, /current_org_id\(\)/, "it must refuse another organisation");
  assert.match(fn, /current_user_role\(\)\s*<>\s*'owner'/, "booking services are owner-managed");
  assert.match(fn, /get\s+diagnostics/, "it must report how many rows it repaired");

  const action = read("app/(app)/settings/booking/actions.ts");
  assert.match(action, /rpc\("repair_booking_service_names"/, "the screen must be able to run it");
  assert.match(
    read("app/(app)/settings/booking/BookingSettingsForm.tsx"),
    /repairServiceNames\(\)/,
  );
});

test("A5: repair replaces a mis-seeded Hebrew name and never a human's", () => {
  const fn = effectiveFunction("repair_booking_service_names");
  const where = fn.slice(fn.indexOf("where")).replace(/\s+/g, " ");
  // The whole rule: null, or byte-identical to the English name, is a mis-seed.
  assert.match(where, /bs\.name_he is null or bs\.name_he = bs\.name_en/);
  assert.ok(
    !/name_he\s*is\s+not\s+null\s*\)?\s*$/.test(where),
    "it must not skip null translations",
  );

  const sync = effectiveFunction("sync_booking_service_from_job_type");
  assert.match(
    sync.replace(/\s+/g, " "),
    /bs\.name_he is null or bs\.name_he = bs\.name_en/,
    "the trigger must apply the same mis-seed rule as the repair",
  );
});

test("A5: an unresolvable Hebrew name is left null, not filled with English", () => {
  const fn = effectiveFunction("resolve_booking_service_names");
  assert.ok(fn, "the resolver must exist");
  const he = fn.slice(fn.indexOf("resolved_he :="));
  const heExpr = he.slice(0, he.indexOf(";"));
  assert.doesNotMatch(
    heExpr,
    /resolved_en/,
    "the Hebrew name must never fall back to the English one",
  );
  // The public page is what makes null safe: it already falls back at render.
  assert.match(
    read("app/book/[org]/BookingForm.tsx"),
    /name_he\s*\|\|\s*item\.name_en/,
    "the public page must keep falling back to English when there is no Hebrew name",
  );
});

test("A5: the booking settings screen stops writing English into the Hebrew field", () => {
  const form = read("app/(app)/settings/booking/BookingSettingsForm.tsx");
  assert.doesNotMatch(
    form,
    /name_he:\s*jobType\.name\b/,
    "a job type's name must not be reused as its Hebrew name",
  );
  assert.doesNotMatch(
    form,
    /nameHe_\$\{key\}`\}\s*defaultValue=\{row\.name_he\s*\?\?\s*row\.name_en\}/,
    "the Hebrew input must not be pre-filled with the English name",
  );
  assert.match(
    form,
    /placeholder=\{row\.name_en\}/,
    "it should show the English name as a hint instead",
  );
  assert.match(
    readCode("app/(app)/settings/booking/page.tsx"),
    /job_types"\)\.select\("id,name,name_en,name_he/,
    "the screen must read the job type's own translations",
  );
});

// ---------------------------------------------------------------------------
// A6 — the menu is the business's own trades, in both languages
// ---------------------------------------------------------------------------

/** Services parsed out of lib/industry-packs.ts — the source of truth. */
function packServices() {
  // Shaped, not raw: a pack is `{ key, en, he, items: [...] }` however Prettier
  // chooses to break it. The regex below still names every field and every
  // string, so a renamed key, a dropped service or a changed translation still
  // fails — see the sibling assertion that the count is >= 170 and the row-for-
  // row comparison against migration 041.
  const source = readCode("lib/industry-packs.ts");
  const body = source.slice(source.indexOf("export const INDUSTRY_PACKS"));
  const packRe =
    /\{\s*key:\s*"([^"]+)",\s*en:\s*"([^"]+)",\s*he:\s*"([^"]+)",\s*items:\s*\[([\s\S]*?)\]\s*,?\s*\}/g;
  const out = [];
  let pack;
  while ((pack = packRe.exec(body))) {
    const itemRe = /\b([sp])\("([^"]*)",\s*"([^"]*)",\s*"([^"]*)"\)/g;
    let item;
    let sort = 0;
    while ((item = itemRe.exec(pack[4]))) {
      if (item[1] !== "s") continue;
      out.push({ pack: pack[1], key: item[2], en: item[3], he: item[4], sort: sort++ });
    }
  }
  const generic = source.slice(source.indexOf("export const GENERIC_SERVICES"));
  const genericRe = /\{\s*\.\.\.s\("([^"]*)",\s*"([^"]*)",\s*"([^"]*)"\)/g;
  let item;
  let sort = 0;
  while ((item = genericRe.exec(generic.slice(0, generic.indexOf("];"))))) {
    out.push({ pack: "general", key: item[1], en: item[2], he: item[3], sort: sort++ });
  }
  return out;
}

/** Rows seeded into industry_pack_services by migration 041. */
function catalogRows() {
  const values = SQL_041.slice(
    SQL_041.indexOf("insert into public.industry_pack_services"),
    SQL_041.indexOf("on conflict (pack_key,item_key)"),
  );
  const rowRe =
    /\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*(\d+)\s*\)/g;
  const out = [];
  let row;
  while ((row = rowRe.exec(values))) {
    out.push({
      pack: row[1],
      key: row[2],
      en: row[3].replaceAll("''", "'"),
      he: row[4].replaceAll("''", "'"),
      sort: Number(row[5]),
    });
  }
  return out;
}

test("A6: the database's trade catalogue is the packs, row for row", () => {
  const ts = packServices();
  const sql = catalogRows();
  assert.ok(ts.length >= 170, `expected the twelve packs plus the neutral list, saw ${ts.length}`);
  assert.equal(
    sql.length,
    ts.length,
    "migration 041 must seed exactly the services lib/industry-packs.ts declares",
  );
  const key = (row) => `${row.pack}|${row.key}`;
  const byKey = new Map(sql.map((row) => [key(row), row]));
  for (const item of ts) {
    const row = byKey.get(key(item));
    assert.ok(row, `catalogue is missing ${key(item)}`);
    assert.equal(row.en, item.en, `English wording drifted for ${key(item)}`);
    assert.equal(row.he, item.he, `Hebrew wording drifted for ${key(item)}`);
    assert.equal(row.sort, item.sort, `order drifted for ${key(item)}`);
  }
});

test("A6: every catalogued Hebrew name is genuinely Hebrew", () => {
  for (const item of packServices()) {
    assert.match(item.he, HEBREW, `${item.pack}:${item.key} has no Hebrew name`);
    assert.notEqual(item.he, item.en, `${item.pack}:${item.key} is not translated`);
    assert.doesNotMatch(item.en, HEBREW, `${item.pack}:${item.key} has Hebrew in its English name`);
  }
});

test("A6: onboarding publishes the chosen trades, bilingually", () => {
  const page = read("app/onboarding/page.tsx");
  assert.match(
    page,
    /bookableServicesFor\(trades, packLocale\)/,
    "the menu must come from the chosen trades",
  );
  const insert = page.slice(page.indexOf("const bookable ="));
  assert.match(insert, /name_en: service\.name_en/);
  assert.match(insert, /name_he: service\.name_he/);
  assert.match(
    insert,
    /pack_item_key: service\.pack_item_key/,
    "the job type must remember which pack item it is",
  );
  assert.match(insert, /from\("job_types"\)\.insert/);
  assert.match(insert, /from\("booking_services"\)\.upsert/);
  // The old code named a job type in ONE language only, so the trigger had
  // nothing but that one name to seed both columns from.
  assert.doesNotMatch(insert, /name: packLocale === "he" \? item\.he : item\.en/);
});

test("A6: a business that picks no trade still gets its own bookable services", () => {
  const page = read("app/onboarding/page.tsx");
  const tradesOnly = blockAfter(page, "if (trades.length > 0) {");
  assert.ok(
    !tradesOnly.includes("job_types"),
    "seeding job types must not be conditional on picking a trade",
  );
  assert.ok(
    !tradesOnly.includes("booking_services"),
    "seeding booking services must not be conditional on picking a trade",
  );
  // ...and the fallback is trade-NEUTRAL, which is the whole of A6: the old
  // default published somebody else's trade.
  const packs = read("lib/industry-packs.ts");
  const generic = packs.slice(
    packs.indexOf("export const GENERIC_SERVICES"),
    packs.indexOf("export type BookableService"),
  );
  assert.doesNotMatch(
    generic,
    /\bAC\b|HVAC|Chimney|Plumb|Duct/i,
    "the fallback must not name a trade",
  );
  assert.match(generic, /Service call/);
  for (const line of generic.split("\n").filter((l) => l.includes('s("')))
    assert.match(line, HEBREW, "the fallback must be translated too");
});

test("A6: the price book is still seeded from the packs, exactly as before", () => {
  const page = readCode("app/onboarding/page.tsx");
  const tradesOnly = blockAfter(page, "if(trades.length>0){");
  assert.match(tradesOnly, /catalogItemsFor\(trades,\s*includeParts,\s*packLocale\)/);
  assert.match(tradesOnly, /from\("price_book"\)\.insert/);
  assert.match(tradesOnly, /from\("organization_industries"\)\.insert/);
  assert.match(tradesOnly, /from\("catalog_import_batches"\)\.insert/);
  const packs = read("lib/industry-packs.ts");
  const catalog = packs.slice(packs.indexOf("export function catalogItemsFor"));
  for (const field of [
    "name:",
    "category:",
    "unit:",
    "price_minor:",
    "cost_minor:",
    "taxable:",
    "industry_key:",
    "pack_item_key:",
    "item_kind:",
  ]) {
    assert.ok(catalog.includes(field), `price-book row lost ${field}`);
  }
  assert.match(
    packs,
    /return `\$\{packKey\}:\$\{kind\}:\$\{itemKey\}`/,
    "the pack item key format must not change",
  );
});

test("A6: the hardcoded HVAC default cannot seed anybody new", () => {
  assert.match(
    SQL_041,
    /alter\s+table\s+public\.organizations\s+alter\s+column\s+job_types\s+set\s+default\s+'\{\}'::text\[\]/i,
  );
  // 005's array is left in place for existing rows — this migration rewrites
  // no business's data.
  assert.doesNotMatch(SQL_041, /update\s+public\.organizations\s+set\s+job_types/i);
});

test("A6: an organisation that already has job types is left alone", () => {
  const seed = SQL_041.slice(SQL_041.indexOf("insert into public.job_types"));
  const statement = seed.slice(0, seed.indexOf(";"));
  assert.match(
    statement.replace(/\s+/g, " "),
    /not exists \( ?select 1 from public\.job_types jt where jt\.organization_id = oi\.organization_id ?\)/,
    "the pack menu may only be seeded where the organisation has NO job types",
  );
  assert.match(statement, /organization_industries/, "and only for the trades it actually chose");
  assert.doesNotMatch(
    SQL_041,
    /delete\s+from\s+public\.(job_types|booking_services)/i,
    "no service list may be removed",
  );
  assert.doesNotMatch(
    SQL_041,
    /update\s+public\.job_types[\s\S]{0,400}set[\s\S]{0,200}\bname\s*=/i,
    "no job type may be renamed",
  );
});

// ---------------------------------------------------------------------------
// The migration itself — idempotent, drops nothing, and every name it uses
// exists. (A migration on this branch dropped policy names that did not exist
// and silently did nothing; that is the failure mode these guard.)
// ---------------------------------------------------------------------------

test("041 drops nothing", () => {
  assert.ok(SQL_041.length > 2000, "migration 041 must exist and be the migration under test");
  assert.doesNotMatch(
    SQL_041,
    /\bdrop\s+(table|column|policy|trigger|function|index|constraint|type|view)\b/i,
  );
  assert.doesNotMatch(SQL_041, /\btruncate\b/i);
});

test("041 is idempotent", () => {
  for (const match of SQL_041.matchAll(
    /create\s+(table|index|unique index|policy|trigger|function)\b/gi,
  )) {
    if (/policy/i.test(match[1])) {
      // A policy is guarded by the pg_policies check in the do-block it sits in.
      const block = SQL_041.slice(SQL_041.lastIndexOf("do $$", match.index), match.index);
      assert.match(
        block,
        /not\s+exists\s*\(\s*select\s+1\s+from\s+pg_policies/i,
        "unguarded create policy",
      );
      continue;
    }
    const line = SQL_041.slice(Math.max(0, match.index - 40), match.index + 80);
    assert.match(
      line,
      /if\s+not\s+exists|or\s+replace/i,
      `unguarded ${match[1]} at: ${line.trim().slice(0, 90)}`,
    );
  }
  assert.match(
    SQL_041,
    /on\s+conflict\s*\(pack_key,item_key\)\s*do\s+update/i,
    "re-seeding the catalogue must refresh, not fail",
  );
  assert.match(SQL_041, /add\s+column\s+if\s+not\s+exists/i);
});

test("041 only touches columns and triggers that exist", () => {
  const jobTypes = columnsOf("job_types");
  for (const column of [
    "id",
    "organization_id",
    "name",
    "color",
    "duration_min",
    "default_price_minor",
    "sort",
    "name_en",
    "name_he",
    "pack_key",
    "pack_item_key",
  ]) {
    assert.ok(jobTypes.has(column), `job_types.${column} is referenced but never created`);
  }
  const bookingServices = columnsOf("booking_services");
  for (const column of [
    "organization_id",
    "job_type_id",
    "name_en",
    "name_he",
    "duration_min",
    "price_minor",
    "sort",
    "active",
    "book_as",
  ]) {
    assert.ok(
      bookingServices.has(column),
      `booking_services.${column} is referenced but never created`,
    );
  }
  const industries = columnsOf("organization_industries");
  for (const column of ["organization_id", "industry_key", "services_imported"]) {
    assert.ok(
      industries.has(column),
      `organization_industries.${column} is referenced but never created`,
    );
  }
  // The upsert target: 020 declares unique (organization_id, job_type_id).
  assert.match(
    stripSqlComments(read("db/020_booking_experience.sql")),
    /unique\s*\(organization_id,\s*job_type_id\)/i,
  );
  // The trigger amended here is the one 020 created, by its real name.
  assert.match(
    stripSqlComments(read("db/020_booking_experience.sql")),
    /create\s+trigger\s+trg_job_type_booking_service\b/,
  );
  // organizations.locale drives which language a seeded job type is named in.
  assert.match(read("db/001_schema.sql"), /locale\s+text\s+not\s+null\s+default\s+'en'/);
  // Every function 041 calls is one that exists.
  const everySql = `${read("db/001_schema.sql")}\n${ALL_SQL}`;
  for (const called of [
    "current_org_id",
    "current_user_role",
    "resolve_booking_service_names",
    "repair_booking_service_names",
  ]) {
    assert.ok(
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${called}\\b`).test(everySql),
      `public.${called}() is called but never created`,
    );
  }
});

test("041 keeps the reference catalogue away from anon", () => {
  assert.match(
    SQL_041,
    /alter\s+table\s+public\.industry_pack_services\s+enable\s+row\s+level\s+security/i,
  );
  assert.match(SQL_041, /revoke\s+all\s+on\s+public\.industry_pack_services\s+from\s+anon/i);
  assert.match(
    SQL_041,
    /grant\s+select\s+on\s+public\.industry_pack_services\s+to\s+authenticated/i,
  );
  assert.match(SQL_041, /create\s+policy\s+industry_pack_services_read/i);
});

test("041 is in the migration runbook", () => {
  assert.match(read("db/MIGRATIONS.md"), /041_booking_locale_packs\.sql/);
});
