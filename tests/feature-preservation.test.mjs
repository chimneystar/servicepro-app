import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import {
  tablesCreated,
  tablesWithRls,
  tablesWithPolicy,
  tablesRevokedFromAnon,
} from "./helpers/sql.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "config/feature-manifest.json"), "utf8"));
const readSql = (file) => readFile(resolve(root, "db", file), "utf8");

// ---------------------------------------------------------------------------
// FIRST: prove the analyzer, before any assertion relies on it.
//
// The checks this file used to make were tautological — they asserted the
// presence of `alter table public.%i enable row level security`, which is the
// FORMAT STRING inside a DO-loop and is therefore present regardless of which
// tables that loop covers. One even fell through to a bare
// `enable row level security`, true of nearly every migration. Those guards
// could not fail, so they certified nothing.
// ---------------------------------------------------------------------------

const SAMPLE = `
  create table if not exists public.covered (id uuid);
  create table if not exists public.uncovered (id uuid);
  do $$ declare t text; begin
    foreach t in array array['covered'] loop
      execute format('alter table public.%I enable row level security;', t);
      execute format('create policy %I on public.%I for select using (true);', t || '_sel', t);
      execute format('revoke all on public.%I from anon;', t);
    end loop;
  end $$;
`;

test("the analyzer detects a table covered inside a DO-loop", () => {
  assert.ok(tablesWithRls(SAMPLE).has("covered"));
  assert.ok(tablesWithPolicy(SAMPLE).has("covered"));
  assert.ok(tablesRevokedFromAnon(SAMPLE).has("covered"));
});

test("the analyzer does NOT credit a table absent from the loop array", () => {
  // This is the half the old tests got wrong: `uncovered` exists in the file and
  // the format string is present, but the table is not in the array.
  assert.ok(tablesCreated(SAMPLE).has("uncovered"), "sanity: the table is created");
  assert.ok(!tablesWithRls(SAMPLE).has("uncovered"), "must not report RLS it never got");
  assert.ok(!tablesWithPolicy(SAMPLE).has("uncovered"));
  assert.ok(!tablesRevokedFromAnon(SAMPLE).has("uncovered"));
});

test("commented-out SQL cannot satisfy a check", () => {
  const commented = `
    create table if not exists public.ghost (id uuid);
    -- alter table public.ghost enable row level security;
    /* create policy ghost_sel on public.ghost for select using (true); */
  `;
  assert.ok(!tablesWithRls(commented).has("ghost"));
  assert.ok(!tablesWithPolicy(commented).has("ghost"));
});

// ---------------------------------------------------------------------------
// Route preservation — cross-checked against the FILESYSTEM, not the manifest.
// The old tests read manifest.protectedRoutes and asserted things about
// manifest.protectedRoutes, so deleting a route from both disk and manifest
// passed silently.
// ---------------------------------------------------------------------------

function pagesOnDisk() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "page.tsx") out.push(relative(root, full).split(sep).join("/"));
    }
  };
  walk(resolve(root, "app"));
  return out;
}

test("every route in the manifest still has a page on disk", async () => {
  for (const route of [...manifest.protectedRoutes, ...manifest.publicWorkflows]) {
    await assert.doesNotReject(
      access(resolve(root, route.file)),
      `${route.path} is missing ${route.file}`,
    );
  }
});

test("every page on disk is accounted for in the manifest", () => {
  const claimed = new Set(
    [...manifest.protectedRoutes, ...manifest.publicWorkflows].map((r) => r.file),
  );
  const unlisted = pagesOnDisk().filter((f) => !claimed.has(f));
  assert.deepEqual(
    unlisted,
    [],
    `these pages exist but are outside the preservation contract:\n  ${unlisted.join("\n  ")}\nAdd them to config/feature-manifest.json.`,
  );
});

test("the sellable CRM keeps its essential workflows", () => {
  const routes = new Set(manifest.protectedRoutes.map((route) => route.path));
  for (const route of [
    "/schedule",
    "/jobs",
    "/customers",
    "/leads",
    "/messages",
    "/calls",
    "/warranties",
    "/estimates",
    "/invoices",
    "/inventory",
    "/pricebook",
    "/recurring",
    "/reports",
    "/team",
    "/appearance",
    "/finance",
    "/settings",
    "/settings/privacy",
    "/admin",
  ]) {
    assert.ok(routes.has(route), `protected feature was removed: ${route}`);
  }
});

