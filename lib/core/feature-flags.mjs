// Feature-flag evaluation. Plain ESM so `node --test` executes it directly.
//
// `feature_flags` (db/022_operations_privacy_team_admin.sql) has been written by
// the admin console since it shipped and read by NOTHING — a kill switch wired
// to no wire. This module is the decision half; lib/feature-flags.ts is the
// database half. Keeping the decision pure is what makes "off means off" and
// "on means on" provable rather than asserted.
//
// Tests: tests/feature-flags.test.mjs

/** Columns of one `feature_flags` row that matter to a decision. */
/**
 * @typedef {{
 *   key?: string,
 *   enabled?: boolean,
 *   rollout_percent?: number|string,
 *   organization_allowlist?: string[]|null,
 *   organization_blocklist?: string[]|null
 * }} FlagRow
 */

/**
 * Deterministic 0-99 bucket for an (key, organization) pair.
 *
 * FNV-1a over `key:org`. Deterministic is the whole point: a percentage
 * rollout that re-rolled per request would flicker a feature on and off for the
 * same business between two page loads.
 *
 * @param {string} key
 * @param {string} organizationId
 * @returns {number} 0..99
 */
export function flagBucket(key, organizationId) {
  const input = `${String(key ?? "")}:${String(organizationId ?? "")}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime, kept in 32-bit unsigned space via Math.imul.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

/**
 * Decide whether a flag is on for one organisation.
 *
 * Order, and why:
 *   1. blocklist   — an explicit "never this business" beats everything.
 *   2. !enabled    — the master switch is a KILL switch. An operator who turns
 *                    a flag off during an incident must not be overridden by an
 *                    allowlist entry somebody added months earlier.
 *   3. allowlist   — pilot businesses get it regardless of the percentage.
 *   4. rollout     — 0 means nobody, 100 means everybody, else a stable bucket.
 *
 * A missing row is NOT silently "off": the caller must state the default it
 * wants, so a flag nobody has created yet cannot quietly disable a feature that
 * used to work.
 *
 * @param {FlagRow|null|undefined} flag
 * @param {string} organizationId
 * @param {boolean} fallback value when there is no row at all
 * @returns {boolean}
 */
export function evaluateFlag(flag, organizationId, fallback) {
  if (typeof fallback !== "boolean")
    throw new TypeError("evaluateFlag requires an explicit boolean fallback");
  if (flag === null || flag === undefined) return fallback;
  const org = String(organizationId ?? "");
  const block = Array.isArray(flag.organization_blocklist) ? flag.organization_blocklist : [];
  if (org && block.includes(org)) return false;
  if (flag.enabled !== true) return false;
  const allow = Array.isArray(flag.organization_allowlist) ? flag.organization_allowlist : [];
  if (org && allow.includes(org)) return true;
  const rollout = Number(flag.rollout_percent);
  if (!Number.isFinite(rollout) || rollout <= 0) return false;
  if (rollout >= 100) return true;
  if (!org) return false; // a percentage rollout needs something to bucket
  return flagBucket(String(flag.key ?? ""), org) < rollout;
}

/**
 * Flag keys this codebase actually consults. Anything not listed here is a flag
 * the admin console can create but no code reads — which is the exact defect
 * ledger item 5.12 exists to close, so the list is deliberately short and
 * honest rather than aspirational.
 */
export const KNOWN_FLAGS = Object.freeze({
  /** Nightly execution of `automation_rules` (ledger 5.8). */
  automation_rules: { fallback: true, description: "Run automation rules on the daily cron" },
  /** Nightly campaign / estimate follow-up sending (ledger 5.9). */
  growth_outreach: {
    fallback: true,
    description: "Send scheduled campaigns and estimate follow-ups",
  },
});

/** @param {string} key */
export function flagFallback(key) {
  const known = KNOWN_FLAGS[key];
  if (!known) throw new Error(`unknown feature flag: ${key}`);
  return known.fallback;
}
