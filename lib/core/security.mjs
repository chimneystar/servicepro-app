// Pure security primitives. Plain ESM so `node --test` executes them directly.
//
// These exist as their own module specifically so the fail-closed behaviour can
// be PROVEN in both directions — that a check fires on a bad input AND stays
// silent on a good one. A guard that has only ever been reasoned about is a
// hypothesis.
//
// Tests: tests/security.test.mjs

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time bearer-token check that FAILS CLOSED on a missing secret.
 *
 * The bug this replaces: `if (secret && header !== expected) return 401` — which
 * skipped authentication entirely when the secret was unset, and .env.example
 * shipped it blank, making "no auth" the default.
 *
 * @param {string|null|undefined} presented  raw Authorization header
 * @param {string|null|undefined} secret     configured shared secret
 * @returns {boolean} true only when a non-empty secret is configured AND matches
 */
export function isAuthorizedBearer(presented, secret) {
  if (typeof secret !== "string" || secret.length === 0) return false; // fail closed
  if (typeof presented !== "string" || presented.length === 0) return false;
  // Hash first so timingSafeEqual never sees a length mismatch (it throws).
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

/**
 * Whether an inbound SMS body is a carrier opt-out keyword.
 * Honouring these is a legal requirement in the US (TCPA) and several other
 * markets; the previous implementation stored STOP as an ordinary message and
 * kept sending reminders.
 */
export function isSmsOptOut(body) {
  return /^\s*(stop|stopall|unsubscribe|cancel|end|quit|revoke|optout|opt-out)\s*$/i.test(String(body ?? ""));
}

/** Whether an inbound SMS body is a carrier opt-IN keyword (resubscribe). */
export function isSmsOptIn(body) {
  return /^\s*(start|unstop|yes|optin|opt-in)\s*$/i.test(String(body ?? ""));
}

/** Minimal HTML entity escape for untrusted values placed into an email body. */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
