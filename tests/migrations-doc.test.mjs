import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  DOC_BEGIN,
  DOC_END,
  classifyFiles,
  renderSequenceTable,
  spliceGeneratedBlock,
} from "../lib/core/migrations.mjs";

// ---------------------------------------------------------------------------
// THE DOCUMENT CAN NEVER AGAIN STOP EARLY.
//
// db/MIGRATIONS.md was hand-maintained and it drifted: its sequence stopped at
// `017_` and silently omitted 018-022 — five migrations, roughly 1,370 lines of
// DDL covering permissions, dispatch, custom fields, booking, warranties, call
// tracking, privacy and platform administration. As a disaster-recovery runbook
// it rebuilt a database the application cannot run against, and nothing in the
// repository noticed for the entire life of the branch.
//
// The sequence is now generated from the files on disk. This test is the guard
// that keeps it that way: it regenerates the block and fails if the committed
// document differs, so adding a migration without documenting it breaks the
// build instead of quietly producing a wrong runbook.
// ---------------------------------------------------------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB_DIR = join(ROOT, "db");
const DOC = readFileSync(join(DB_DIR, "MIGRATIONS.md"), "utf8");
const MANIFEST = JSON.parse(readFileSync(join(DB_DIR, "migrations.manifest.json"), "utf8"));

const filenames = readdirSync(DB_DIR, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".sql"))
  .map((e) => e.name);

const { migrations, excluded, problems } = classifyFiles(filenames, MANIFEST.nonMigrations ?? {});
const render = (extra = {}) =>
  renderSequenceTable({ migrations, excluded, descriptions: MANIFEST.descriptions ?? {}, ...extra });

test("db/ classifies cleanly, or there is no sequence to document", () => {
  assert.deepEqual(problems.map((p) => p.code), []);
});

test("db/MIGRATIONS.md is exactly what the generator produces from db/", () => {
  const expected = spliceGeneratedBlock(DOC, render()).replace(/\r\n/g, "\n");
  assert.equal(
    DOC.replace(/\r\n/g, "\n"),
    expected,
    "db/MIGRATIONS.md is out of date with db/. Run `npm run db:docs`.",
  );
});

test("every migration on disk appears in the document — the 018-022 failure, guarded", () => {
  for (const m of migrations) {
    assert.match(
      DOC,
      new RegExp(`\\|\\s*\`${m.filename.replace(/\./g, "\\.")}\`\\s*\\|`),
      `db/${m.filename} exists but is missing from db/MIGRATIONS.md — exactly the omission that ` +
        `made the disaster-recovery runbook rebuild the wrong database`,
    );
  }
  assert.ok(migrations.length >= 40, `expected the full sequence, saw ${migrations.length}`);
});

test("the document names no migration that is not on disk", () => {
  const known = new Set([...migrations.map((m) => m.filename), ...excluded.map((e) => e.filename)]);
  const cited = [...DOC.matchAll(/\|\s*`(\d{3}_[A-Za-z0-9_-]+\.sql)`\s*\|/g)].map((m) => m[1]);
  assert.ok(cited.length > 0, "the generated table must actually cite files");
  for (const name of cited) {
    assert.ok(known.has(name), `db/MIGRATIONS.md cites db/${name}, which does not exist`);
  }
});

test("every migration has a real description — no placeholders", () => {
  // `038_account_security.sql` shipped for the life of the branch with the
  // literal text `_(describe this migration)_` in the hand-kept table.
  const missing = migrations.filter((m) => !(MANIFEST.descriptions ?? {})[m.version]);
  assert.deepEqual(
    missing.map((m) => m.filename),
    [],
    "add a description to db/migrations.manifest.json for each of these",
  );
  assert.ok(
    !/describe this migration/i.test(DOC),
    "a placeholder description is an undocumented migration wearing a costume",
  );
});

// ===========================================================================
// BOTH WAYS. The tests above pass on the good tree; these prove the same
// checks FAIL on a planted defect. A doc guard that cannot fail is exactly
// what the hand-kept list was.
// ===========================================================================

test("PLANTED DEFECT: a new migration with no description renders a MISSING marker", () => {
  const withNew = [...migrations, { version: "042", slug: "new_thing", filename: "042_new_thing.sql" }];
  const block = renderSequenceTable({
    migrations: withNew,
    excluded,
    descriptions: MANIFEST.descriptions ?? {},
  });
  assert.match(block, /042_new_thing\.sql/, "the new file must appear");
  assert.match(block, /\*\*MISSING — add a description/, "an undescribed migration must be marked");
  assert.notEqual(
    block,
    render(),
    "adding a migration must change the generated block, or the doc could stop early again",
  );
});

test("PLANTED DEFECT: dropping a migration from the tree changes the document", () => {
  // The literal 018-022 failure: generate from a truncated list and confirm the
  // output no longer matches what is committed.
  const truncated = migrations.filter((m) => m.version <= "017");
  const block = renderSequenceTable({
    migrations: truncated,
    excluded,
    descriptions: MANIFEST.descriptions ?? {},
  });
  assert.ok(!/018_product_foundation\.sql/.test(block), "the truncated render must omit 018");
  assert.notEqual(block, render());

  const staleDoc = spliceGeneratedBlock(DOC, block);
  assert.notEqual(
    staleDoc.replace(/\r\n/g, "\n"),
    DOC.replace(/\r\n/g, "\n"),
    "a document that stopped at 017 must not compare equal to the real one",
  );
});

test("PLANTED DEFECT: a document missing its markers is refused, not silently skipped", () => {
  assert.throws(
    () => spliceGeneratedBlock("# a doc with no markers\n", render()),
    /missing its .* markers/,
    "without the markers the generator must fail loudly rather than write nothing",
  );
  assert.ok(DOC.includes(DOC_BEGIN) && DOC.includes(DOC_END));
});
