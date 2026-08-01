import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { chains, classify, unboundedReads } from "./helpers/reads.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

/** Source with comments removed, so a guard cannot fire on its own explanation. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Every source file, INCLUDING ones not yet committed.
 *
 * `git ls-files` alone lists only tracked files, which leaves the guard blind
 * to exactly the case that matters most: a brand-new file. Somebody adding a
 * screen writes the unpaged read and the new file in the same change, and a
 * tracked-only scan would pass right up until the commit that introduced the
 * defect had already been made. `--others --exclude-standard` adds the
 * untracked, non-ignored files; `.claude/worktrees/` and `.next/` are in
 * .gitignore, so other agents' checkouts and build output stay out.
 */
const sourceFiles = () => {
  const list = (args) =>
    execSync(`git ls-files ${args} "*.ts" "*.tsx"`, { cwd: ROOT, encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
  return [...new Set([...list(""), ...list("--others --exclude-standard")])]
    .filter((f) => !f.startsWith("tests/"))
    .map((f) => join(ROOT, f));
};

// ---------------------------------------------------------------------------
// THE RATCHET.
//
// PostgREST caps a response at 1000 rows and reports nothing: HTTP 200,
// `error: null`, a thousand valid rows and a missing remainder. That defect
// existed in 130 list reads across this codebase. `lib/data/` makes it
// impossible to write a new one — a repository never states its own bound, so
// it cannot omit one — but a mechanism that only protects code written through
// it protects nothing, because the next unpaged read will be written the old
// way by somebody who has not read this file.
//
// So this is the part that covers the whole tree. Every list read anywhere in
// the source must be bounded: a single row, a head count, an explicit
// `.limit()`/`.range()`, or a query handed to the gateway. Anything else must
// appear in tests/unpaged-reads.json, and that file may only get shorter.
//
// THE CEILING BELOW IS THE RATCHET ITSELF. It is a literal, in this file,
// which `scripts/unpaged-inventory.mjs --write` deliberately cannot change:
// regenerating the inventory can never quietly raise the number of unpaged
// reads the build tolerates. Lowering it is a one-line diff anybody can review.
// Raising it should require an argument.
// ---------------------------------------------------------------------------

/** The most unpaged list reads this build accepts. Only ever goes DOWN. */
const CEILING = 130;

const inventory = JSON.parse(read("tests/unpaged-reads.json"));

test("no list read outside the inventory can silently truncate at 1000 rows", () => {
  const found = unboundedReads(sourceFiles(), ROOT);
  const added = found.filter((f) => !inventory.includes(f));
  const fixed = inventory.filter((f) => !found.includes(f));

  assert.deepEqual(
    added,
    [],
    "these list reads have no bound. PostgREST will return the first 1000 rows " +
      "with no error and the rest will be missing. Route them through lib/data/ " +
      "(readAll pages; readAtMost takes an explicit limit), or if the read is " +
      "genuinely bounded some other way, say so and add it to " +
      "tests/unpaged-reads.json with a reason in the commit message.",
  );
  assert.deepEqual(
    fixed,
    [],
    "these reads are now bounded but are still listed as unpaged. Run " +
      "`node scripts/unpaged-inventory.mjs --write` and lower CEILING in this file.",
  );
});

test("the inventory of unpaged reads only ever gets shorter", () => {
  assert.ok(
    inventory.length <= CEILING,
    `tests/unpaged-reads.json has ${inventory.length} entries but the ceiling is ` +
      `${CEILING}. Raising the ceiling means shipping a new silent-truncation ` +
      `defect; page the read instead.`,
  );
});

// ---------------------------------------------------------------------------
// The data layer's own rules. These are what make the ratchet's exemption for
// `read-paged` honest: if a repository could take that classification without
// actually being paged, the scanner would be laundering the defect rather than
// finding it.
// ---------------------------------------------------------------------------

const dataLayerFiles = () =>
  readdirSync(join(ROOT, "lib/data"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `lib/data/${f}`);

test("every read in lib/data goes through the gateway — none is left unbounded", () => {
  const loose = [];
  for (const file of dataLayerFiles()) {
    const source = read(file);
    for (const chain of chains(source)) {
      if (classify(chain, source) === "read-unbounded") {
        loose.push(`${file}:${chain.line} ${chain.table}`);
      }
    }
  }
  assert.deepEqual(
    loose,
    [],
    "a repository that reads a table directly, without readAll/readAtMost/" +
      "readPage, is exactly the defect this directory exists to prevent",
  );
});

test("the gateway is the only thing that applies a range, and it applies one", () => {
  const gateway = read("lib/data/db.ts");
  assert.match(gateway, /\.range\(from, to\)/, "readAll/readPages must actually range");
  assert.match(gateway, /\.limit\(clampLimit\(/, "readAtMost must actually limit");
  assert.match(
    gateway,
    /pageUpTo</,
    "a limit above the cap must be PAGED, not clamped — clamping returns 999 rows " +
      "for a requested 1500 with no error, which is the defect in miniature",
  );

  // No repository may range or limit for itself. If one did, the bound would be
  // back in the caller's hands — which is the arrangement that produced 130
  // unpaged reads in the first place.
  //
  // Comments are stripped first. Without that, a repository DOCUMENTING why it
  // does not call `.range()` fails the check that it does not call `.range()`,
  // which is the guard reading its own explanation as the offence.
  const offenders = dataLayerFiles().filter(
    (f) => f !== "lib/data/db.ts" && /\.(range|limit)\s*\(/.test(stripComments(read(f))),
  );
  assert.deepEqual(
    offenders,
    [],
    "a repository must describe the query and let lib/data/db.ts bound it",
  );
});

test("a repository never swallows an error into an empty list", () => {
  // The codebase's signature defect: 161 of 189 reads ignored `error`, so a
  // failed query rendered as an empty screen and the operator believed the data
  // was gone. A repository that caught and returned [] would reinstate it
  // behind a nicer name.
  const bad = [];
  for (const file of dataLayerFiles()) {
    const source = read(file);
    if (/catch\s*(\([^)]*\))?\s*\{\s*return\s*\[\s*\]/.test(source)) bad.push(file);
    if (/\?\?\s*\[\s*\]\s*;?\s*\/\/\s*ignore/i.test(source)) bad.push(file);
  }
  assert.deepEqual(bad, [], "a failed read must reach the caller, not become an empty list");
});

test("the gateway throws on error rather than returning rows-so-far", () => {
  const gateway = read("lib/data/db.ts");
  assert.match(gateway, /throw new DataError\(source, error\)/, "a PostgREST error must throw");
  assert.match(
    gateway,
    /class NotFoundOrForbiddenError/,
    "a missing single row must not be reported as 'not found' — under RLS it may be 'forbidden'",
  );
  // PGRST116 is `.single()` reporting zero rows. It is the null case, not a
  // failure, and conflating them would make every optional lookup throw.
  assert.match(gateway, /PGRST116/, "the no-rows code must be handled as null, not as an error");
});

test("the page size is below PostgREST's cap", () => {
  // If a page asked for exactly 1000 rows it could not tell a full page from a
  // truncated one, and the loop would stop one page early on any table whose
  // size is an exact multiple of the cap. Proven against a real database in
  // tests/data-paging-db.test.mjs; asserted here so the constant cannot drift.
  const paging = read("lib/core/paging.mjs");
  const cap = Number(/POSTGREST_ROW_CAP = (\d+)/.exec(paging)[1]);
  const size = Number(/PAGE_SIZE = (\d+)/.exec(paging)[1]);
  assert.equal(cap, 1000, "Supabase's configured db-max-rows");
  assert.ok(size < cap, `PAGE_SIZE (${size}) must be below the cap (${cap})`);
});

test("the scanner can tell the three cases apart", () => {
  // A guard grounded in a text scan is worth exactly what its scanner is worth.
  // If `classify` silently found nothing, every test above would pass for ever.
  const unpaged = `const x = await supabase.from("customers").select("id, name").order("name");`;
  assert.equal(classify(chains(unpaged)[0], unpaged), "read-unbounded");

  const limited = `const x = await supabase.from("customers").select("id").limit(10);`;
  assert.equal(classify(chains(limited)[0], limited), "read-bounded");

  const single = `const x = await supabase.from("customers").select("id").eq("id", i).maybeSingle();`;
  assert.equal(classify(chains(single)[0], single), "read-one");

  const written = `await supabase.from("customers").insert(row).select("id");`;
  assert.equal(classify(chains(written)[0], written), "write");

  const paged = `return readAll("customers.listActive", () =>\n  supabase.from("customers").select("id").order("name"),\n);`;
  assert.equal(classify(chains(paged)[0], paged), "read-paged");

  // EVERY gateway function must be recognised, not just the short-named ones.
  // `readPageWithTotal(` briefly matched the `Page` alternative and then failed
  // on the following `(`, so the newest primitive was invisible and every query
  // using it was reported unbounded. A regex alternation is first-match.
  for (const fn of ["readAll", "readAtMost", "readPage", "readPages", "readPageWithTotal"]) {
    const src = `return ${fn}("x", () => supabase.from("jobs").select("id"), 10);`;
    assert.equal(classify(chains(src)[0], src), "read-paged", `${fn} must be recognised`);
  }
  // ...and a lookalike must NOT be.
  const impostor = `return readAllOfItUnbounded("x", () => supabase.from("jobs").select("id"));`;
  assert.equal(classify(chains(impostor)[0], impostor), "read-unbounded");

  // And the exemption is NARROW: a `readAll` three statements earlier must not
  // launder an unpaged read that follows it.
  const laundered = `const a = readAll("x", () => s.from("jobs").select("id"));\nconst b = await supabase.from("customers").select("id");`;
  const found = chains(laundered);
  assert.equal(classify(found[0], laundered), "read-paged");
  assert.equal(
    classify(found[1], laundered),
    "read-unbounded",
    "a nearby readAll must not exempt the read after it",
  );
});
