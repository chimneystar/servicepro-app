#!/usr/bin/env node
// =====================================================================
//  ServicePro — derive db/schema.generated.txt from the migrations.
//
//    npm run db:schema            — rebuild the snapshot
//    npm run db:schema -- --check — fail if it is stale (run by npm test)
//
//  WHY
//  ---
//  `db/schema.sql` used to be two things at once: the baseline DDL applied
//  first, AND the document people read to find out what the schema is supposed
//  to look like. The second job it could not do — it describes the database as
//  it was at migration 001, and forty migrations have happened since. Anyone
//  reading it as "the expected schema" got an answer wrong by ~1,370 lines of
//  DDL, which is precisely the drift that made db/MIGRATIONS.md dangerous.
//
//  So the baseline is now simply migration 001 (`db/001_schema.sql`), frozen
//  and checksummed like every other migration, and the EXPECTED schema is
//  DERIVED: it is whatever applying 001..041 to an empty database produces.
//  This script builds exactly that database (PGlite — real Postgres, no Docker)
//  and writes down what came out.
//
//  `tests/schema-snapshot.test.mjs` rebuilds it and fails when the committed
//  file and the migrations disagree, so a migration that changes the schema
//  cannot land without the change being visible in review.
//
//  WHAT IT IS NOT. Not a runnable script and not a `pg_dump` — PGlite has no
//  pg_dump. It is a deterministic inventory: every table, column, constraint,
//  index, RLS flag and policy predicate, plus each function's signature and a
//  hash of its body. Function bodies are hashed rather than inlined because the
//  full text runs to tens of thousands of lines and would bury the diff that
//  matters; the hash still fails when a body changes.
// =====================================================================

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { freshDatabase } from "../tests/helpers/pg.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SNAPSHOT_PATH = join(ROOT, "db", "schema.generated.txt");

const shortHash = (s) =>
  createHash("sha256").update(s.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);

