// Static guard against the #1 cause of React hydration errors (#418/#423):
// locale-dependent Intl formatting inside CLIENT components. Server and client
// can pick different default locales/timezones, so every toLocale* call in a
// "use client" file MUST pass an explicit locale (e.g. "en-US").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localeless = /\.toLocale(?:Date|Time)?String\(\s*(?:\)|\[)/; // "(" then ")" or "[" => no explicit locale

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

test("no client component uses locale-less Intl formatting", () => {
  const offenders = [];
  for (const dir of ["components", "app"]) {
    for (const file of walk(join(root, dir))) {
      const src = readFileSync(file, "utf8");
      const isClient = /^\s*["']use client["']/m.test(src.split("\n").slice(0, 3).join("\n"));
      if (!isClient) continue;
      src.split("\n").forEach((line, i) => {
        if (localeless.test(line)) offenders.push(`${file.replace(root + "/", "")}:${i + 1}  ${line.trim()}`);
      });
    }
  }
  assert.equal(offenders.length, 0, "Locale-less date/number formatting in client components:\n" + offenders.join("\n"));
});
