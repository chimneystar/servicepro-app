import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  checksumOf,
  classifyFiles,
  findGaps,
  normalizeSql,
  planMigrations,
} from "../lib/core/migrations.mjs";

// ---------------------------------------------------------------------------
// WHAT THIS FILE IS FOR
//
// There is no PostgreSQL, Docker or Supabase CLI on the machine this project is
// developed on, so not one of the 41 migrations has ever been executed. A
// migration runner whose guards could only be exercised against a live database
// would therefore ship with every guard unproven — which is exactly the failure
// this repository keeps finding in itself: safety nets that could never fail.
//
// So every decision the runner makes is a pure function over file lists,
// checksums and ledger rows, and every guard below is proven BOTH WAYS:
//   * it stays SILENT on a good tree, and
//   * it FIRES on a specific planted defect.
//
// A guard proven only in the passing direction is worth nothing, and a guard
// that fires on a healthy tree is the same defect wearing a different hat: it
// gets switched off, and then it is not a guard.
// ---------------------------------------------------------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB_DIR = join(ROOT, "db");
const MANIFEST = JSON.parse(readFileSync(join(DB_DIR, "migrations.manifest.json"), "utf8"));

const codes = (plan) => plan.problems.map((p) => p.code).sort();
const has = (plan, code) => plan.problems.some((p) => p.code === code);

/**
 * A minimal well-formed tree: three migrations, all applied, nothing wrong.
 * Every negative case below is this, with exactly one thing broken.
 */
function goodTree() {
  const files = [
    { version: "001", slug: "schema", filename: "001_schema.sql", checksum: "a".repeat(64) },
    { version: "002", slug: "team", filename: "002_team.sql", checksum: "b".repeat(64) },
    { version: "003", slug: "money", filename: "003_money.sql", checksum: "c".repeat(64) },
  ];
  const ledger = files.map((f) => ({
    version: f.version,
    name: f.slug,
    filename: f.filename,
    checksum: f.checksum,
    started_at: "2026-07-31T10:00:00Z",
    finished_at: "2026-07-31T10:00:01Z",
    origin: "applied",
  }));
  return { files, ledger };
}

const plan = ({ files, ledger, ...rest }) =>
  planMigrations({ files, ledger, allFilenames: files.map((f) => f.filename), ...rest });

// ===========================================================================
// The control. If this ever fails, every negative result below is meaningless.
// ===========================================================================

test("BOTH WAYS (baseline): a coherent tree with a matching ledger produces no problems", () => {
  const result = plan(goodTree());
  assert.deepEqual(result.problems, [], "the good tree must be silent");
  assert.equal(result.ok, true);
  assert.equal(result.pending.length, 0);
  assert.equal(result.applied.length, 3);
});

test("BOTH WAYS (baseline): an empty database has everything pending and nothing wrong", () => {
  const { files } = goodTree();
  const result = plan({ files, ledger: [] });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.pending.map((p) => p.version), ["001", "002", "003"]);
});

// ===========================================================================
// GUARD 1 — a migration file edited after it was applied
// ===========================================================================

test("checksum_mismatch FIRES when an applied migration's content changes", () => {
  const tree = goodTree();
  tree.files[1].checksum = "9".repeat(64); // somebody edited 002 after it ran
  const result = plan(tree);

  assert.equal(has(result, "checksum_mismatch"), true, "editing an applied file must be caught");
  assert.equal(result.ok, false);
  const problem = result.problems.find((p) => p.code === "checksum_mismatch");
  assert.equal(problem.version, "002");
  assert.match(problem.message, /has changed since it was applied/);
});

test("checksum_mismatch is SILENT when the content is unchanged", () => {
  assert.equal(has(plan(goodTree()), "checksum_mismatch"), false);
});

