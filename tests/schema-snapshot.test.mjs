import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSnapshot, SNAPSHOT_PATH } from "../scripts/db-schema.mjs";

// ---------------------------------------------------------------------------
// THE EXPECTED SCHEMA IS DERIVED, NOT TRANSCRIBED.
//
// `db/schema.sql` was, for the life of this project, both the baseline DDL and
// the thing people read to find out what the schema is. It could only ever do
// the first: it describes the database as it stood at migration 001, and forty
// migrations happened after it. Reading it as "the schema" gave an answer wrong
// by ~1,370 lines of DDL — the same class of drift that made db/MIGRATIONS.md
// dangerous enough to rebuild the wrong database.
//
// db/schema.generated.txt is built by applying every migration to an empty
// PostgreSQL and writing down what came out. This test rebuilds it and fails if
// the committed copy disagrees, so schema drift cannot land unnoticed and the
// diff shows up in review.
// ---------------------------------------------------------------------------

test("db/schema.generated.txt matches what the migrations actually produce", async () => {
  const built = await buildSnapshot();
  const committed = readFileSync(SNAPSHOT_PATH, "utf8").replace(/\r\n/g, "\n");

  if (built !== committed) {
    // Point at the first divergence rather than dumping 4,500 lines.
    const a = built.split("\n");
    const b = committed.split("\n");
    const i = a.findIndex((line, n) => line !== b[n]);
    assert.fail(
      "db/schema.generated.txt is stale — a migration changed the schema without it being " +
        `regenerated. Run \`npm run db:schema\`.\n` +
        `  first difference at line ${i + 1}:\n` +
        `    committed: ${JSON.stringify(b[i])}\n` +
        `    migrations produce: ${JSON.stringify(a[i])}`,
    );
  }
});

test("the snapshot is deterministic — two builds of the same tree are identical", async () => {
  // A snapshot that varied between runs (catalogue OIDs, unordered queries,
  // timestamps) would fail the test above at random and be deleted within a
  // week. Every query in the generator is explicitly ordered; this proves it.
  const [first, second] = [await buildSnapshot(), await buildSnapshot()];
  assert.equal(first, second, "the snapshot must not depend on catalogue ordering or run time");
});

test("the snapshot records RLS and policies, which is most of why it exists", async () => {
  const committed = readFileSync(SNAPSHOT_PATH, "utf8");

  // With PostgREST, a public table is a table with RLS off. The snapshot must
  // make that visible rather than only listing columns.
  assert.match(committed, /\[rls=on force=/, "RLS state must be recorded per table");
  assert.ok(
    !/\[rls=OFF/.test(committed),
    "a table in public with RLS off is reachable with the anon key — the snapshot found one",
  );
  assert.match(committed, /^\s+policy \w+: for /m, "policy predicates must be recorded");
  assert.match(committed, /^TABLES \(\d+\)/m);
  assert.match(committed, /^FUNCTIONS \(\d+\)/m);
});
