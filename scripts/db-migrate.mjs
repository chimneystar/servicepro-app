#!/usr/bin/env node
// =====================================================================
//  ServicePro — the migration runner.
//
//  Replaces "a person pastes 41 files into the Supabase SQL editor in filename
//  order and hopes". Applies pending migrations in order, records each one in
//  public.schema_migrations, and REFUSES TO PROCEED when anything is wrong.
//
//    npm run db:plan                    — offline. What the sequence is, and
//                                         whether db/ is internally coherent.
//                                         Needs no database.
//    npm run db:status                  — what this database has, what is
//                                         pending, what is wrong.
//    npm run db:migrate                 — apply everything pending.
//    npm run db:migrate -- adopt        — record the sequence as already
//                                         applied WITHOUT executing it. This is
//                                         how an existing production database
//                                         comes under the ledger.
//
//  Options: --through NNN  --accept-renames  --dry-run  --yes
//
//  Every decision this script makes lives in lib/core/migrations.mjs as a pure
//  function, and is unit-tested both ways in tests/migration-runner.test.mjs.
//  This file is only plumbing: filesystem, psql, and printing.
//
//  It drives `psql` as a subprocess rather than adding a Postgres driver
//  dependency, because that is what db/ci/run.sh already does and it is the
//  same authority the Supabase SQL editor runs migrations with.
// =====================================================================

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  LEDGER_READ_SQL,
  checksumOf,
  planMigrations,
  recordAdoptedSql,
  recordFinishSql,
  recordStartSql,
} from "../lib/core/migrations.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DB_DIR = join(ROOT, "db");
const LEDGER_SQL = join(DB_DIR, "migrations-ledger.sql");
const RUNNER_VERSION = "1";

// ---------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const command = positional[0] ?? "status";

const readOption = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : undefined;
};

const options = {
  through: readOption("through"),
  acceptRenames: flags.has("--accept-renames"),
  dryRun: flags.has("--dry-run"),
  yes: flags.has("--yes"),
};

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";
const paint = (c, s) => (process.stdout.isTTY ? `${c}${s}${OFF}` : s);

