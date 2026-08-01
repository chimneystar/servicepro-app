#!/usr/bin/env node
// =====================================================================
//  Count `any` as a TYPE, not as an English word.
//
//    npm run count:any            — the total and the worst files
//    npm run count:any -- --json  — machine-readable
//
//  WHY THIS EXISTS
//  ---------------
//  Ledger 6.1 is measured by this number, so the number has to be honest.
//  A plain `grep -c '\bany\b'` counts "any caller", "any of these" and
//  "anything" inside comments and strings — this codebase is heavily
//  commented, so that inflates the count AND, worse, makes it go UP when
//  someone writes a comment explaining why an `any` was removed. A metric
//  that punishes the fix is not a metric.
//
//  So comments, string literals, template literals and regexes are removed
//  first (reusing the same canonicaliser the structural probes use), and only
//  then is `any` counted as a standalone token.
// =====================================================================

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Remove comments, then blank out the contents of every literal. */
export function stripNonCode(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < n && source.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\") i++;
        i++;
      }
      i++;
      out += '""';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** `any` as a standalone identifier in code. */
export function countAny(source) {
  return (stripNonCode(source).match(/(?<![\w$])any(?![\w$])/g) ?? []).length;
}

export function surveyAny(files) {
  const byFile = {};
  let total = 0;
  for (const file of files) {
    const n = countAny(readFileSync(join(ROOT, file), "utf8"));
    if (n) {
      byFile[file] = n;
      total += n;
    }
  }
  return { total, byFile };
}

export function sourceFiles() {
  return execSync('git ls-files "*.ts" "*.tsx"', { cwd: ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const { total, byFile } = surveyAny(sourceFiles());
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ total, byFile }, null, 2));
  } else {
    console.log(`\`any\` as a type: ${total} in ${Object.keys(byFile).length} files\n`);
    for (const [file, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1])) {
      console.log(`${String(n).padStart(4)}  ${file}`);
    }
  }
}