test("team, role homes and appearance remain discoverable", async () => {
  const nav = await readFile(resolve(root, "lib/nav.ts"), "utf8");
  const dashboard = await readFile(resolve(root, "app/(app)/page.tsx"), "utf8");
  const layout = await readFile(resolve(root, "app/layout.tsx"), "utf8");
  assert.match(nav, /href: "\/team"/);
  assert.match(nav, /href: "\/appearance"/);
  assert.match(nav, /href: "\/finance"/);
  assert.match(dashboard, /profile\.role === "tech"\) redirect\("\/tech"\)/);
  assert.match(dashboard, /profile\.role === "office"\) redirect\("\/dispatch"\)/);
  assert.match(layout, /userScalable: true/);
});

// ---------------------------------------------------------------------------
// Database protections — now asserted per table, via the proven analyzer.
// ---------------------------------------------------------------------------

test("operations, privacy and platform tables are individually protected", async () => {
  const sql = await readSql("022_operations_privacy_team_admin.sql");
  const created = tablesCreated(sql),
    rls = tablesWithRls(sql),
    policies = tablesWithPolicy(sql);
  for (const table of [
    "tax_jurisdictions",
    "settlement_batches",
    "payment_disputes",
    "consent_events",
    "privacy_requests",
    "retention_holds",
    "platform_admins",
    "support_sessions",
    "feature_flags",
    "release_records",
  ]) {
    assert.ok(created.has(table), `missing table ${table}`);
    assert.ok(rls.has(table), `RLS is NOT enabled for ${table}`);
    assert.ok(
      policies.has(table),
      `${table} has RLS but no policy — it would be deny-all by accident`,
    );
  }
  assert.match(sql, /last_owner_required/);
});

test("every table created in 022 is protected, not just the ones we listed", async () => {
  const sql = await readSql("022_operations_privacy_team_admin.sql");
  const rls = tablesWithRls(sql),
    policies = tablesWithPolicy(sql);
  const unprotected = [...tablesCreated(sql)].filter((t) => !rls.has(t) || !policies.has(t));
  assert.deepEqual(
    unprotected,
    [],
    `tables created without RLS + policy: ${unprotected.join(", ")}`,
  );
});

test("job history, warranties and calls keep their database protections", async () => {
  const sql = await readSql("021_job_history_warranty_calls.sql");
  const created = tablesCreated(sql),
    rls = tablesWithRls(sql),
    policies = tablesWithPolicy(sql);
  for (const table of [
    "job_actions",
    "job_warranties",
    "warranty_callbacks",
    "tracked_phone_numbers",
    "call_events",
  ]) {
    assert.ok(created.has(table), `missing table ${table}`);
    assert.ok(rls.has(table), `RLS is NOT enabled for ${table}`);
    assert.ok(policies.has(table), `${table} has RLS but no policy`);
  }
  const lower = sql.toLowerCase();
  for (const guard of [
    "job_actions_job_org_guard",
    "warranty_callbacks_original_job_org_guard",
    "call_events_customer_org_guard",
    "call_events_job_org_guard",
  ]) {
    assert.ok(lower.includes(guard), `missing tenant guard ${guard}`);
  }
  assert.ok(
    tablesRevokedFromAnon(sql).has("job_actions"),
    "anonymous access to job_actions was not revoked",
  );
  assert.ok(
    lower.includes("security invoker"),
    "linked callback scheduling must respect the caller's RLS",
  );
});

test("the authorization hardening in 023 is still present", async () => {
  const sql = (await readSql("023_authorization_hardening.sql")).toLowerCase();
  for (const guard of [
    "guard_profile_privilege_columns",
    "guard_job_field_authority",
    "rotate_customer_portal_token",
  ]) {
    assert.ok(sql.includes(guard), `${guard} was removed — a privilege-escalation fix regressed`);
  }
  assert.ok(sql.includes("signed_at is null"), "approve_document must remain sign-once");
});

// ---------------------------------------------------------------------------
// Role claims in the manifest must mean something.
// ---------------------------------------------------------------------------