test("checksum_mismatch is SILENT across a CRLF/LF checkout — the guard must not cry wolf", () => {
  // Measured, not assumed. Every file in the owner's own Supabase bundle is
  // byte-different from this branch's copy and byte-identical after
  // normalisation, because the repo is developed on Windows with
  // core.autocrlf=true and built on Linux in CI. A raw-byte checksum would
  // report tampering on every migration on every cross-platform checkout.
  const unix = "create table x (id int);\nalter table x enable row level security;\n";
  const windows = unix.replace(/\n/g, "\r\n");
  const withBom = `﻿${windows}`;

  assert.notEqual(unix, windows, "the fixture must actually differ in bytes");
  assert.equal(checksumOf(unix), checksumOf(windows), "CRLF must not change the checksum");
  assert.equal(checksumOf(unix), checksumOf(withBom), "a BOM must not change the checksum");

  const tree = goodTree();
  tree.files[0].checksum = checksumOf(windows);
  tree.ledger[0].checksum = checksumOf(unix);
  assert.equal(has(plan(tree), "checksum_mismatch"), false);
});

test("normalizeSql leaves real content alone — it only touches line endings and the BOM", () => {
  // If normalisation were lossy, two genuinely different files could hash the
  // same and a tampered migration would sail through.
  const a = "select 1;\n";
  const b = "select 2;\n";
  assert.notEqual(checksumOf(a), checksumOf(b));
  assert.equal(normalizeSql("a\r\nb\rc\n"), "a\nb\nc\n");
  assert.equal(normalizeSql("  select 1;  "), "  select 1;  ", "whitespace is significant, not trimmed");
});

// ===========================================================================
// GUARD 2 — a hole in the sequence
// ===========================================================================

test("sequence_gap FIRES when a migration file is missing from the middle", () => {
  const tree = goodTree();
  tree.files = [tree.files[0], tree.files[2]]; // 001, 003 — 002 deleted
  tree.ledger = [tree.ledger[0], tree.ledger[2]];
  const result = plan(tree);

  assert.equal(has(result, "sequence_gap"), true, "a deleted migration must be caught");
  assert.equal(result.problems.find((p) => p.code === "sequence_gap").version, "002");
});

test("sequence_gap is SILENT on a contiguous sequence", () => {
  assert.equal(has(plan(goodTree()), "sequence_gap"), false);
});

test("sequence_gap is SILENT at 016, because a declared non-migration file is there", () => {
  // 016_isolation_tests.sql is a test, not a migration. That is a REASON, not
  // an exemption: the manifest holds FILENAMES, so the only way to quiet a gap
  // is to put a real file at that number and say what it is.
  const files = [
    { version: "015", slug: "indexes", filename: "015_indexes.sql", checksum: "a".repeat(64) },
    { version: "017", slug: "helcim", filename: "017_helcim.sql", checksum: "b".repeat(64) },
  ];
  const nonMigrations = { "016_isolation_tests.sql": "a test, not a migration" };
  const allFilenames = [...files.map((f) => f.filename), "016_isolation_tests.sql"];

  const quiet = planMigrations({ files, ledger: [], allFilenames, nonMigrations });
  assert.equal(has(quiet, "sequence_gap"), false, "a declared file at 016 is not a gap");

  // ...and remove the file while keeping the declaration: the gap comes back,
  // AND the empty declaration is itself reported.
  const loud = planMigrations({ files, ledger: [], allFilenames: files.map((f) => f.filename), nonMigrations });
  assert.equal(has(loud, "sequence_gap"), true, "declaring a name with no file must not hide the gap");
  assert.equal(has(loud, "declared_file_missing"), true);
});

test("findGaps reports every hole, not just the first", () => {
  const gaps = findGaps([
    { version: "001" },
    { version: "005" },
  ]);
  assert.deepEqual(gaps, ["002", "003", "004"]);
});

// ===========================================================================
// GUARD 3 — two files claiming the same number
// ===========================================================================