/** Build the database from the migrations and describe what came out. */
export async function buildSnapshot() {
  const { db, applied } = await freshDatabase();
  const out = [];

  const q = async (sql) => (await db.query(sql)).rows;

  out.push(
    "=====================================================================",
    " GENERATED FILE - DO NOT EDIT.",
    "",
    " The schema produced by applying every migration in db/, in order, to an",
    " empty PostgreSQL. Regenerate with `npm run db:schema`.",
    "",
    " db/001_schema.sql is only the BASELINE migration; it stopped describing",
    " the live schema forty migrations ago. This file is the expected schema.",
    "=====================================================================",
    "",
    `migrations applied: ${applied.length}`,
    "",
  );

  // --- tables, columns -------------------------------------------------
  const columns = await q(`
    select c.relname as tbl, a.attname as col,
           format_type(a.atttypid, a.atttypmod) as typ,
           a.attnotnull as notnull,
           coalesce(pg_get_expr(d.adbin, d.adrelid), '') as dflt
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname, a.attname
  `);
  const rls = await q(`
    select c.relname as tbl, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname
  `);
  const rlsByTable = new Map(rls.map((r) => [r.tbl, r]));

  const constraints = await q(`
    select c.relname as tbl, con.conname as name, pg_get_constraintdef(con.oid) as def
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
     order by c.relname, con.conname
  `);
  const indexes = await q(`
    select tablename as tbl, indexname as name, indexdef as def
      from pg_indexes where schemaname = 'public'
     order by tablename, indexname
  `);
  const policies = await q(`
    select tablename as tbl, policyname as name, cmd, permissive,
           coalesce(array_to_string(roles, ','), '') as roles,
           coalesce(qual, '') as using_expr,
           coalesce(with_check, '') as check_expr
      from pg_policies where schemaname = 'public'
     order by tablename, policyname
  `);

  const group = (rows) => {
    const m = new Map();
    for (const r of rows) (m.get(r.tbl) ?? m.set(r.tbl, []).get(r.tbl)).push(r);
    return m;
  };
  const colsBy = group(columns);
  const consBy = group(constraints);
  const idxBy = group(indexes);
  const polBy = group(policies);

  const tables = [...colsBy.keys()].sort();
  out.push(`TABLES (${tables.length})`, "=".repeat(69), "");

  for (const tbl of tables) {
    const flags = rlsByTable.get(tbl) ?? {};
    out.push(
      `table ${tbl}  [rls=${flags.rls ? "on" : "OFF"} force=${flags.forced ? "on" : "off"}]`,
    );
    for (const c of colsBy.get(tbl)) {
      out.push(
        `  ${c.col} ${c.typ}${c.notnull ? " not null" : ""}${c.dflt ? ` default ${c.dflt}` : ""}`,
      );
    }
    for (const c of consBy.get(tbl) ?? []) out.push(`  constraint ${c.name}: ${c.def}`);
    for (const i of idxBy.get(tbl) ?? []) out.push(`  index ${i.name}: ${i.def}`);
    for (const p of polBy.get(tbl) ?? []) {
      out.push(
        `  policy ${p.name}: for ${p.cmd} to ${p.roles || "public"}` +
          `${p.permissive ? "" : " (restrictive)"}` +
          `${p.using_expr ? ` using (${p.using_expr})` : ""}` +
          `${p.check_expr ? ` with check (${p.check_expr})` : ""}`,
      );
    }
    out.push("");
  }

  // --- functions -------------------------------------------------------
  const functions = await q(`
    select p.proname as name,
           pg_get_function_identity_arguments(p.oid) as args,
           pg_get_function_result(p.oid) as returns,
           p.prosecdef as security_definer,
           coalesce(p.proconfig::text, '') as config,
           p.prosrc as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
     order by p.proname, pg_get_function_identity_arguments(p.oid)
  `);
  out.push(`FUNCTIONS (${functions.length})`, "=".repeat(69), "");
  for (const f of functions) {
    out.push(
      `function ${f.name}(${f.args}) returns ${f.returns}` +
        `${f.security_definer ? " security definer" : ""}` +
        `${f.config && f.config !== "" ? ` config=${f.config}` : ""} body=${shortHash(f.body)}`,
    );
  }
  out.push("");

  // --- triggers --------------------------------------------------------
  const triggers = await q(`
    select c.relname as tbl, t.tgname as name, pg_get_triggerdef(t.oid) as def
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal
     order by c.relname, t.tgname
  `);
  out.push(`TRIGGERS (${triggers.length})`, "=".repeat(69), "");
  for (const t of triggers) out.push(`${t.tbl}.${t.name}: ${t.def}`);
  out.push("");

  // --- enums -----------------------------------------------------------
  const enums = await q(`
    select t.typname as name, string_agg(e.enumlabel, ',' order by e.enumsortorder) as labels
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
     group by t.typname order by t.typname
  `);
  out.push(`ENUMS (${enums.length})`, "=".repeat(69), "");
  for (const e of enums) out.push(`type ${e.name}: ${e.labels}`);

  return `${out.join("\n").trimEnd()}\n`;
}

// Only act when run directly, so the test can import buildSnapshot().
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const snapshot = await buildSnapshot();
  if (process.argv.includes("--check")) {
    if (!existsSync(SNAPSHOT_PATH)) {
      console.error("db/schema.generated.txt is missing. Run `npm run db:schema`.");
      process.exit(1);
    }
    if (readFileSync(SNAPSHOT_PATH, "utf8").replace(/\r\n/g, "\n") !== snapshot) {
      console.error(
        "db/schema.generated.txt does not match what the migrations produce.\n" +
          "A migration changed the schema without the snapshot being regenerated.\n" +
          "Run `npm run db:schema` and review the diff.",
      );
      process.exit(1);
    }
    console.log("db/schema.generated.txt matches the migrations.");
  } else {
    writeFileSync(SNAPSHOT_PATH, snapshot);
    console.log(`wrote db/schema.generated.txt (${snapshot.split("\n").length} lines)`);
  }
}
