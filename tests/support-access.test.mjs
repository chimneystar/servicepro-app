import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { evaluateSupportSession, selectGrantingSession, supportAccessMessage } from "../lib/core/support-access.mjs";
import { stripSqlComments } from "./helpers/sql.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// THE DEFECT: `support_sessions` recorded a time-boxed, reason-bound,
// revocable grant that NO CODE ANYWHERE READ. Platform staff reached a business
// because they were in `platform_admins`, full stop — so the expiry did nothing
// and Revoke changed a timestamp nothing consulted.
//
// Every rule below is proven in both directions: the refusal fires, AND the
// legitimate equivalent still succeeds. A gate that can only refuse is the same
// bug wearing the other face.
// ---------------------------------------------------------------------------

const ADMIN = "11111111-1111-1111-1111-111111111111";
const ORG = "22222222-2222-2222-2222-222222222222";
const NOW = Date.parse("2026-07-31T12:00:00Z");

const session = (overrides = {}) => ({
  id: "session-1",
  case_id: "case-1",
  organization_id: ORG,
  admin_user_id: ADMIN,
  access_level: "read_only",
  starts_at: "2026-07-31T11:00:00Z",
  expires_at: "2026-07-31T15:00:00Z",
  revoked_at: null,
  ...overrides,
});

const ask = (row, extra = {}) => evaluateSupportSession(row, { now: NOW, adminUserId: ADMIN, organizationId: ORG, ...extra });

test("an active, unexpired, unrevoked session GRANTS access", () => {
  const verdict = ask(session());
  assert.equal(verdict.granted, true);
  assert.equal(verdict.reason, "active");
  assert.equal(verdict.sessionId, "session-1");
  assert.equal(verdict.caseId, "case-1");
});

test("a REVOKED session stops granting immediately, even though it has not expired", () => {
  // This is the property the Revoke button always claimed and never had.
  const revoked = session({ revoked_at: "2026-07-31T11:59:59Z" });
  assert.equal(Date.parse(revoked.expires_at) > NOW, true, "the session is still within its window");
  const verdict = ask(revoked);
  assert.equal(verdict.granted, false);
  assert.equal(verdict.reason, "revoked");
});

test("revocation takes effect on the very next check — nothing is cached", () => {
  // Model the real call path: the row is re-read every time, so flipping
  // revoked_at between two evaluations flips the answer.
  const row = session();
  assert.equal(ask(row).granted, true);
  row.revoked_at = new Date(NOW - 1000).toISOString();
  assert.equal(ask(row).granted, false, "the same session must stop granting the moment it is revoked");
  assert.equal(ask(row).reason, "revoked");
});

test("an EXPIRED session does not grant, and one expiring in a minute still does", () => {
  assert.equal(ask(session({ expires_at: "2026-07-31T11:59:00Z" })).reason, "expired");
  assert.equal(ask(session({ expires_at: "2026-07-31T12:00:00Z" })).reason, "expired", "expiry is exclusive at the boundary");
  assert.equal(ask(session({ expires_at: "2026-07-31T12:01:00Z" })).granted, true);
});

test("a session that has not started yet does not grant", () => {
  assert.equal(ask(session({ starts_at: "2026-07-31T12:00:01Z" })).reason, "not_started");
  assert.equal(ask(session({ starts_at: "2026-07-31T12:00:00Z" })).granted, true, "a session starting now is usable");
});

test("a session belonging to another staff member or another business does not grant", () => {
  assert.equal(ask(session({ admin_user_id: "99999999-9999-9999-9999-999999999999" })).reason, "wrong_admin");
  assert.equal(ask(session({ organization_id: "99999999-9999-9999-9999-999999999999" })).reason, "wrong_organization");
});

test("read_only does not confer guided_write, but guided_write confers both", () => {
  assert.equal(ask(session(), { requiredLevel: "guided_write" }).reason, "insufficient_level");
  assert.equal(ask(session({ access_level: "guided_write" }), { requiredLevel: "guided_write" }).granted, true);
  assert.equal(ask(session({ access_level: "guided_write" }), { requiredLevel: "read_only" }).granted, true);
});

