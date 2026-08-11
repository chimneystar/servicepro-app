import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stripSqlComments, tablesCreated, tablesWithRls } from "./helpers/sql.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

/** Comments are stripped FIRST: a claim written in prose must not satisfy a check. */
const sql038 = stripSqlComments(read("db/038_account_security.sql"));
const sql023 = stripSqlComments(read("db/023_authorization_hardening.sql"));
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

// ---------------------------------------------------------------------------
// 1. The tables that did not exist.
// ---------------------------------------------------------------------------
const NEW_TABLES = [
  "auth_login_attempts",
  "account_security_events",
  "permission_change_log",
  "document_signature_events",
  "profile_security",
  "secret_key_rotations",
];

test("migration 038 creates every table the security features depend on", () => {
  const created = tablesCreated(sql038);
  for (const table of NEW_TABLES) assert.ok(created.has(table), `${table} must be created`);
});

test("every new table has RLS enabled, and none is reachable by anon", () => {
  const withRls = tablesWithRls(sql038);
  for (const table of NEW_TABLES) {
    assert.ok(withRls.has(table), `${table} must have row level security enabled`);
    // The threat model is PostgREST, not the UI.
    assert.match(
      sql038,
      new RegExp(`revoke all on public\\.%I from anon|'${table}'`),
      `${table} must be in the anon revoke list`,
    );
  }
  assert.match(sql038, /revoke all on public\.%I from anon;/);
});

test("the audit tables are READ-ONLY to members — an audit trail a member can write is one they can forge", () => {
  assert.match(sql038, /revoke insert, update, delete on public\.%I from authenticated;/);
  for (const table of [
    "auth_login_attempts",
    "account_security_events",
    "permission_change_log",
    "document_signature_events",
  ]) {
    assert.ok(sql038.includes(`'${table}'`), `${table} must be in the read-only loop`);
  }
  // No write policy exists for any of them, so only definer functions and
  // triggers (and service_role, which bypasses RLS) can append.
  for (const table of [
    "auth_login_attempts",
    "permission_change_log",
    "document_signature_events",
  ]) {
    assert.ok(
      !new RegExp(`create policy [a-z_]+ on public\\.${table} for (insert|all)`).test(sql038),
      `${table} must have no write policy`,
    );
  }
});

test("login attempts and permission history are OWNER-only, and scoped to one organisation", () => {
  for (const policy of ["auth_login_attempts_select", "permission_change_log_select"]) {
    const clause = sql038.slice(
      sql038.indexOf(`create policy ${policy}`),
      sql038.indexOf(`create policy ${policy}`) + 300,
    );
    assert.match(
      clause,
      /organization_id = public\.current_org_id\(\)/,
      `${policy} must be tenant-scoped`,
    );
    assert.match(clause, /current_user_role\(\) = 'owner'/, `${policy} must be owner-only`);
  }
  // secret_key_rotations is platform bookkeeping: no policy at all.
  assert.ok(!sql038.includes("create policy secret_key_rotations"));
  assert.match(sql038, /revoke all on public\.secret_key_rotations from authenticated/);
});

// ---------------------------------------------------------------------------
// 2. Migration 023 is not weakened. This is the non-negotiable.
// ---------------------------------------------------------------------------
test("038 does not touch a single object 023 hardened", () => {
  for (const object of [
    "profiles_self_update",
    "accept_invitation",
    "invitations_write",
    "invitations_select",
    "jobs_update",
    "subscriptions_select",
  ]) {
    assert.ok(!sql038.includes(object), `038 must not reference ${object}`);
  }
  assert.ok(
    !/drop policy/i.test(
      sql038.replace(
        /drop policy if exists (auth_login_attempts|account_security_events|permission_change_log|document_signature_events|profile_security)[a-z_]* on[^;]*;/g,
        "",
      ),
    ),
    "the only policy drops are of 038's own, newly created policies",
  );
});

test("023's guards are still present in 023, unmodified", () => {
  // If a later session edited 023 instead of adding a migration, these fail.
  assert.match(sql023, /if inv\.role::text = 'owner' then/, "the owner-invitation guard");
  assert.match(sql023, /raise exception 'invitation_role_not_permitted'/);
  assert.match(
    sql023,
    /create policy profiles_self_update on public\.profiles for update to authenticated/,
  );
  assert.match(
    sql023,
    /role\s+= \(select p\.role\s+from public\.profiles p where p\.id = auth\.uid\(\)\)/,
  );
  assert.match(sql023, /raise exception 'privilege_change_denied'/);
});

