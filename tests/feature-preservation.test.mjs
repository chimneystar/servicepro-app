import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "config/feature-manifest.json"), "utf8"));

test("every protected and public workflow still has a page", async () => {
  for (const route of [...manifest.protectedRoutes, ...manifest.publicWorkflows]) {
    await assert.doesNotReject(access(resolve(root, route.file)), `${route.path} is missing ${route.file}`);
  }
});

test("the sellable CRM keeps its essential workflows", () => {
  const routes = new Set(manifest.protectedRoutes.map((route) => route.path));
  for (const route of ["/schedule", "/jobs", "/customers", "/leads", "/messages", "/estimates", "/invoices", "/inventory", "/pricebook", "/recurring", "/reports", "/team", "/settings"]) {
    assert.ok(routes.has(route), `protected feature was removed: ${route}`);
  }
});

test("owner, office and technician experiences remain explicit", () => {
  const roles = new Set(manifest.protectedRoutes.flatMap((route) => route.roles));
  assert.deepEqual([...roles].sort(), ["office", "owner", "tech"]);
  assert.ok(manifest.protectedRoutes.some((route) => route.path === "/tech" && route.roles.length === 1 && route.roles[0] === "tech"));
});

test("settings cannot silently lose major sections", () => {
  assert.ok(manifest.settingsCapabilities.length >= 14);
  for (const capability of ["job types", "job statuses", "message templates", "team roles", "payment methods", "Helcim card and ACH", "Zelle", "mailed checks"]) {
    assert.ok(manifest.settingsCapabilities.includes(capability), `settings capability was removed: ${capability}`);
  }
});

test("English and Hebrew dictionaries contain the same keys", async () => {
  const source = await readFile(resolve(root, "lib/i18n.ts"), "utf8");
  const english = source.match(/const en: Dict = \{([\s\S]*?)\n\};\n\nconst he:/)?.[1] ?? "";
  const hebrew = source.match(/const he: Dict = \{([\s\S]*?)\n\};\n\nconst DICTS/)?.[1] ?? "";
  const keys = (block) => [...block.matchAll(/"([a-zA-Z0-9_.]+)"\s*:/g)].map((match) => match[1]).sort();
  assert.deepEqual(keys(hebrew), keys(english));
});
