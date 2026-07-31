import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAuthorizedBearer, isSmsOptOut, isSmsOptIn, escapeHtml } from "../lib/core/security.mjs";

// ---------------------------------------------------------------------------
// Cron authorization — proven in BOTH directions.
// The regression: `if (secret && ...)` let an unset CRON_SECRET disable auth on
// an endpoint that deletes customer data across every organisation.
// ---------------------------------------------------------------------------

test("cron auth REFUSES when no secret is configured (fail closed)", () => {
  // This is the exact bug being guarded. Every one of these must be refused.
  assert.equal(isAuthorizedBearer("Bearer anything", undefined), false);
  assert.equal(isAuthorizedBearer("Bearer anything", null), false);
  assert.equal(isAuthorizedBearer("Bearer anything", ""), false);
  assert.equal(isAuthorizedBearer("", ""), false);
  // Even an empty presented header against an empty secret must not "match".
  assert.equal(isAuthorizedBearer("Bearer ", ""), false);
});

test("cron auth REFUSES a wrong, absent or malformed token", () => {
  const secret = "s3cret-value";
  assert.equal(isAuthorizedBearer("Bearer wrong", secret), false);
  assert.equal(isAuthorizedBearer("", secret), false);
  assert.equal(isAuthorizedBearer(null, secret), false);
  assert.equal(isAuthorizedBearer(secret, secret), false, "raw secret without the Bearer prefix must not pass");
  assert.equal(isAuthorizedBearer("bearer s3cret-value", secret), false, "scheme is case-sensitive here");
  assert.equal(isAuthorizedBearer("Bearer s3cret-value ", secret), false, "trailing whitespace must not pass");
});

test("cron auth ACCEPTS the correct token (guard is not a cry-wolf)", () => {
  // The other half of the both-ways proof: a guard that can only ever refuse is
  // the same bug wearing the other face.
  assert.equal(isAuthorizedBearer("Bearer s3cret-value", "s3cret-value"), true);
  const long = "a".repeat(512);
  assert.equal(isAuthorizedBearer(`Bearer ${long}`, long), true);
});

test("cron auth tolerates length mismatch without throwing", () => {
  // timingSafeEqual throws on unequal buffer lengths; hashing first prevents a
  // 500 that would otherwise be trivially distinguishable from a 401.
  assert.doesNotThrow(() => isAuthorizedBearer("Bearer short", "a".repeat(300)));
  assert.equal(isAuthorizedBearer("Bearer short", "a".repeat(300)), false);
});

// ---------------------------------------------------------------------------
// SMS opt-out — a customer replying STOP must stop receiving reminders.
// ---------------------------------------------------------------------------

test("STOP and its variants are recognised as opt-out", () => {
  for (const word of ["STOP", "stop", " Stop ", "STOPALL", "unsubscribe", "CANCEL", "end", "quit", "OptOut", "opt-out"]) {
    assert.equal(isSmsOptOut(word), true, `${JSON.stringify(word)} should opt out`);
  }
});

test("ordinary messages are NOT treated as opt-out", () => {
  // The false-positive half: silently unsubscribing a customer who asked a
  // question would be its own bug.
  for (const word of ["stop by tomorrow please", "can you stop at 4?", "", "  ", "STOPPED", "yes please", null, undefined]) {
    assert.equal(isSmsOptOut(word), false, `${JSON.stringify(word)} should NOT opt out`);
  }
});

test("START re-subscribes and does not collide with opt-out", () => {
  assert.equal(isSmsOptIn("START"), true);
  assert.equal(isSmsOptIn("start"), true);
  assert.equal(isSmsOptOut("START"), false);
  assert.equal(isSmsOptIn("STOP"), false);
});

// ---------------------------------------------------------------------------
// HTML escaping for values interpolated into outbound email.
// ---------------------------------------------------------------------------

