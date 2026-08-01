#!/usr/bin/env node
/**
 * Regenerate tests/unpaged-reads.json — the inventory of list reads that are
 * still unbounded and will silently truncate at PostgREST's 1000-row cap.
 *
 * WHY IT IS GENERATED RATHER THAN HAND-WRITTEN. It is a list of file/table
 * pairs, and a hand-maintained one drifts into fiction the first time a file is
 * renamed. WHY THE CEILING IS NOT. `tests/data-layer.test.mjs` holds the
 * maximum as a literal that this script cannot touch, so regenerating the
 * inventory can never quietly raise the number of unpaged reads the build
 * accepts — the ratchet has to be released by hand, in a diff somebody reads.
 *
 *   node scripts/unpaged-inventory.mjs           # print
 *   node scripts/unpaged-inventory.mjs --write   # update the JSON
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unboundedReads, tally } from "../tests/helpers/reads.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Tracked AND untracked-but-not-ignored, matching tests/data-layer.test.mjs
// exactly. If the two disagreed about which files exist, regenerating the
// inventory would produce a file that immediately fails its own test.
const list = (args) =>
  execSync(`git ls-files ${args} "*.ts" "*.tsx"`, { cwd: ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);

const files = [...new Set([...list(""), ...list("--others --exclude-standard")])]
  .filter((f) => !f.startsWith("tests/"))
  .map((f) => path.join(ROOT, f));

const found = unboundedReads(files, ROOT);

if (process.argv.includes("--write")) {
  writeFileSync(path.join(ROOT, "tests/unpaged-reads.json"), JSON.stringify(found, null, 2) + "\n");
  console.log(`wrote tests/unpaged-reads.json (${found.length} entries)`);
} else {
  console.log(JSON.stringify(tally(files), null, 2));
  console.log(`\nunbounded list reads: ${found.length}`);
  for (const entry of found) console.log(`  ${entry}`);
}
