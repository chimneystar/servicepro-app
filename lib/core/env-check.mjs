// Pure environment validation. Takes an env object, returns a report — no
// process.env access, no throwing — so it can be exercised directly by tests.
//
// THE FAILURE THIS PREVENTS: every secret was read lazily at the point of use,
// so a deploy with a missing variable succeeded and then failed later in front
// of a customer, unalerted. PAYMENT_SECRETS_KEY was the worst: the app booted
// fine and the FIRST REAL CARD PAYMENT threw.
//
// Tests: tests/env-check.test.mjs

/** Capability groups. Each is all-or-nothing — a half-configured integration is
 *  worse than an absent one, because it fails at the moment of use instead of
 *  being reported as unavailable up front. */
export const CAPABILITIES = [
  { name: "Server-side data access (webhooks, cron, health)", vars: ["SUPABASE_SERVICE_ROLE_KEY"], required: true },
  { name: "Scheduled automation (reminders, reconciliation, data retention)", vars: ["CRON_SECRET"], required: false },
  { name: "Card and ACH payments (Helcim)", vars: ["HELCIM_PARTNER_TOKEN", "HELCIM_CONNECTED_WEBHOOK_VERIFIER", "HELCIM_PAYMENT_WEBHOOK_VERIFIER", "PAYMENT_SECRETS_KEY"], required: false },
  { name: "SMS (Twilio)", vars: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"], required: false },
  { name: "Email (Resend)", vars: ["RESEND_API_KEY", "EMAIL_FROM"], required: false },
  { name: "Push notifications to technicians (Web Push / VAPID)", vars: ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"], required: false },
];

const REQUIRED_BASE = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];

const present = (env, name) => typeof env?.[name] === "string" && env[name].trim().length > 0;

/** Decoded byte length of a hex or base64 key, or null if undecodable. */
export function keyByteLength(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (/^[0-9a-f]+$/i.test(value) && value.length % 2 === 0) return value.length / 2;
  try {
    return Buffer.from(value, "base64").length;
  } catch {
    return null;
  }
}

/** Decoded byte length of a base64url value, or null. Used for the VAPID keys,
 *  which are raw EC points and scalars rather than hex. */
export function base64UrlByteLength(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (!/^[A-Za-z0-9\-_]+=*$/.test(value)) return null;
  try {
    return Buffer.from(value, "base64url").length;
  } catch {
    return null;
  }
}

export function checkEnv(env) {
  const fatal = [], warnings = [], enabled = [], disabled = [];

  for (const name of REQUIRED_BASE) {
    if (!present(env, name)) fatal.push(`${name} is missing`);
  }
  if (present(env, "NEXT_PUBLIC_SUPABASE_URL")) {
    try {
      new URL(env.NEXT_PUBLIC_SUPABASE_URL);
    } catch {
      fatal.push("NEXT_PUBLIC_SUPABASE_URL is not a valid URL");
    }
  }

  for (const capability of CAPABILITIES) {
    const missing = capability.vars.filter((name) => !present(env, name));
    if (missing.length === 0) { enabled.push(capability.name); continue; }
    if (capability.required) { fatal.push(`${capability.name} — missing: ${missing.join(", ")}`); continue; }
    if (missing.length < capability.vars.length) {
      warnings.push(`${capability.name} is PARTIALLY configured — missing: ${missing.join(", ")}. It will fail at the moment it is used.`);
    } else {
      disabled.push(capability.name);
    }
  }

  // A malformed VAPID key does not fail at boot — it fails as every push being
  // refused by the push service, invisibly, for ever. Say it up front.
  const vapid = [
    ["VAPID_PRIVATE_KEY", 32, "a 32-byte base64url P-256 private key"],
    ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", 65, "a 65-byte base64url uncompressed P-256 public key"],
  ];
  for (const [name, expected, shape] of vapid) {
    if (!present(env, name)) continue;
    const bytes = base64UrlByteLength(env[name]);
    if (bytes !== expected) {
      warnings.push(`${name} must be ${shape} (got ${bytes ?? "undecodable"} bytes). Push notifications would be refused by the push service on every send.`);
    }
  }
  if (present(env, "VAPID_SUBJECT") && !/^(mailto:|https:\/\/)/.test(env.VAPID_SUBJECT.trim())) {
    warnings.push("VAPID_SUBJECT must be a mailto: or https: address. Push notifications would be refused on every send.");
  }

  // A wrong-length encryption key throws only when the first payment runs.
  if (present(env, "PAYMENT_SECRETS_KEY")) {
    const bytes = keyByteLength(env.PAYMENT_SECRETS_KEY);
    if (bytes !== 32) {
      fatal.push(`PAYMENT_SECRETS_KEY must decode to 32 bytes (got ${bytes ?? "undecodable"}). Card payments would fail at first use.`);
    }
  }

  return { ok: fatal.length === 0, fatal, warnings, enabled, disabled };
}