function die(message) {
  console.error(`\n${paint(RED, "REFUSING TO PROCEED")}: ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------
// The tree on disk
// ---------------------------------------------------------------------
function loadManifest() {
  const path = join(DB_DIR, "migrations.manifest.json");
  if (!existsSync(path)) die(`db/migrations.manifest.json is missing — cannot classify db/*.sql.`);
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Every .sql file directly inside db/, checksummed.
 * Subdirectories (db/ci/) are deliberately not migrations and are not listed.
 */
function readTree(manifest) {
  const allFilenames = readdirSync(DB_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();

  const files = allFilenames.map((filename) => ({
    filename,
    checksum: checksumOf(readFileSync(join(DB_DIR, filename), "utf8")),
  }));

  return { allFilenames, files, nonMigrations: manifest.nonMigrations ?? {} };
}

// ---------------------------------------------------------------------
// psql
// ---------------------------------------------------------------------
function databaseUrl() {
  const url = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!url) {
    die(
      "DATABASE_URL is not set. This command talks to a database.\n" +
        "  Supabase: Project Settings -> Database -> Connection string (use the session pooler or direct).\n" +
        "  Offline, no database needed:  npm run db:plan",
    );
  }
  return url;
}

function psql(args, { input } = {}) {
  const result = spawnSync(
    "psql",
    ["-X", "-v", "ON_ERROR_STOP=1", "-P", "pager=off", "--dbname", databaseUrl(), ...args],
    { encoding: "utf8", input, env: { ...process.env, PGCLIENTENCODING: "UTF8" } },
  );
  if (result.error && result.error.code === "ENOENT") {
    die(
      "`psql` is not installed or not on PATH. The runner shells out to psql rather than\n" +
        "bundling a Postgres driver. Install the PostgreSQL client tools, or run the SQL by hand\n" +
        "in the order `npm run db:plan` prints.",
    );
  }
  return result;
}

/** Run a scalar/JSON query and return stdout, refusing to guess on failure. */
function query(sql) {
  const r = psql(["-q", "-t", "-A", "-c", sql]);
  if (r.status !== 0) die(`query failed:\n${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

function ledgerInstalled() {
  return query("select to_regclass('public.schema_migrations') is not null") === "t";
}

function installLedger() {
  const r = psql(["-q", "-f", LEDGER_SQL]);
  if (r.status !== 0) die(`could not install the migration ledger:\n${r.stderr || r.stdout}`);
}

function readLedger() {
  if (!ledgerInstalled()) return null;
  return JSON.parse(query(LEDGER_READ_SQL) || "[]");
}

/** Who to record as having applied this. */
function operator() {
  return process.env.MIGRATION_APPLIED_BY ?? process.env.USER ?? process.env.USERNAME ?? "unknown";
}

// ---------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------
function reportProblems(problems) {
  if (!problems.length) return;
  console.error(
    `\n${paint(RED, `${problems.length} problem(s) — the runner will not touch this database:`)}\n`,
  );
  for (const p of problems) {
    const where = p.version ? `[${p.version}]` : p.filename ? `[${p.filename}]` : "";
    console.error(`  ${paint(RED, "x")} ${paint(YELLOW, p.code)} ${where}`);
    for (const line of p.message.split("\n")) console.error(`      ${line}`);
    console.error("");
  }
}

function buildPlan(ledger) {
  const manifest = loadManifest();
  const tree = readTree(manifest);
  return {
    manifest,
    tree,
    plan: planMigrations({
      files: tree.files,
      allFilenames: tree.allFilenames,
      nonMigrations: tree.nonMigrations,
      ledger: ledger ?? [],
      acceptRenames: options.acceptRenames,
    }),
  };
}

// ---------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------

/**
 * OFFLINE. Coherence of db/ itself: duplicates, gaps, unclassified files, and
 * the order the files must be applied in. Needs no database, which is why
 * db/ci/run.sh consumes it instead of keeping its own copy of the ordering
 * rules (including "016 is a test, not a migration").
 */
function cmdPlan() {
  const { plan, tree } = buildPlan([]);

  if (flags.has("--print")) {
    // Machine-readable: one absolute path per line, in application order.
    // Any problem is fatal here — emitting a partial order would be worse than
    // emitting nothing, because the consumer would apply it.
    if (plan.problems.length) {
      reportProblems(plan.problems);
      process.exit(1);
    }
    for (const m of plan.pending) console.log(join(DB_DIR, m.filename));
    return;
  }

  console.log(`\n${plan.pending.length} migrations in db/, in application order:\n`);
  for (const m of plan.pending) console.log(`  ${m.version}  ${m.filename}`);

  const excluded = tree.nonMigrations;
  console.log(`\n${paint(DIM, "not migrations:")}`);
  for (const name of Object.keys(excluded).sort()) console.log(`  ${paint(DIM, `-     ${name}`)}`);

  reportProblems(plan.problems);
  if (plan.problems.length) process.exit(1);
  console.log(
    `\n${paint(GREEN, "OK")} — db/ is internally coherent (no gaps, no duplicates, nothing unclassified).\n`,
  );
}

function cmdStatus() {
  const ledger = readLedger();
  if (ledger === null) {
    console.log(
      `\n${paint(YELLOW, "This database has no migration ledger.")}\n\n` +
        `  Fresh database:  npm run db:migrate\n` +
        `  Existing database already carrying this schema:  npm run db:migrate -- adopt\n`,
    );
    process.exit(1);
  }

  const { plan } = buildPlan(ledger);

  console.log(`\n${plan.applied.length} applied, ${plan.pending.length} pending.\n`);
  for (const a of plan.applied) {
    const state = a.row.finished_at ? a.row.origin : paint(RED, "UNFINISHED");
    console.log(`  ${paint(GREEN, "+")} ${a.version}  ${a.filename}  ${paint(DIM, state)}`);
  }
  for (const p of plan.pending)
    console.log(`  ${paint(YELLOW, "-")} ${p.version}  ${p.filename}  ${paint(DIM, "pending")}`);

  reportProblems(plan.problems);
  if (!plan.ok) process.exit(1);
  console.log(`\n${paint(GREEN, "OK")} — ledger and db/ agree.\n`);
}

/**
 * Bring an EXISTING database under the ledger without executing anything.
 *
 * This is the safe path for production, which already has all of this DDL and
 * no ledger. It records what is there rather than re-running it. Checksums are
 * taken from the files on disk NOW, which is the honest thing to record: it
 * pins the content this environment is declared to match, so any later edit is
 * caught even though the original application was never observed.
 */
function cmdAdopt() {
  if (!ledgerInstalled()) {
    if (options.dryRun) {
      console.log("would install db/migrations-ledger.sql");
    } else {
      installLedger();
    }
  }

  const ledger = readLedger() ?? [];
  const { plan } = buildPlan(ledger);

  // Only structural problems block adoption. `applied_file_missing` cannot
  // apply (nothing is recorded yet) and out-of-order is meaningless when the
  // whole sequence is being taken on trust at once.
  const blocking = plan.problems.filter(
    (p) => !["out_of_order", "applied_file_missing"].includes(p.code),
  );
  if (blocking.length) {
    reportProblems(blocking);
    die("db/ is not coherent — fix that before adopting anything.");
  }

  const through = options.through ?? plan.pending[plan.pending.length - 1]?.version;
  const take = plan.pending.filter((m) => m.version <= through);
  if (!take.length) {
    console.log(`\n${paint(GREEN, "Nothing to adopt")} — every migration is already recorded.\n`);
    return;
  }

  console.log(
    `\n${paint(YELLOW, "ADOPT")} — recording ${take.length} migrations (${take[0].version}..${take[take.length - 1].version}) ` +
      `as already applied.\n${paint(DIM, "No SQL from these files will be executed.")}\n`,
  );
  for (const m of take) console.log(`  ${m.version}  ${m.filename}`);

  if (options.dryRun) {
    console.log(`\n${paint(DIM, "--dry-run: nothing written.")}\n`);
    return;
  }
  if (!options.yes) {
    die(
      "adopt asserts that this database ALREADY contains the DDL in every file listed above.\n" +
        "If that is not true, the ledger will claim migrations that never ran and the runner will\n" +
        "never apply them. Verify first (db/MIGRATIONS.md has the object checks), then re-run with --yes.",
    );
  }

  const sql = recordAdoptedSql(
    take,
    operator(),
    `adopted by runner v${RUNNER_VERSION}; DDL assumed already present`,
  );

  const r = psql(["-q", "-c", sql]);
  if (r.status !== 0) die(`could not record adoption:\n${r.stderr || r.stdout}`);
  console.log(`\n${paint(GREEN, "Adopted")} ${take.length} migrations.\n`);
}

/** Apply everything pending, in order, recording each. */
function cmdUp() {
  if (!ledgerInstalled()) {
    console.log(`${paint(DIM, "installing db/migrations-ledger.sql")}`);
    if (!options.dryRun) installLedger();
  }

  const ledger = readLedger() ?? [];
  const { plan } = buildPlan(ledger);

  if (!plan.ok) {
    reportProblems(plan.problems);
    die("nothing was applied.");
  }

  const through = options.through;
  const take = through ? plan.pending.filter((m) => m.version <= through) : plan.pending;
  if (!take.length) {
    console.log(
      `\n${paint(GREEN, "Up to date")} — ${plan.applied.length} migrations applied, none pending.\n`,
    );
    return;
  }

  console.log(`\nApplying ${take.length} migration(s):\n`);
  for (const m of take) console.log(`  ${m.version}  ${m.filename}`);
  if (options.dryRun) {
    console.log(`\n${paint(DIM, "--dry-run: nothing executed.")}\n`);
    return;
  }

  const by = operator();

  for (const m of take) {
    console.log(`\n--- ${m.version} ${m.filename}`);

    // Two-phase, and the first phase COMMITS ON ITS OWN.
    //
    // The files are written for the Supabase SQL editor: no explicit
    // transaction control, and 027_hot_path_indexes.sql uses CREATE INDEX
    // CONCURRENTLY, which cannot run inside one. So the runner does not wrap
    // them — statements autocommit, exactly as they do today, and a failure
    // halfway genuinely leaves half the file applied.
    //
    // Committing the start row separately is what makes that visible. If psql
    // dies, the connection drops or the statement is cancelled, a row with a
    // null finished_at survives and every later run refuses until a human has
    // looked. Recording start and finish together would roll the evidence back
    // with the failure and leave exactly the silence this project already had.
    const start = psql(["-q", "-c", recordStartSql(m, by)]);
    if (start.status !== 0)
      die(`could not record the start of ${m.version}:\n${start.stderr || start.stdout}`);

    const applied = psql(["-q", "-f", join(DB_DIR, m.filename)]);
    if (applied.status !== 0) {
      console.error(applied.stdout);
      console.error(applied.stderr);
      die(
        `${m.filename} FAILED.\n` +
          `The ledger row for ${m.version} has been left UNFINISHED on purpose: this file has no\n` +
          `transaction of its own, so part of it may have been applied. Every later run will refuse\n` +
          `until you inspect the database, finish or undo the file by hand, and then either delete\n` +
          `that row or set its finished_at.`,
      );
    }
    console.log(applied.stdout.trim());

    const done = psql(["-q", "-c", recordFinishSql(m.version)]);
    if (done.status !== 0)
      die(`applied ${m.filename} but could not mark it finished:\n${done.stderr || done.stdout}`);
    console.log(paint(GREEN, `    recorded ${m.version}`));
  }

  console.log(`\n${paint(GREEN, "Done")} — applied ${take.length} migration(s).\n`);
}

// ---------------------------------------------------------------------
switch (command) {
  case "plan":
    cmdPlan();
    break;
  case "status":
    cmdStatus();
    break;
  case "up":
  case "migrate":
    cmdUp();
    break;
  case "adopt":
    cmdAdopt();
    break;
  default:
    die(`unknown command "${command}". Expected one of: plan, status, up, adopt.`);
}