test("no session at all, or a malformed one, refuses", () => {
  assert.equal(ask(null).reason, "no_session");
  assert.equal(ask(undefined).reason, "no_session");
  assert.equal(ask(session({ access_level: "root" })).reason, "unknown_level");
  assert.equal(ask(session({ expires_at: "not a date" })).reason, "invalid_window");
  assert.equal(ask(session({ starts_at: null })).reason, "invalid_window");
  assert.equal(ask(session(), { requiredLevel: "sudo" }).reason, "unknown_level");
});

test("selecting from many sessions grants only if one of them actually grants", () => {
  const stale = session({ id: "old", expires_at: "2026-07-31T11:30:00Z" });
  const killed = session({ id: "killed", revoked_at: "2026-07-31T11:45:00Z" });
  const live = session({ id: "live", expires_at: "2026-07-31T14:00:00Z" });
  const longer = session({ id: "longer", expires_at: "2026-07-31T15:30:00Z" });

  const refusal = selectGrantingSession([stale, killed], { now: NOW, adminUserId: ADMIN, organizationId: ORG });
  assert.equal(refusal.granted, false);
  assert.notEqual(refusal.reason, "no_session", "an expired or revoked session must be explained, not reported as absent");

  const granted = selectGrantingSession([stale, killed, live, longer], { now: NOW, adminUserId: ADMIN, organizationId: ORG });
  assert.equal(granted.granted, true);
  assert.equal(granted.sessionId, "longer", "the grant that lasts longest is used");

  assert.equal(selectGrantingSession([], { now: NOW }).reason, "no_session");
  assert.equal(selectGrantingSession(null, { now: NOW }).reason, "no_session");
});

test("each refusal has a distinct sentence in both languages", () => {
  const reasons = ["no_session", "revoked", "expired", "not_started", "wrong_admin", "wrong_organization", "insufficient_level"];
  const english = reasons.map((reason) => supportAccessMessage(reason, "en"));
  assert.equal(new Set(english).size, reasons.length, "a uniform 'forbidden' hides misconfiguration");
  for (const reason of reasons) {
    assert.notEqual(supportAccessMessage(reason, "he"), supportAccessMessage(reason, "en"));
  }
});

// ---------------------------------------------------------------------------
// Structural: the gate is wired in, and the migration matches the columns the
// rules read. Comments are stripped so commented-out code cannot pass a check.
// ---------------------------------------------------------------------------

const stripJsComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*$/gm, " ");
const source = (file) => stripJsComments(readFileSync(join(root, file), "utf8"));

test("platform-admin gating now consults support_sessions, not just platform_admins", () => {
  const platform = source("lib/platform-admin.ts");
  assert.match(platform, /from\("support_sessions"\)/);
  assert.match(platform, /selectGrantingSession/);
  assert.match(platform, /revoked_at/, "the revocation column has to be selected or it cannot be checked");
  assert.match(platform, /support_session_events/, "every attempt is recorded");
});

test("a tenant-data call in the admin console is gated on the session", () => {
  const actions = source("app/(app)/admin/actions.ts");
  assert.match(actions, /authorizeSupportAccess\(\{/);
  assert.match(actions, /if\s*\(!verdict\.granted\)\s*return\s*\{\s*ok:\s*false/);
});

test("migration 034 creates the support access audit table with the columns the code writes", () => {
  const sql = stripSqlComments(readFileSync(join(root, "db", "034_notifications_support.sql"), "utf8"));
  assert.match(sql, /create table if not exists public\.support_session_events/);
  for (const column of ["session_id", "organization_id", "admin_user_id", "action", "granted", "refusal_reason"]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`), `support_session_events.${column}`);
  }
  // Platform tables are service-role only (022 §4). This one must be too.
  assert.match(sql, /revoke all on public\.support_session_events from anon, authenticated/);
  assert.match(sql, /grant all\s+on public\.support_session_events to service_role/);
  assert.match(sql, /using \(false\) with check \(false\)/);
});
