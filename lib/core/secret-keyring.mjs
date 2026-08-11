// Encryption-key rotation for stored provider tokens.
//
// THE DEFECT THIS ADDRESSES: `merchant_secrets.key_version` has existed since
// migration 017 and NOTHING has ever read or written anything but its default
// of 1. lib/payments/crypto.ts derives a single key from PAYMENT_SECRETS_KEY,
// so changing that variable makes every stored Helcim token permanently
// unreadable — which means the key could never be rotated, not after a laptop
// was lost, not after someone left, not on a schedule. .env.example even said
// so out loud: "do not rotate it without re-encrypting data", with no way to
// re-encrypt anything.
//
// A keyring makes rotation possible: several keys are held at once, each row
// records which key encrypted it, and re-encryption walks the rows one at a
// time. The wire format is byte-compatible with what lib/payments/crypto.ts
// already writes ("v1:iv:tag:ciphertext", AES-256-GCM, base64url), so nothing
// stored today has to be migrated before rotation can begin.
//
// Tests: tests/secret-keyring.test.mjs

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Wire format tag. Matches lib/payments/crypto.ts exactly — do not change it. */
export const ENVELOPE_VERSION = "v1";

/** Decode `hex:...`, `base64:...` or bare base64 into a 32-byte key. */
export function decodeKeyMaterial(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  try {
    const key = value.startsWith("hex:")
      ? Buffer.from(value.slice(4), "hex")
      : Buffer.from(value.replace(/^base64:/, ""), "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

/**
 * Build the keyring from environment variables.
 *
 *   PAYMENT_SECRETS_KEY          the ACTIVE key. Unchanged meaning, so the
 *                                existing payment code keeps working untouched.
 *   PAYMENT_SECRETS_KEY_VERSION  which version number that key IS. Default 1,
 *                                which is exactly what every existing row says.
 *   PAYMENT_SECRETS_KEYS         retired keys still needed to READ rows that
 *                                have not been re-encrypted yet, as
 *                                "1:<material>,2:<material>". Never required in
 *                                steady state; only during a rotation.
 *
 * Returns a report rather than throwing: a half-configured keyring must be
 * reportable at boot, not discovered when a customer's card is charged.
 */
export function parseKeyring(env = {}) {
  const errors = [];
  const keys = new Map();

  const parsedVersion = Number(String(env.PAYMENT_SECRETS_KEY_VERSION ?? "1").trim() || "1");
  const activeVersion =
    Number.isInteger(parsedVersion) && parsedVersion >= 1 ? parsedVersion : null;
  if (activeVersion === null) {
    errors.push(
      `PAYMENT_SECRETS_KEY_VERSION must be a whole number >= 1 (got "${env.PAYMENT_SECRETS_KEY_VERSION}")`,
    );
  }

  for (const entry of String(env.PAYMENT_SECRETS_KEYS ?? "")
    .split(/[,\s]+/)
    .filter(Boolean)) {
    const separator = entry.indexOf(":");
    const version = Number(entry.slice(0, separator));
    const material = entry.slice(separator + 1);
    if (separator < 1 || !Number.isInteger(version) || version < 1) {
      errors.push(
        "PAYMENT_SECRETS_KEYS entries must look like <version>:<key>, e.g. 1:base64:AAAA...",
      );
      continue;
    }
    const key = decodeKeyMaterial(material);
    if (!key) {
      errors.push(`PAYMENT_SECRETS_KEYS version ${version} must decode to 32 bytes`);
      continue;
    }
    keys.set(version, key);
  }

  const activeKey = decodeKeyMaterial(env.PAYMENT_SECRETS_KEY);
  if (env.PAYMENT_SECRETS_KEY && !activeKey) {
    errors.push("PAYMENT_SECRETS_KEY must decode to exactly 32 bytes");
  }
  if (activeKey && activeVersion !== null) {
    const existing = keys.get(activeVersion);
    if (existing && !existing.equals(activeKey)) {
      // Silently preferring one would make a rotation write rows nothing can
      // read afterwards. Refuse instead.
      errors.push(
        `PAYMENT_SECRETS_KEYS declares version ${activeVersion} with different material to PAYMENT_SECRETS_KEY. ` +
          "One of them is wrong; rotating with both configured would corrupt stored tokens.",
      );
    }
    keys.set(activeVersion, activeKey);
  }

  return {
    ok: errors.length === 0 && Boolean(activeKey) && activeVersion !== null,
    configured: Boolean(activeKey),
    activeVersion: activeVersion ?? 1,
    versions: [...keys.keys()].sort((a, b) => a - b),
    keys,
    errors,
  };
}

/** The key for a stored row's `key_version`, or null when it is not held. */
export function keyForVersion(keyring, version) {
  const wanted = Number(version ?? 1);
  return keyring?.keys?.get(Number.isInteger(wanted) && wanted >= 1 ? wanted : 1) ?? null;
}

/** Encrypt under the ACTIVE key, reporting which version was used. */
export function encryptWithKeyring(plaintext, keyring) {
  if (!plaintext) throw new Error("Cannot encrypt an empty payment secret");
  const key = keyForVersion(keyring, keyring?.activeVersion);
  if (!key) throw new Error("No active payment secrets key is configured");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    payload: [
      ENVELOPE_VERSION,
      iv.toString("base64url"),
      tag.toString("base64url"),
      encrypted.toString("base64url"),
    ].join(":"),
    keyVersion: keyring.activeVersion,
  };
}

/**
 * Decrypt a stored payload using the key its row says encrypted it.
 *
 * The error messages are the point: "key version 1 is not in the keyring" tells
 * an operator exactly which variable to restore. AES-GCM's own failure is
 * "Unsupported state or unable to authenticate data", which tells them nothing.
 */
export function decryptWithKeyring(payload, keyVersion, keyring) {
  const [version, ivValue, tagValue, encryptedValue] = String(payload ?? "").split(":");
  if (version !== ENVELOPE_VERSION || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Unsupported encrypted payment secret");
  }
  const key = keyForVersion(keyring, keyVersion);
  if (!key) {
    throw new Error(
      `Payment secret key version ${keyVersion ?? 1} is not in the keyring. ` +
        "Add it to PAYMENT_SECRETS_KEYS before rotating or reading this record.",
    );
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Re-encrypt one payload from its current key to the active key. */
export function rotatePayload(payload, keyVersion, keyring) {
  const plaintext = decryptWithKeyring(payload, keyVersion, keyring);
  const rotated = encryptWithKeyring(plaintext, keyring);
  // Never return the plaintext to the caller: a rotation has no business
  // handing a merchant API token to anything that only needs to store it.
  return rotated;
}

/**
 * Decide what a rotation would do, BEFORE it does anything.
 *
 * A rotation that starts, re-encrypts half the businesses and then meets a row
 * whose key is missing leaves the estate in two states at once. The plan is
 * computed first so the operator is told "3 rows cannot be read, key version 1
 * is missing" instead of finding out at row 4.
 */
export function planRotation(rows, keyring) {
  const activeVersion = keyring?.activeVersion ?? 1;
  const plan = {
    activeVersion,
    toRotate: [],
    alreadyCurrent: [],
    unreadable: [],
    missingVersions: [],
  };
  const missing = new Set();

  for (const row of rows ?? []) {
    const version = Number(row?.key_version ?? 1);
    const id = row?.organization_id ?? row?.id ?? null;
    if (version === activeVersion) {
      plan.alreadyCurrent.push(id);
      continue;
    }
    if (!keyForVersion(keyring, version)) {
      plan.unreadable.push({ id, keyVersion: version });
      missing.add(version);
      continue;
    }
    plan.toRotate.push({ id, keyVersion: version });
  }

  plan.missingVersions = [...missing].sort((a, b) => a - b);
  plan.ok = plan.unreadable.length === 0;
  return plan;
}

/** One sentence describing a plan, for the console. */
export function describeRotationPlan(plan, locale = "en") {
  const he = locale === "he";
  if (!plan?.ok) {
    const versions = plan?.missingVersions?.join(", ") ?? "";
    return he
      ? `לא ניתן להתחיל: ${plan?.unreadable?.length ?? 0} רשומות מוצפנות במפתחות שאינם זמינים (גרסאות ${versions}). הוסיפו אותם ל-PAYMENT_SECRETS_KEYS.`
      : `Cannot start: ${plan?.unreadable?.length ?? 0} record(s) are encrypted with key version(s) ${versions}, which are not in the keyring. Add them to PAYMENT_SECRETS_KEYS first.`;
  }
  if (plan.toRotate.length === 0) {
    return he
      ? `כל הרשומות כבר מוצפנות במפתח הפעיל (גרסה ${plan.activeVersion}).`
      : `Every record is already encrypted with the active key (version ${plan.activeVersion}).`;
  }
  return he
    ? `${plan.toRotate.length} רשומות יוצפנו מחדש לגרסה ${plan.activeVersion}. ${plan.alreadyCurrent.length} כבר מעודכנות.`
    : `${plan.toRotate.length} record(s) will be re-encrypted to key version ${plan.activeVersion}. ${plan.alreadyCurrent.length} already current.`;
}

// ---------------------------------------------------------------------------
// WHAT THIS DOES NOT DO, stated rather than implied.
//
// lib/payments/crypto.ts still reads PAYMENT_SECRETS_KEY alone and ignores
// key_version. So the supported rotation is:
//
//   1. deploy with PAYMENT_SECRETS_KEY = new key,
//      PAYMENT_SECRETS_KEY_VERSION = n+1,
//      PAYMENT_SECRETS_KEYS = "n:<old key>,n+1:<new key>"
//   2. run the rotation from /admin immediately
//   3. once every row reports version n+1, drop the old key from
//      PAYMENT_SECRETS_KEYS
//
// Between (1) and (2) a not-yet-rotated row cannot be decrypted by the payment
// path, because that path has no keyring. That window is the reason ledger item
// 6b.9 is PARTIAL. Closing it is a four-line change in lib/payments/crypto.ts
// to call decryptWithKeyring with the row's key_version — deliberately not made
// here, because that file belongs to another workstream on this branch.
// ---------------------------------------------------------------------------
