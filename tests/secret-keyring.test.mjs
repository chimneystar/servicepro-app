import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createCipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseKeyring,
  keyForVersion,
  encryptWithKeyring,
  decryptWithKeyring,
  rotatePayload,
  planRotation,
  describeRotationPlan,
  decodeKeyMaterial,
  ENVELOPE_VERSION,
} from "../lib/core/secret-keyring.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const KEY_ONE = "hex:" + "11".repeat(32);
const KEY_TWO = "hex:" + "22".repeat(32);
const KEY_THREE = randomBytes(32).toString("base64");

/** Exactly what lib/payments/crypto.ts writes today, produced independently. */
function legacyEncrypt(value, rawKey) {
  const key = decodeKeyMaterial(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

// ---------------------------------------------------------------------------
// THE DEFECT: merchant_secrets.key_version has existed since migration 017 and
// nothing has ever written anything but its default of 1, so PAYMENT_SECRETS_KEY
// could never be changed — doing so made every stored Helcim token unreadable.
// ---------------------------------------------------------------------------

test("the wire format is byte-compatible with what is already stored", () => {
  // If this is wrong, rotation is not a migration — it is data loss.
  assert.equal(ENVELOPE_VERSION, "v1");
  const stored = legacyEncrypt("helcim-token-abc", KEY_ONE);
  const keyring = parseKeyring({ PAYMENT_SECRETS_KEY: KEY_ONE, PAYMENT_SECRETS_KEY_VERSION: "1" });
  assert.equal(decryptWithKeyring(stored, 1, keyring), "helcim-token-abc");

  const mine = encryptWithKeyring("helcim-token-abc", keyring);
  assert.match(mine.payload, /^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
  assert.equal(mine.payload.split(":").length, 4);
});

test("a single key with no rotation configured behaves exactly as before", () => {
  const keyring = parseKeyring({ PAYMENT_SECRETS_KEY: KEY_ONE });
  assert.equal(keyring.ok, true);
  assert.equal(keyring.activeVersion, 1, "existing rows all say key_version 1");
  assert.deepEqual(keyring.versions, [1]);
  assert.deepEqual(keyring.errors, []);
  const { payload, keyVersion } = encryptWithKeyring("token", keyring);
  assert.equal(keyVersion, 1);
  assert.equal(decryptWithKeyring(payload, 1, keyring), "token");
});

test("the OLD key still reads old rows while the NEW key writes new ones", () => {
  const old = legacyEncrypt("old-token", KEY_ONE);
  const keyring = parseKeyring({
    PAYMENT_SECRETS_KEY: KEY_TWO,
    PAYMENT_SECRETS_KEY_VERSION: "2",
    PAYMENT_SECRETS_KEYS: `1:${KEY_ONE},2:${KEY_TWO}`,
  });
  assert.equal(keyring.ok, true);
  assert.deepEqual(keyring.versions, [1, 2]);
  assert.equal(decryptWithKeyring(old, 1, keyring), "old-token", "the point of a keyring");
  assert.equal(
    encryptWithKeyring("new-token", keyring).keyVersion,
    2,
    "new writes use the active key",
  );
});

test("rotation re-encrypts, and the rotated payload is readable ONLY by the new key", () => {
  const stored = legacyEncrypt("helcim-token-abc", KEY_ONE);
  const both = parseKeyring({
    PAYMENT_SECRETS_KEY: KEY_TWO,
    PAYMENT_SECRETS_KEY_VERSION: "2",
    PAYMENT_SECRETS_KEYS: `1:${KEY_ONE},2:${KEY_TWO}`,
  });

  const rotated = rotatePayload(stored, 1, both);
  assert.equal(rotated.keyVersion, 2);
  assert.notEqual(rotated.payload, stored);
  assert.equal(
    decryptWithKeyring(rotated.payload, 2, both),
    "helcim-token-abc",
    "the value survives the rotation",
  );

  // Proven the other way: the old key alone cannot read the rotated payload,
  // which is what makes the rotation a real key change and not a relabelling.
  const onlyOld = parseKeyring({ PAYMENT_SECRETS_KEY: KEY_ONE, PAYMENT_SECRETS_KEY_VERSION: "1" });
  assert.throws(
    () => decryptWithKeyring(rotated.payload, 1, onlyOld),
    /unable to authenticate|Unsupported/i,
  );

  // And a rotation never hands the plaintext back to its caller.
  assert.deepEqual(Object.keys(rotated).sort(), ["keyVersion", "payload"]);
});

test("a missing key is reported by NAME, not as a crypto error nobody can act on", () => {
  const stored = legacyEncrypt("token", KEY_ONE);
  const onlyNew = parseKeyring({ PAYMENT_SECRETS_KEY: KEY_TWO, PAYMENT_SECRETS_KEY_VERSION: "2" });
  assert.throws(
    () => decryptWithKeyring(stored, 1, onlyNew),
    /key version 1 is not in the keyring[\s\S]*PAYMENT_SECRETS_KEYS/,
  );
});

test("a keyring that contradicts itself is REFUSED rather than silently preferred", () => {
  // Declaring version 2 as two different keys means one of them is wrong.
  // Guessing would re-encrypt rows under a key nobody can read afterwards.
  const keyring = parseKeyring({
    PAYMENT_SECRETS_KEY: KEY_TWO,
    PAYMENT_SECRETS_KEY_VERSION: "2",
    PAYMENT_SECRETS_KEYS: `2:${KEY_ONE}`,
  });
  assert.equal(keyring.ok, false);
  assert.match(keyring.errors.join(" "), /different material/);
});

test("malformed configuration is caught before anything is written", () => {
  assert.match(parseKeyring({ PAYMENT_SECRETS_KEY: "hex:abcd" }).errors.join(" "), /32 bytes/);
  assert.match(
    parseKeyring({ PAYMENT_SECRETS_KEY: KEY_ONE, PAYMENT_SECRETS_KEY_VERSION: "zero" }).errors.join(
      " ",
    ),
    /whole number/,
  );
  assert.match(
    parseKeyring({ PAYMENT_SECRETS_KEY: KEY_ONE, PAYMENT_SECRETS_KEYS: "justakey" }).errors.join(
      " ",
    ),
    /<version>:<key>/,
  );
  assert.match(
    parseKeyring({ PAYMENT_SECRETS_KEY: KEY_ONE, PAYMENT_SECRETS_KEYS: "1:hex:zz" }).errors.join(
      " ",
    ),
    /32 bytes/,
  );
  assert.equal(parseKeyring({}).configured, false);
  assert.equal(parseKeyring({}).ok, false);
  assert.equal(keyForVersion(parseKeyring({ PAYMENT_SECRETS_KEY: KEY_ONE }), 7), null);
});

test("both hex and base64 key material decode, and nothing else does", () => {
  assert.equal(decodeKeyMaterial(KEY_ONE).length, 32);
  assert.equal(decodeKeyMaterial(KEY_THREE).length, 32);
  assert.equal(decodeKeyMaterial(`base64:${KEY_THREE}`).length, 32);
  for (const bad of ["", null, undefined, "hex:zz", "short"])
    assert.equal(decodeKeyMaterial(bad), null);
});

test("the plan is computed BEFORE anything moves, and refuses a half-readable estate", () => {
  const keyring = parseKeyring({
    PAYMENT_SECRETS_KEY: KEY_TWO,
    PAYMENT_SECRETS_KEY_VERSION: "2",
    PAYMENT_SECRETS_KEYS: `1:${KEY_ONE},2:${KEY_TWO}`,
  });
  const rows = [
    { organization_id: "org-a", key_version: 1 },
    { organization_id: "org-b", key_version: 2 },
    { organization_id: "org-c", key_version: 1 },
  ];
  const plan = planRotation(rows, keyring);
  assert.equal(plan.ok, true);
  assert.equal(plan.toRotate.length, 2);
  assert.deepEqual(plan.alreadyCurrent, ["org-b"]);
  assert.match(describeRotationPlan(plan), /2 record\(s\) will be re-encrypted to key version 2/);

  // A row encrypted under a key that is no longer held must stop the whole run.
  const withMissing = planRotation(
    [...rows, { organization_id: "org-d", key_version: 9 }],
    keyring,
  );
  assert.equal(withMissing.ok, false);
  assert.deepEqual(withMissing.missingVersions, [9]);
  assert.match(describeRotationPlan(withMissing), /Cannot start[\s\S]*PAYMENT_SECRETS_KEYS/);

  // Nothing to do says so, rather than reporting a successful rotation of zero.
  const done = planRotation([{ organization_id: "org-b", key_version: 2 }], keyring);
  assert.match(describeRotationPlan(done), /already encrypted with the active key/);
  assert.match(describeRotationPlan(done, "he"), /במפתח הפעיל/);
});

test("a row with no key_version at all is treated as version 1, which is what the column default says", () => {
  const keyring = parseKeyring({
    PAYMENT_SECRETS_KEY: KEY_TWO,
    PAYMENT_SECRETS_KEY_VERSION: "2",
    PAYMENT_SECRETS_KEYS: `1:${KEY_ONE},2:${KEY_TWO}`,
  });
  const plan = planRotation([{ organization_id: "org-a" }], keyring);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.toRotate, [{ id: "org-a", keyVersion: 1 }]);
});

test("an empty secret is refused rather than stored as an empty envelope", () => {
  const keyring = parseKeyring({ PAYMENT_SECRETS_KEY: KEY_ONE });
  assert.throws(() => encryptWithKeyring("", keyring), /empty payment secret/);
  assert.throws(() => encryptWithKeyring("x", parseKeyring({})), /No active payment secrets key/);
  assert.throws(
    () => decryptWithKeyring("not-an-envelope", 1, keyring),
    /Unsupported encrypted payment secret/,
  );
});

// ---------------------------------------------------------------------------
// Structural
// ---------------------------------------------------------------------------
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

test("a rotation is runnable, gated and recorded", () => {
  const actions = strip(readFileSync(join(root, "app/(app)/admin/actions.ts"), "utf8"));
  assert.ok(actions.includes("rotatePaymentSecretsKey"), "there must be a way to run it");
  assert.ok(actions.includes("planRotation"), "and it must plan before it moves anything");
  assert.ok(actions.includes("secret_key_rotations"), "and leave a record");
  assert.ok(
    actions.includes("super_admin"),
    "rotating an encryption key is not an ordinary operation",
  );
  assert.ok(
    actions.includes("key_version: next.keyVersion"),
    "the payload and its version must be written together",
  );
});

test("the new variables are placeholders in .env.example and validated at boot", () => {
  const example = readFileSync(join(root, ".env.example"), "utf8");
  for (const name of ["PAYMENT_SECRETS_KEY_VERSION", "PAYMENT_SECRETS_KEYS"]) {
    assert.match(example, new RegExp(`^${name}=\\s*$`, "m"), `${name} must ship EMPTY`);
  }
  const envCheck = readFileSync(join(root, "lib/core/env-check.mjs"), "utf8");
  assert.ok(
    envCheck.includes("PAYMENT_SECRETS_KEYS"),
    "a malformed retired key must be reported at boot, not mid-rotation",
  );
});

test("the remaining gap is written down, not implied away", () => {
  const source = readFileSync(join(root, "lib/core/secret-keyring.mjs"), "utf8");
  assert.match(source, /lib\/payments\/crypto\.ts still reads PAYMENT_SECRETS_KEY alone/);
  assert.match(source, /PARTIAL/);
});
