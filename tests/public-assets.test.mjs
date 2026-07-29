import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const middleware = readFileSync(join(root, "lib", "supabase", "middleware.ts"), "utf8");

test("the web-app manifest stays public for installation", () => {
  assert.match(middleware, /path === ["']\/manifest\.webmanifest["']/);
});
