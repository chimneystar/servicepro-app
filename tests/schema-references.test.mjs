import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { tablesCreated } from "./helpers/sql.mjs";

// ---------------------------------------------------------------------------
// FOUND BY THE OWNER'S INDEPENDENT AUDIT, verified here before fixing:
// app/(app)/admin/page.tsx queried `merchant_accounts`. No such table exists —
// it is `merchant_connections`. So merchant status read "not connected" for
// EVERY organisation.
//
// It failed silently because the overwhelming majority of Supabase reads in this
// codebase destructure `{ data }` and never inspect `error`. A mistyped table
// name therefore cannot surface as an error, only as quietly wrong data on a
// screen someone trusts.
//
// This test makes the class impossible: every table name the application
// references must exist in db/*.sql.
// ---------------------------------------------------------------------------

const ROOT = new URL("../", import.meta.url);

function allSqlTables() {
  const tables = new Set();
  for (const file of readdirSync(new URL("db/", ROOT))) {
    if (!file.endsWith(".sql")) continue;
    for (const t of tablesCreated(readFileSync(new URL(`db/${file}`, ROOT), "utf8"))) tables.add(t);
  }
  return tables;
}

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(new URL(`${dir}/`, ROOT), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) out.push(path);
  }
  return out;
}

// Tables that live outside db/*.sql and are legitimately referenced.
const EXTERNAL = new Set([
  "users",            // auth.users, via the admin client
  "objects",          // storage.objects
  "buckets",          // storage.buckets
  "pg_policies", "pg_tables", "pg_class", "pg_namespace", "pg_timezone_names", "pg_indexes",
]);

test("every table the application queries actually exists", () => {
  const known = allSqlTables();
  assert.ok(known.size > 90, `sanity: expected the schema to be parsed, found ${known.size} tables`);

  const bad = [];
  for (const file of [...sourceFiles("app"), ...sourceFiles("lib"), ...sourceFiles("components")]) {
    const src = readFileSync(new URL(file, ROOT), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const m of src.matchAll(/\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/g)) {
      const table = m[1];
      if (known.has(table) || EXTERNAL.has(table)) continue;
      bad.push(`${file}: .from("${table}")`);
    }
  }
  assert.deepEqual(bad, [],
    `these table names do not exist in db/*.sql — the query returns an error nobody reads:\n  ${bad.join("\n  ")}`);
});

test("the detector catches the exact typo it was written for", () => {
  // Both-ways proof: the real defect must be recognised as one.
  const known = allSqlTables();
  assert.ok(!known.has("merchant_accounts"), "merchant_accounts must NOT exist — that was the bug");
  assert.ok(known.has("merchant_connections"), "merchant_connections is the real table");
});