test("023 §6's sign-once guard survives being moved behind the evidence function", () => {
  // 038 replaces approve_document. If the guard were lost, a leaked link would
  // once again destroy the original signature by re-signing over it.
  assert.equal(
    (sql038.match(/and signed_at is null/g) ?? []).length,
    2,
    "the guard applies to BOTH estimates and invoices",
  );
  assert.match(
    sql038,
    /create or replace function public\.approve_document\(p_token uuid, p_name text, p_sig text\)\s*\nreturns boolean/,
    "the signature and return type must be unchanged, or every existing caller breaks",
  );
  assert.match(
    sql038,
    /grant\s+execute on function public\.approve_document\(uuid, text, text\) to anon, authenticated;/,
    "the anon grant is preserved: db/ci/40_document_assertions.sql calls it as anon",
  );
});

test("the evidence-taking entry point is service-role only — forged evidence is worse than none", () => {
  assert.match(
    sql038,
    /revoke all on function public\.approve_document_with_evidence\([^)]*\) from public, anon, authenticated;/,
  );
  assert.match(
    sql038,
    /grant execute on function public\.approve_document_with_evidence\([^)]*\) to service_role;/,
  );
  assert.ok(
    !/grant execute on function public\.approve_document_with_evidence\([^)]*\) to anon/.test(
      sql038,
    ),
    "if the browser could call it, it could dictate its own IP address",
  );
});

// ---------------------------------------------------------------------------
// 3. Signature evidence reaches the database.
// ---------------------------------------------------------------------------
test("the documents themselves gain the evidence columns", () => {
  for (const table of ["estimates", "invoices"]) {
    assert.match(
      sql038,
      new RegExp(`alter table public\\.${table}\\s+add column if not exists signature_ip inet`),
    );
    assert.match(
      sql038,
      new RegExp(
        `alter table public\\.${table}\\s+add column if not exists signature_user_agent text`,
      ),
    );
  }
  assert.match(
    sql038,
    /capture\s+text not null default 'none' check \(capture in \('none', 'server'\)\)/,
    "an unwitnessed signature must be visible AS unwitnessed, not indistinguishable from a real one",
  );
});

test("signing goes through the server, which is the only place a request context exists", () => {
  const component = strip(read("components/SignApprove.tsx"));
  assert.ok(
    !component.includes('supabase.rpc("approve_document"'),
    "the browser must no longer call the RPC directly",
  );
  assert.ok(component.includes("approveDocument"), "it posts to the server action");

  const action = strip(read("app/p/[token]/actions.ts"));
  assert.match(action, /^"use server"/m);
  assert.ok(
    action.includes("approve_document_with_evidence"),
    "the evidence-taking entry point is used",
  );
  assert.ok(
    action.includes("getRequestContext"),
    "the IP and user agent come from the SERVER's view of the request",
  );
  assert.ok(
    action.includes("createHash"),
    "a hash of exactly what was stored makes the record checkable later",
  );
  assert.ok(
    action.includes("consume("),
    "signing is anonymous and reachable by anyone holding the link",
  );
});

// ---------------------------------------------------------------------------
// 4. Permission-change history.
// ---------------------------------------------------------------------------
test("permission changes are recorded by TRIGGER, so PostgREST cannot skip the log", () => {
  assert.match(sql038, /create or replace function public\.record_permission_change\(\)/);
  const flat = sql038.replace(/\s+/g, " ");
  for (const [table, timing] of [
    ["profiles", "after update or delete"],
    ["profile_capabilities", "after insert or update or delete"],
    ["profile_payment_permissions", "after insert or update or delete"],
    ["invitations", "after insert or update or delete"],
  ]) {
    assert.ok(
      flat.includes(
        `${timing} on public.${table} for each row execute function public.record_permission_change()`,
      ),
      `${table} must have the permission trigger (${timing})`,
    );
  }
});

test("the watched columns are exactly the ones that confer authority", () => {
  // Verified against the real column names: db/018 (profile_capabilities),
  // db/017 (profile_payment_permissions), db/001_schema.sql + db/012 (profiles).
  for (const column of ["role", "active", "commission_pct", "organization_id"]) {
    assert.ok(sql038.includes(`'${column}'`), `profiles.${column} must be watched`);
  }
  const capabilities = read("db/018_product_foundation.sql");
  for (const column of capabilities.match(/can_[a-z_]+/g) ?? []) {
    if (!capabilities.includes(`  ${column}      `) && !capabilities.includes(`  ${column} `))
      continue;
    assert.ok(sql038.includes(`'${column}'`), `profile_capabilities.${column} must be watched`);
  }
  for (const column of [
    "can_confirm_manual_payments",
    "can_refund_payments",
    "can_override_ach_holds",
  ]) {
    assert.ok(
      sql038.includes(`'${column}'`),
      `${column} must be watched — this is the refund authority`,
    );
  }
  assert.match(
    sql038,
    /if changes = '\{\}'::jsonb then/,
    "an ordinary edit must not fill the history with noise",
  );
});