test("customer-controlled values cannot inject markup into an email", () => {
  assert.equal(escapeHtml(`<script>alert(1)</script>`), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(escapeHtml(`" onmouseover="x`), "&quot; onmouseover=&quot;x");
  assert.equal(escapeHtml("Tom & Jerry's"), "Tom &amp; Jerry&#39;s");
  assert.equal(escapeHtml("plain name"), "plain name", "ordinary text must pass through untouched");
  assert.equal(escapeHtml(null), "");
});

// ---------------------------------------------------------------------------
// Structural guards. These assert on source because the property is structural,
// and each one names the exact regression it prevents.
// ---------------------------------------------------------------------------

/**
 * Read a source file with comments stripped.
 *
 * This matters: these guards describe the bug they prevent in a comment, so a
 * naive scan matches the prose and reports a regression that does not exist.
 * A check that fires on a healthy input is the same bug as one that misses a
 * broken input — it just fails in the other direction.
 */
const read = (p) => {
  const src = readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments (leave "https://" alone)
};

/** Raw read, for assertions that legitimately want the whole file. */
const readRaw = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the comment-stripping used by these guards actually works", () => {
  // Prove the helper before trusting the checks built on it.
  const stripped = read("app/api/cron/daily/route.ts");
  assert.ok(!/previously ran/.test(stripped), "block comments must be removed");
  assert.ok(/NextResponse/.test(stripped), "code must survive stripping");
});

test("the daily cron cannot regress to the fail-open pattern", () => {
  const src = read("app/api/cron/daily/route.ts");
  assert.ok(!/if\s*\(\s*secret\s*&&/.test(src),
    "`if (secret && ...)` skips auth entirely when CRON_SECRET is unset");
  // The fail-closed property itself is proven behaviourally above; what this
  // asserts is that the route still routes through that proven guard rather
  // than re-implementing the comparison inline.
  assert.ok(/isAuthorizedBearer\s*\(/.test(src),
    "the route must delegate to the both-ways-proven bearer check");
  assert.ok(!/timingSafeEqual/.test(src),
    "a second inline implementation would drift from the tested one");
});

test("the daily cron reports failure instead of always returning ok", () => {
  const src = read("app/api/cron/daily/route.ts");
  assert.ok(/failures\.length === 0|ok\s*=\s*failures/.test(src),
    "a cron that always returns ok:true hides a broken system behind a green dashboard");
});

test("the inbound SMS webhook verifies its signature and scopes the tenant", () => {
  const src = read("app/api/sms/incoming/route.ts");
  assert.ok(/validateTwilioSignature/.test(src), "inbound SMS must be authenticated like the voice webhooks");
  assert.ok(/tracked_phone_numbers/.test(src), "the organisation must be resolved from the number texted");
  assert.ok(!/from\("organizations"\)[\s\S]{0,80}limit\(1\)/.test(src),
    "falling back to an arbitrary organisation files a customer message under the wrong business");
});

test("photo deletion derives the storage path from the row, not the caller", () => {
  const src = read("app/(app)/jobs/[id]/actions.ts");
  assert.ok(!/storage\.from\("job-photos"\)\.remove\(\[path\]\)/.test(src),
    "a client-supplied path allows deleting arbitrary objects");
  assert.ok(/photo\.storage_path/.test(src), "the path must come from the fetched row");
});

test("document sending derives its origin from configuration, not the client", () => {
  const src = read("app/(app)/share-actions.ts");
  assert.ok(/function appOrigin/.test(src), "the link origin must be server-derived");
  assert.ok(!/const link = `\$\{origin\}/.test(src),
    "a caller-supplied origin turns this into branded phishing from the business's own identity");
});

test("migration 023 constrains the privilege columns on profiles", () => {
  const sql = read("db/023_authorization_hardening.sql").toLowerCase();
  assert.ok(/guard_profile_privilege_columns/.test(sql));
  for (const col of ["role", "organization_id", "active", "commission_pct"]) {
    assert.ok(sql.includes(`new.${col}`), `${col} must be pinned against self-service escalation`);
  }
  assert.ok(/inviter_role/.test(sql), "accept_invitation must verify who issued an owner-level invite");
});

test("security response headers are configured", () => {
  const src = readRaw("next.config.mjs");
  for (const header of ["Content-Security-Policy", "Strict-Transport-Security", "X-Frame-Options", "Referrer-Policy"]) {
    assert.ok(src.includes(header), `${header} must be set on an app serving payment pages`);
  }
  assert.ok(/frame-ancestors 'none'/.test(src), "payment and signing pages must not be framable");
});