test("duplicate_version FIRES when two files claim the same migration number", () => {
  const result = classifyFiles(
    ["001_schema.sql", "002_team.sql", "002_teams.sql"],
    {},
  );
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].code, "duplicate_version");
  assert.equal(result.problems[0].version, "002");
  assert.equal(result.migrations.length, 2, "the duplicate must not silently join the sequence");
});

test("duplicate_version is SILENT when every number is unique", () => {
  const result = classifyFiles(["001_schema.sql", "002_team.sql", "003_money.sql"], {});
  assert.deepEqual(result.problems, []);
  assert.equal(result.migrations.length, 3);
});

test("duplicate_version FIRES when a migration takes a declared non-migration's number", () => {
  // FOUND BY PLANTING IT AGAINST THE REAL TREE. Renaming
  // 041_booking_locale_packs.sql to 016_booking_locale_packs.sql was called
  // COHERENT: 016 collided with the isolation test, and 041 vanishing left no
  // hole because the highest number simply became 040. A whole migration could
  // go missing in silence.
  const nonMigrations = { "016_isolation_tests.sql": "a test, not a migration" };
  const result = classifyFiles(
    ["015_indexes.sql", "016_booking_locale_packs.sql", "016_isolation_tests.sql", "017_helcim.sql"],
    nonMigrations,
  );
  assert.equal(
    result.problems.some((p) => p.code === "duplicate_version" && p.version === "016"),
    true,
    "a migration must not claim a number a declared non-migration already holds",
  );
});

test("duplicate_version is SILENT for the real tree's 016 — the declared file alone is fine", () => {
  const result = classifyFiles(
    ["015_indexes.sql", "016_isolation_tests.sql", "017_helcim.sql"],
    { "016_isolation_tests.sql": "a test, not a migration" },
  );
  assert.deepEqual(result.problems, [], "one declared file at 016 and no migration there is correct");
});

// ===========================================================================
// GUARD 4 — a migration that died halfway
// ===========================================================================

test("partially_applied FIRES on a ledger row that was started and never finished", () => {
  const tree = goodTree();
  tree.ledger[1].finished_at = null; // psql died / tab closed / statement cancelled
  const result = plan(tree);

  assert.equal(has(result, "partially_applied"), true, "a half-applied migration must stop everything");
  assert.equal(result.ok, false);
  assert.match(
    result.problems.find((p) => p.code === "partially_applied").message,
    /never finished|unknown state/,
  );
});

test("partially_applied is SILENT when every row has a finished_at", () => {
  assert.equal(has(plan(goodTree()), "partially_applied"), false);
});

// ===========================================================================
// GUARD 5 — a migration merged behind the high-water mark
// ===========================================================================

test("out_of_order FIRES on a pending migration numbered below one already applied", () => {
  const tree = goodTree();
  // 002 was never applied, but 003 was: a branch cut at 001 merged after 003.
  tree.ledger = tree.ledger.filter((r) => r.version !== "002");
  const result = plan(tree);

  assert.equal(has(result, "out_of_order"), true);
  const problem = result.problems.find((p) => p.code === "out_of_order");
  assert.equal(problem.version, "002");
  assert.match(problem.message, /newer than the one it was\s+written against/);
});

test("out_of_order is SILENT when pending migrations are all above the high-water mark", () => {
  const tree = goodTree();
  tree.files.push({ version: "004", slug: "next", filename: "004_next.sql", checksum: "d".repeat(64) });
  const result = plan(tree);
  assert.equal(has(result, "out_of_order"), false);
  assert.deepEqual(result.pending.map((p) => p.version), ["004"]);
});

// ===========================================================================
// GUARD 6 — the ledger names a migration this checkout does not have
//
// This is the live production situation: the database is running DDL from the
// unmerged branch feature/live-communications-payments (102 base tables) while
// main describes 97.
// ===========================================================================