test("the team actions attach the request context to the change they just caused", () => {
  const actions = strip(read("app/(app)/team/actions.ts"));
  assert.ok(
    actions.includes("stamp_permission_change_context"),
    "the trigger cannot see an HTTP header",
  );
  // Every authority-changing action must stamp.
  for (const name of [
    "changeRole",
    "updateCapabilities",
    "updatePaymentPermissions",
    "removeMember",
    "inviteMember",
    "cancelInvite",
  ]) {
    const body = actions.slice(actions.indexOf(`export async function ${name}`));
    const end = body.indexOf("export async function", 10);
    assert.ok(
      (end === -1 ? body : body.slice(0, end)).includes("stampPermissionContext"),
      `${name} must stamp the context`,
    );
  }
});

test("stamping can only ever touch the caller's OWN changes", () => {
  const body = sql038.slice(
    sql038.indexOf("create or replace function public.stamp_permission_change_context"),
  );
  assert.match(
    body,
    /where actor_profile_id = auth\.uid\(\)/,
    "otherwise it is a way to forge provenance",
  );
  assert.match(body, /and ip is null/, "and it must never overwrite a context already recorded");
});

// ---------------------------------------------------------------------------
// 5. Login records and the throttle functions.
// ---------------------------------------------------------------------------
test("the login functions are service-role only — the browser must not be able to write its own record", () => {
  for (const fn of ["record_login_attempt", "login_throttle_counts"]) {
    assert.ok(
      new RegExp(
        `revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`,
      ).test(sql038),
      `${fn} must be revoked from anon and authenticated`,
    );
    assert.ok(
      new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`).test(
        sql038,
      ),
      `${fn} must be granted to service_role`,
    );
  }
});

test("failures are counted only since the last SUCCESSFUL sign-in", () => {
  // Otherwise somebody who mistypes twice a week is permanently one attempt
  // from a lockout, and the feature becomes the outage.
  assert.match(sql038, /a\.at > coalesce\(last_success, '-infinity'::timestamptz\)/);
});

test("a malformed IP cannot abort a sign-in or a signature", () => {
  assert.match(sql038, /create or replace function public\.safe_inet\(p_value text\)/);
  assert.match(sql038, /exception when others then\s*\n\s*return null;/);
  // Everywhere an address is stored, it goes through the safe cast.
  assert.ok(!/\bp_ip::inet\b/.test(sql038), "no unguarded cast of a header value to inet");
});

// ---------------------------------------------------------------------------
// 6. The audit log finally has a reader (6b.4).
// ---------------------------------------------------------------------------
test("the audit log has a real reader with filters and pagination", () => {
  // The query shapes moved behind the data layer (lib/data/reporting.ts,
  // ledger 6.2) — every list read routes through a repository function that
  // pages instead of a raw `.select()` a business could silently outgrow. The
  // property this guards (a real, paginated, filterable, four-table reader)
  // now spans two files: the page wires the filters and the owner gate, and
  // reporting.ts holds the actual bounded queries.
  const page = strip(read("app/(app)/settings/security/page.tsx"));
  const dataLayer = strip(read("lib/data/reporting.ts"));
  assert.ok(
    dataLayer.includes('from("audit_log")'),
    "this is the first reader beyond a single record's 30-row timeline",
  );
  // The range is no longer written here at all: `listAuditLogPage` states a
  // PAGE and lib/data/db.ts's `readPageWithTotal` applies the range and asks
  // for the exact count in the same request. That is stronger than asserting
  // `.range(` in this file, because a bound the query cannot write is one it
  // cannot omit — tests/data-layer.test.mjs proves the gateway ranges, and
  // proves no repository ranges for itself.
  assert.ok(
    dataLayer.includes('count: "exact"') && dataLayer.includes("readPageWithTotal("),
    "a log you cannot page through is a log you cannot read",
  );
  assert.ok(
    page.includes("reporting.listAuditLogPage("),
    "the page must actually call the paginated reader, not just define one",
  );
  for (const filter of ["from", "to", "table", "action", "actor"]) {
    assert.ok(page.includes(`one("${filter}")`), `the ${filter} filter must be wired`);
  }
  assert.ok(dataLayer.includes('from("permission_change_log")'));
  assert.ok(dataLayer.includes('from("auth_login_attempts")'));
  assert.ok(dataLayer.includes('from("document_signature_events")'));
  assert.ok(
    page.includes("reporting.listRecentPermissionChanges(") &&
      page.includes("reporting.listRecentLoginAttempts(") &&
      page.includes("reporting.listRecentSignatureEvents("),
    "the page must actually call all three side-table readers",
  );
  // The business half is owner-only, matching the RLS in 038 §8.
  assert.ok(page.includes('profile.role === "owner"'));
});

test("the previous single-record reader is untouched", () => {
  const activity = read("lib/activity.ts");
  assert.ok(
    activity.includes(".limit(30)"),
    "the per-record timeline must keep working exactly as before",
  );
});

test("the security centre is reachable from the screens that lead to it", () => {
  for (const file of ["app/(app)/team/page.tsx", "app/(app)/settings/privacy/page.tsx"]) {
    assert.ok(
      read(file).includes("/settings/security"),
      `${file} must link to it — an unreachable screen is not a feature`,
    );
  }
});

// ---------------------------------------------------------------------------
// 7. Two-factor and session revocation (6b.5, 6b.6).
// ---------------------------------------------------------------------------
test("two-factor is enrolled through Supabase itself, and its state is mirrored for audit only", () => {
  const panel = strip(read("app/(app)/settings/security/AccountSecurity.tsx"));
  assert.ok(panel.includes("auth.mfa.enroll"), "the app had never called Supabase MFA once");
  assert.ok(
    panel.includes("auth.mfa.challengeAndVerify"),
    "enrolment is not complete until a code is verified",
  );
  assert.ok(panel.includes("auth.mfa.unenroll"));
  assert.ok(
    panel.includes("auth.mfa.listFactors"),
    "the factor list on screen must be the real one, not our mirror",
  );
  assert.ok(
    panel.includes("recordTwoFactorChange"),
    "turning MFA OFF must be as auditable as turning it on",
  );

  const login = strip(read("app/login/actions.ts"));
  assert.ok(
    login.includes("getAuthenticatorAssuranceLevel"),
    "a verified factor must actually gate the sign-in",
  );
  assert.ok(login.includes("challengeAndVerify"));
});

test("a lost phone can be signed out, and the revocation is recorded", () => {
  const actions = strip(read("app/(app)/settings/security/actions.ts"));
  assert.ok(
    actions.includes('signOut({ scope: "global" })'),
    "this is the real revocation, not a cosmetic flag",
  );
  assert.ok(actions.includes("sessions_revoked_at"));
  assert.ok(actions.includes("sessions_revoked"), "and it lands in the security event stream");
});

test("a new-device sign-in alerts, and an undeliverable alert is RECORDED rather than dropped", () => {
  const login = strip(read("app/login/actions.ts"));
  assert.ok(login.includes("isNewSignInDevice"));
  assert.ok(
    login.includes("login_alert_undelivered"),
    "silence is the failure mode this branch exists to remove",
  );
  assert.ok(login.includes("login_alert_failed"));
  assert.ok(
    login.includes("login_alerts_enabled"),
    "the alert must be something a person can turn off",
  );
});

// ---------------------------------------------------------------------------
// 8. IP capture is deliberate, not ambient.
// ---------------------------------------------------------------------------
test("the request context is captured where it is evidence and nowhere else", () => {
  const users = [
    "app/login/actions.ts",
    "app/signup/actions.ts",
    "app/p/[token]/actions.ts",
    "app/(app)/team/actions.ts",
    "app/(app)/settings/security/actions.ts",
  ];
  for (const file of users) {
    assert.ok(read(file).includes("getRequestContext"), `${file} must capture the context`);
  }
  // No middleware-wide or layout-wide capture: this is evidence, not a
  // page-view log, and an IP address is personal data in most jurisdictions.
  for (const file of ["proxy.ts", "app/(app)/layout.tsx", "lib/supabase/middleware.ts"]) {
    assert.ok(
      !read(file).includes("getRequestContext"),
      `${file} must NOT capture a context for every request`,
    );
  }
  assert.match(
    read("lib/core/request-context.mjs"),
    /never as a\s*\n\/\/ by-product of ordinary browsing/,
  );
});
