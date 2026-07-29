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
  for (const route of ["/schedule", "/jobs", "/customers", "/leads", "/messages", "/calls", "/warranties", "/estimates", "/invoices", "/inventory", "/pricebook", "/recurring", "/reports", "/team", "/settings"]) {
    assert.ok(routes.has(route), `protected feature was removed: ${route}`);
  }
});

test("job history, warranties and calls keep their database protections", async () => {
  const sql = (await readFile(resolve(root, "db/021_job_history_warranty_calls.sql"), "utf8")).toLowerCase();
  for (const table of ["job_actions", "job_warranties", "warranty_callbacks", "tracked_phone_numbers", "call_events"]) {
    assert.ok(sql.includes(`create table if not exists public.${table}`), `missing table ${table}`);
    assert.ok(sql.includes(`alter table public.%i enable row level security`) || sql.includes(`alter table public.${table} enable row level security`), `RLS setup missing for ${table}`);
  }
  for (const guard of ["job_actions_job_org_guard", "warranty_callbacks_original_job_org_guard", "call_events_customer_org_guard", "call_events_job_org_guard"]) {
    assert.ok(sql.includes(guard), `missing tenant guard ${guard}`);
  }
  assert.ok(sql.includes("revoke all on public.job_actions"), "anonymous access was not revoked");
  assert.ok(sql.includes("security invoker"), "linked callback scheduling must respect the caller's RLS");
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