test("applied_file_missing FIRES when the ledger knows a migration the checkout does not", () => {
  const tree = goodTree();
  tree.ledger.push({
    version: "004",
    name: "live_communications_payments",
    filename: "004_live_communications_payments.sql",
    checksum: "e".repeat(64),
    started_at: "2026-07-27T00:01:00Z",
    finished_at: "2026-07-27T00:01:30Z",
    origin: "applied",
  });
  const result = plan(tree);

  assert.equal(has(result, "applied_file_missing"), true, "deploying over a different history must be caught");
  assert.match(
    result.problems.find((p) => p.code === "applied_file_missing").message,
    /different branch or revision/,
  );
});

test("applied_file_missing is SILENT when every ledger row has its file", () => {
  assert.equal(has(plan(goodTree()), "applied_file_missing"), false);
});

// ===========================================================================
// GUARD 7 — renames. THE ONE THAT MATTERS MOST FOR THIS CHANGE.
//
// db/schema.sql was renamed to db/001_schema.sql. Identity is the VERSION, not
// the filename, so a rename must never re-run DDL against a live database — and
// must never be silent either.
// ===========================================================================

test("a renamed migration is NOT re-run — identity is the version, not the filename", () => {
  const tree = goodTree();
  tree.files[0].filename = "001_baseline.sql"; // renamed on disk
  tree.files[0].slug = "baseline";
  const result = plan({ ...tree, acceptRenames: true });

  assert.equal(result.pending.length, 0, "a rename must NOT make an applied migration pending again");
  assert.deepEqual(result.problems, []);
});

test("renamed_migration FIRES by default, so a file swap can never be silent", () => {
  const tree = goodTree();
  tree.files[0].filename = "001_baseline.sql";
  const result = plan(tree);

  assert.equal(has(result, "renamed_migration"), true);
  assert.equal(result.ok, false);
  assert.equal(result.pending.length, 0, "still not pending — it refuses, it does not re-run");
});

test("renamed_migration is SILENT when filenames match", () => {
  assert.equal(has(plan(goodTree()), "renamed_migration"), false);
});

test("the schema.sql -> 001_schema.sql rename is safe on a database adopted before it", () => {
  // The concrete case. An operator adopts a production database while the
  // baseline is still called schema.sql, then pulls this branch. Migration 001
  // must stay applied and must not be re-executed.
  const ledger = [{
    version: "001",
    name: "schema",
    filename: "schema.sql",
    checksum: "a".repeat(64),
    started_at: "2026-07-01T00:00:00Z",
    finished_at: "2026-07-01T00:05:00Z",
    origin: "adopted",
  }];
  const files = [{ version: "001", slug: "schema", filename: "001_schema.sql", checksum: "a".repeat(64) }];

  const result = planMigrations({ files, ledger, allFilenames: ["001_schema.sql"], acceptRenames: true });
  assert.deepEqual(result.pending, [], "the baseline must NOT be re-applied to a live database");
  assert.deepEqual(result.problems, []);
});

// ===========================================================================
// GUARD 8 — a .sql file nobody classified
// ===========================================================================

test("unclassified_file FIRES on an unnumbered .sql file in db/", () => {
  const result = classifyFiles(["001_schema.sql", "quick_fix.sql"], {});
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].code, "unclassified_file");
  assert.equal(result.problems[0].filename, "quick_fix.sql");
});

test("unclassified_file is SILENT once the file is declared a non-migration", () => {
  const result = classifyFiles(["001_schema.sql", "quick_fix.sql"], { "quick_fix.sql": "a scratch script" });
  assert.deepEqual(result.problems, []);
  assert.equal(result.excluded.length, 1);
});

// ===========================================================================
// GUARD 9 — a corrupt ledger
// ===========================================================================

test("duplicate_ledger_row FIRES when one version has two rows", () => {
  const tree = goodTree();
  tree.ledger.push({ ...tree.ledger[0] });
  assert.equal(has(plan(tree), "duplicate_ledger_row"), true);
});

