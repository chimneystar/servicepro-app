#!/usr/bin/env node
// =====================================================================
//  ServicePro — regenerate the migration sequence in db/MIGRATIONS.md.
//
//    npm run db:docs           — rewrite the generated block
//    npm run db:docs -- --check — fail if it is stale (used by npm test)
//
//  The sequence table used to be kept by hand. It drifted: it stopped at `017_`
//  and omitted 018-022 — five migrations, ~1,370 lines of DDL — so following it
//  as a disaster-recovery runbook rebuilt a database the application cannot run
//  against, and nothing anywhere noticed. Deriving the table from the files
//  actually on disk is the only thing that makes that impossible to repeat.
// =====================================================================

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { classifyFiles, renderSequenceTable, spliceGeneratedBlock } from "../lib/core/migrations.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB_DIR = join(ROOT, "db");
const DOC = join(DB_DIR, "MIGRATIONS.md");

export function buildBlock() {
  const manifest = JSON.parse(readFileSync(join(DB_DIR, "migrations.manifest.json"), "utf8"));
  const filenames = readdirSync(DB_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name);

  const { migrations, excluded, problems } = classifyFiles(filenames, manifest.nonMigrations ?? {});
  return {
    block: renderSequenceTable({ migrations, excluded, descriptions: manifest.descriptions ?? {} }),
    problems,
  };
}

const { block, problems } = buildBlock();
if (problems.length) {
  for (const p of problems) console.error(`  x ${p.code}: ${p.message}`);
  process.exit(1);
}

const current = readFileSync(DOC, "utf8");
const next = spliceGeneratedBlock(current, block);

if (process.argv.includes("--check")) {
  if (current !== next) {
    console.error("db/MIGRATIONS.md is out of date. Run `npm run db:docs`.");
    process.exit(1);
  }
  console.log("db/MIGRATIONS.md is up to date.");
} else {
  writeFileSync(DOC, next);
  console.log("db/MIGRATIONS.md regenerated.");
}