test("owner, office and technician experiences remain explicit", () => {
  const roles = new Set(manifest.protectedRoutes.flatMap((route) => route.roles));
  assert.deepEqual([...roles].sort(), ["office", "owner", "tech"]);
  assert.ok(
    manifest.protectedRoutes.some(
      (route) => route.path === "/tech" && route.roles.length === 1 && route.roles[0] === "tech",
    ),
  );
});

test("routes that exclude technicians actually keep them out", async () => {
  // The manifest's role list is a claim. Either the page enforces it, or the
  // data behind it is closed by RLS. Anything else is a claim with nothing
  // behind it — which is how /invoices ended up loading for a technician
  // (empty, because RLS held, but the page itself never checked).
  const RLS_CLOSED = new Set([
    "/invoices",
    "/invoices/[id]",
    "/invoices/[id]/edit",
    "/estimates",
    "/estimates/[id]",
    "/estimates/[id]/edit",
    "/expenses",
  ]);
  // A page enforces if it inspects the caller's role or delegates to a guard.
  // The first version of this check only recognised `role === "tech") redirect`
  // and flagged five pages that guard with `profile.role !== "owner"` — a false
  // RED, which burns the guard's credibility exactly as a false GREEN does.
  const ENFORCES =
    /assertRole\(|assertCapability\(|getPlatformAdmin|isPlatformAdmin|profile\.role\s*(!==|===)/;

  const gaps = [];
  for (const route of manifest.protectedRoutes) {
    if (route.roles.includes("tech")) continue;
    if (RLS_CLOSED.has(route.path)) continue;
    const src = await readFile(resolve(root, route.file), "utf8");
    if (!ENFORCES.test(src)) gaps.push(`${route.path} (${route.file})`);
  }
  assert.deepEqual(
    gaps,
    [],
    `manifest excludes technicians but the page never checks:\n  ${gaps.join("\n  ")}`,
  );
});

test("the role-enforcement detector can actually fail", () => {
  // Both-ways proof for the check above: it must reject a page with no guard.
  const ENFORCES =
    /assertRole\(|assertCapability\(|getPlatformAdmin|isPlatformAdmin|profile\.role\s*(!==|===)/;
  assert.ok(
    !ENFORCES.test(
      `export default async function Page() { const p = await requireProfile(); return <div/>; }`,
    ),
    "a page that merely authenticates must NOT count as role enforcement",
  );
  assert.ok(ENFORCES.test(`if (profile.role !== "owner") redirect("/");`));
  assert.ok(ENFORCES.test(`assertRole(profile, ["owner"]);`));
});

test("settings cannot silently lose major sections", () => {
  assert.ok(manifest.settingsCapabilities.length >= 23);
  for (const capability of [
    "job types",
    "job statuses",
    "message templates",
    "team roles",
    "payment methods",
    "Helcim card and ACH",
    "Zelle",
    "mailed checks",
  ]) {
    assert.ok(
      manifest.settingsCapabilities.includes(capability),
      `settings capability was removed: ${capability}`,
    );
  }
});

test("English and Hebrew dictionaries contain the same keys", async () => {
  const source = await readFile(resolve(root, "lib/i18n.ts"), "utf8");
  // \r?\n throughout: the original pattern hard-coded \n, so on a CRLF checkout
  // it matched NOTHING, both blocks fell back to "", and the test compared two
  // empty arrays and passed. The one check in this file the audit called
  // genuinely valuable was silently vacuous.
  const english =
    source.match(/const en: Dict = \{([\s\S]*?)\r?\n\};\r?\n\r?\nconst he:/)?.[1] ?? "";
  const hebrew =
    source.match(/const he: Dict = \{([\s\S]*?)\r?\n\};\r?\n\r?\nconst DICTS/)?.[1] ?? "";
  const keys = (block) =>
    [...block.matchAll(/"([a-zA-Z0-9_.]+)"\s*:/g)].map((match) => match[1]).sort();

  // Guard the guard: if the extraction ever breaks again, fail loudly rather
  // than comparing two empty sets.
  assert.ok(
    english.length > 0,
    "could not extract the English dictionary — this test would be vacuous",
  );
  assert.ok(
    hebrew.length > 0,
    "could not extract the Hebrew dictionary — this test would be vacuous",
  );
  assert.ok(
    keys(english).length > 200,
    `expected the full dictionary, found ${keys(english).length} keys`,
  );

  assert.deepEqual(keys(hebrew), keys(english));
});