test("duplicate_ledger_row is SILENT on a well-formed ledger", () => {
  assert.equal(has(plan(goodTree()), "duplicate_ledger_row"), false);
});

// ===========================================================================
// Every problem is fatal. There is no "warning" tier on purpose: this project
// got here by way of things that were noticed and not acted on.
// ===========================================================================

test("ok is false whenever ANY problem is present", () => {
  for (const mutate of [
    (t) => { t.files[1].checksum = "9".repeat(64); },
    (t) => { t.ledger[1].finished_at = null; },
    (t) => { t.files[0].filename = "001_other.sql"; },
    (t) => { t.ledger = t.ledger.filter((r) => r.version !== "002"); },
  ]) {
    const tree = goodTree();
    mutate(tree);
    const result = plan(tree);
    assert.ok(result.problems.length > 0, "the mutation must be detected");
    assert.equal(result.ok, false, "ok must be false whenever problems exist");
  }
});

// ===========================================================================
// THE REAL TREE. Everything above uses fixtures; this drives db/ as it ships.
// ===========================================================================

const realFilenames = readdirSync(DB_DIR, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".sql"))
  .map((e) => e.name)
  .sort();

const realFiles = realFilenames.map((filename) => ({
  filename,
  checksum: checksumOf(readFileSync(join(DB_DIR, filename), "utf8")),
}));

test("the real db/ directory is coherent: no gaps, no duplicates, nothing unclassified", () => {
  const result = planMigrations({
    files: realFiles,
    allFilenames: realFilenames,
    nonMigrations: MANIFEST.nonMigrations,
    ledger: [],
  });
  assert.deepEqual(
    result.problems.map((p) => `${p.code}: ${p.message}`),
    [],
    "db/ must be internally coherent",
  );
});

test("the real sequence starts at 001 and 016 is declared a test, not a migration", () => {
  const { migrations, excluded } = classifyFiles(realFilenames, MANIFEST.nonMigrations);

  assert.equal(migrations[0].version, "001", "the baseline must sort first");
  assert.equal(migrations[0].filename, "001_schema.sql");
  assert.ok(
    !migrations.some((m) => m.version === "016"),
    "016 is the isolation test and must never be applied as a migration",
  );
  assert.ok(
    excluded.some((e) => e.filename === "016_isolation_tests.sql"),
    "016 must be declared, so its number is not treated as a gap",
  );
  assert.ok(
    !migrations.some((m) => m.filename === "GO-LIVE.sql"),
    "GO-LIVE.sql is deprecated and must never be in the sequence",
  );
});

test("no numbered migration file sorts after the baseline by accident", () => {
  // The bug the rename fixed: `schema.sql` had no number, so it sorted AFTER
  // 041_ and every tool walking db/*.sql in filename order treated the baseline
  // as the newest file.
  const { migrations } = classifyFiles(realFilenames, MANIFEST.nonMigrations);
  const byName = [...migrations].sort((a, b) => a.filename.localeCompare(b.filename));
  assert.deepEqual(
    byName.map((m) => m.version),
    migrations.map((m) => m.version),
    "filename order and version order must be the same, or hand application applies them wrongly",
  );
});

test("the ledger table is not exposed to anon or authenticated", () => {
  // The threat model is PostgREST, not the UI. Supabase grants new tables to
  // anon and authenticated by default, and this table is a map of exactly which
  // security migrations an environment is missing.
  const sql = readFileSync(join(DB_DIR, "migrations-ledger.sql"), "utf8");
  assert.match(sql, /alter table public\.schema_migrations enable row level security/i);
  assert.match(sql, /revoke all on public\.schema_migrations from anon, authenticated/i);
  assert.ok(
    !/create policy\s+\w+\s+on public\.schema_migrations/i.test(sql),
    "RLS with no policies is what denies every row; a policy here would open it up",
  );
});
