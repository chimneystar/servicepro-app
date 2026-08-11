import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { buildTypes, TYPES_PATH } from "../scripts/db-types.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// THE TYPES ARE DERIVED, NOT TRANSCRIBED — AND THIS IS WHAT KEEPS THEM SO.
//
// Every read from the database used to come back as `any`, which meant
// `from("merchant_accounts")` — a table that has never existed anywhere in
// db/ — compiled cleanly in production code. The audit found it by grepping.
//
// A hand-written `Database` type would have caught that one and then rotted,
// the same way db/schema.sql rotted into being wrong by ~1,370 lines of DDL
// while everyone read it as the schema. So lib/supabase/database.types.ts is
// GENERATED from a database built by applying every migration to an empty
// PostgreSQL, and this test rebuilds it and fails when the committed copy and
// the migrations disagree.
//
// The consequence worth stating plainly: renaming a column in a migration now
// breaks the build at every screen that reads it, which is the whole point.
// ---------------------------------------------------------------------------

test("lib/supabase/database.types.ts matches what the migrations actually produce", async () => {
  const built = await buildTypes();
  const committed = readFileSync(TYPES_PATH, "utf8").replace(/\r\n/g, "\n");

  if (built !== committed) {
    // Point at the first divergence rather than dumping 8,000 lines.
    const a = built.split("\n");
    const b = committed.split("\n");
    const i = a.findIndex((line, n) => line !== b[n]);
    assert.fail(
      "lib/supabase/database.types.ts is stale — a migration changed the schema without the " +
        "types being regenerated. Run `npm run db:types`.\n" +
        `  first difference at line ${i + 1}:\n` +
        `    committed: ${JSON.stringify(b[i])}\n` +
        `    migrations produce: ${JSON.stringify(a[i])}`,
    );
  }
});

test("the generated types are deterministic — two builds of the same tree are identical", async () => {
  // A generator that varied between runs (catalogue OIDs, unordered queries)
  // would fail the test above at random and be switched off within a week.
  // Every query in scripts/db-types.mjs is explicitly ordered; this proves it.
  const [first, second] = [await buildTypes(), await buildTypes()];
  assert.equal(first, second, "the types must not depend on catalogue ordering");
});

test("the generated file carries the properties the type system depends on", async () => {
  const committed = readFileSync(TYPES_PATH, "utf8");

  // Nullability. A column that is nullable in the database and non-null in the
  // type is worse than no type at all: it makes `row.email.trim()` compile and
  // throw. `customers.email` is nullable in db/001_schema.sql.
  assert.match(committed, /email: string \| null;/, "a nullable column must carry `| null` in Row");

  // Generated columns must be unwritable. `jobs.slot` is a STORED generated
  // tsrange (it is what the double-booking exclusion constraint indexes); an
  // INSERT naming it is rejected by Postgres, so the type has to reject it too
  // or the failure only shows up in production.
  assert.match(
    committed,
    /slot\?: never;/,
    "a STORED generated column must be `never` in Insert/Update",
  );

  // Embedded selects. There are 25 `select("...customers(name)...")` calls in
  // this codebase and postgrest-js can only type them through Relationships.
  // Without foreign keys in the generated file they all become `never`.
  assert.match(committed, /foreignKeyName: "/, "foreign keys must be emitted as Relationships");

  // Enums, as unions rather than `string`. This is what makes
  // `status: "payed"` a compile error.
  assert.match(committed, /invoice_status: "unpaid" \| "paid" \| "void";/);

  // The one thing this whole item exists to prevent.
  assert.ok(
    !/merchant_accounts/.test(committed),
    "merchant_accounts has never existed in db/; if it appears here the generator is not reading " +
      "the migrations",
  );
});

test("no table typed here is missing from the derived schema snapshot", async () => {
  // Two generated views of the same database, built by two different scripts.
  // If they ever disagree about which tables exist, one of them is reading
  // something other than the migrations.
  const types = readFileSync(TYPES_PATH, "utf8");
  const snapshot = readFileSync(new URL("../db/schema.generated.txt", import.meta.url), "utf8");

  const typed = new Set(
    [...types.matchAll(/^ {6}(\w+): \{$/gm)].map((m) => m[1]).filter((n) => n !== "public"),
  );
  const inSnapshot = new Set([...snapshot.matchAll(/^table (\w+) {2}\[rls=/gm)].map((m) => m[1]));

  assert.ok(
    inSnapshot.size > 100,
    `expected the snapshot to list the tables, got ${inSnapshot.size}`,
  );
  const missing = [...inSnapshot].filter((t) => !typed.has(t));
  assert.deepEqual(missing, [], "every table in the schema snapshot must have a generated type");
});

test("the typed clients are the only way into the database, bar one declared exception", () => {
  // The point of ledger 6.1 is that `supabase.from("x")` is checked. Two things
  // would quietly undo it: creating a client without the `Database` generic,
  // and reintroducing an untyped one. Both are cheap and invisible in review,
  // because neither changes what the code DOES.
  //
  // `createUntypedClient` is the single declared exception — the whole-business
  // export walks ~120 tables from a manifest, so its table name is data. This
  // pins it to that one caller.
  const files = execSync('git ls-files "*.ts" "*.tsx"', { cwd: ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => f && !f.startsWith("tests/"));

  const callers = files.filter((f) =>
    /\bcreateUntypedClient\b/.test(readFileSync(join(ROOT, f), "utf8")),
  );
  assert.deepEqual(
    callers.sort(),
    ["app/api/export/business/route.ts", "lib/supabase/server.ts"],
    "createUntypedClient is deliberately confined to the whole-business export. Anywhere else, " +
      "use createClient() — a table name written as a literal is checkable and should be checked.",
  );

  // And the three factories must still carry the generic.
  for (const [file, needle] of [
    ["lib/supabase/client.ts", "createBrowserClient<Database>"],
    ["lib/supabase/server.ts", "createServerClient<Database>"],
    ["lib/supabase/admin.ts", "createClient<Database>"],
  ]) {
    assert.ok(
      readFileSync(join(ROOT, file), "utf8").includes(needle),
      `${file} must create its client with the generated Database generic; without it every ` +
        "query in every caller silently returns `any` again",
    );
  }
});
