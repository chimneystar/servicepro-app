import test from "node:test";
import assert from "node:assert/strict";
import { checkEnv, keyByteLength, CAPABILITIES } from "../lib/core/env-check.mjs";

const CORE = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

test("a correctly configured core environment passes", () => {
  // The guard must be able to say YES, or it is a cry-wolf that blocks deploys.
  const report = checkEnv(CORE);
  assert.equal(report.ok, true, report.fatal.join("; "));
  assert.deepEqual(report.fatal, []);
});

test("a missing required variable is FATAL", () => {
  for (const missing of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const env = { ...CORE };
    delete env[missing];
    const report = checkEnv(env);
    assert.equal(report.ok, false, `${missing} must be fatal`);
    assert.ok(report.fatal.some((line) => line.includes(missing)), `the message must name ${missing}`);
  }
});

test("an empty string counts as missing, not as configured", () => {
  assert.equal(checkEnv({ ...CORE, SUPABASE_SERVICE_ROLE_KEY: "" }).ok, false);
  assert.equal(checkEnv({ ...CORE, SUPABASE_SERVICE_ROLE_KEY: "   " }).ok, false);
});

test("a malformed Supabase URL is caught at boot, not at first query", () => {
  const report = checkEnv({ ...CORE, NEXT_PUBLIC_SUPABASE_URL: "not-a-url" });
  assert.equal(report.ok, false);
  assert.ok(report.fatal.some((line) => /valid URL/i.test(line)));
});

test("an absent optional capability is reported as disabled, not fatal", () => {
  const report = checkEnv(CORE);
  assert.equal(report.ok, true);
  assert.ok(report.disabled.some((line) => /SMS/.test(line)), "SMS should be listed as disabled");
  assert.ok(report.disabled.some((line) => /Helcim/.test(line)));
  assert.deepEqual(report.warnings, [], "a fully absent optional group is a choice, not a warning");
});

test("a PARTIALLY configured capability warns — it is a mistake, not an opt-out", () => {
  // This is the case that used to fail silently at the moment of use.
  const report = checkEnv({ ...CORE, TWILIO_ACCOUNT_SID: "sid", TWILIO_AUTH_TOKEN: "token" });
  assert.equal(report.ok, true, "a partial optional group must not block boot");
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /TWILIO_FROM/);
  assert.match(report.warnings[0], /fail at the moment it is used/);
});

test("a fully configured capability is reported as enabled", () => {
  const report = checkEnv({ ...CORE, TWILIO_ACCOUNT_SID: "sid", TWILIO_AUTH_TOKEN: "token", TWILIO_FROM: "+15550000000" });
  assert.ok(report.enabled.some((line) => /SMS/.test(line)));
  assert.deepEqual(report.warnings, []);
});

// ---------------------------------------------------------------------------
// PAYMENT_SECRETS_KEY — the 3am failure this whole module exists for.
// ---------------------------------------------------------------------------

const HELCIM = {
  HELCIM_PARTNER_TOKEN: "t",
  HELCIM_CONNECTED_WEBHOOK_VERIFIER: "v1",
  HELCIM_PAYMENT_WEBHOOK_VERIFIER: "v2",
};

test("a wrong-length encryption key is caught at boot", () => {
  const report = checkEnv({ ...CORE, ...HELCIM, PAYMENT_SECRETS_KEY: "abcd" });
  assert.equal(report.ok, false, "a short key must not reach production");
  assert.ok(report.fatal.some((line) => /32 bytes/.test(line)));
  assert.ok(report.fatal.some((line) => /first use/.test(line)), "the message must say WHEN it would have broken");
});

test("a correct 32-byte key in hex or base64 is accepted", () => {
  const hex = "a".repeat(64);                       // 32 bytes
  const b64 = Buffer.alloc(32, 7).toString("base64");
  for (const key of [hex, b64]) {
    const report = checkEnv({ ...CORE, ...HELCIM, PAYMENT_SECRETS_KEY: key });
    assert.equal(report.ok, true, `${key.slice(0, 8)}… should be accepted: ${report.fatal.join("; ")}`);
    assert.ok(report.enabled.some((line) => /Helcim/.test(line)));
  }
});

test("keyByteLength decodes hex and base64, and refuses nonsense", () => {
  assert.equal(keyByteLength("a".repeat(64)), 32);
  assert.equal(keyByteLength(Buffer.alloc(32, 1).toString("base64")), 32);
  assert.equal(keyByteLength(""), null);
  assert.equal(keyByteLength(undefined), null);
});

test("the capability list stays honest about what is required", () => {
  // Only server-side data access may be required; making an optional
  // integration required would block the whole app on a missing SMS key.
  const required = CAPABILITIES.filter((c) => c.required).map((c) => c.name);
  assert.equal(required.length, 1);
  assert.match(required[0], /Server-side data access/);
});
