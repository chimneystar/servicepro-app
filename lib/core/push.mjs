// =====================================================================
//  push.mjs — Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID), pure.
//
//  THE DEFECT THIS FIXES: `device_subscriptions` collected VAPID
//  subscriptions from technicians and `public/sw.js` handled the `push`
//  event — and NOTHING in the codebase ever sent one. A technician tapped
//  "Notifications", the browser said yes, and no notification could ever
//  arrive, because no sender existed.
//
//  Everything here is deterministic given its inputs (the ephemeral key and
//  salt are injectable) so the crypto is provable in tests: encrypt here,
//  decrypt with the subscriber's private key, and the plaintext must come
//  back — and must NOT come back under a wrong auth secret.
//
//  No new npm dependency: node:crypto does ECDH P-256, HKDF-SHA256,
//  AES-128-GCM and ES256 already.
//
//  Tests: tests/push.test.mjs
// =====================================================================

import {
  createECDH,
  createHmac,
  createCipheriv,
  createPrivateKey,
  randomBytes,
  sign as signWith,
  timingSafeEqual,
} from "node:crypto";

const CURVE = "prime256v1";
const RECORD_SIZE = 4096;

export const toB64Url = (buf) => Buffer.from(buf).toString("base64url");
export const fromB64Url = (value) => Buffer.from(String(value ?? ""), "base64url");

const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

/** HKDF-SHA256 with a single-block expand — every web-push output is <= 32 bytes. */
function hkdf(salt, ikm, info, length) {
  const prk = hmac(salt, ikm);
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

/** Derive the uncompressed public point for a raw 32-byte P-256 scalar. */
export function publicKeyFromPrivate(privateKeyBytes) {
  const ecdh = createECDH(CURVE);
  // Same reason as checkVapidKeys: a scalar whose high byte is zero encodes to
  // fewer than 32 bytes and setPrivateKey rejects it. See normalizeScalar.
  const scalar = normalizeScalar(privateKeyBytes) ?? privateKeyBytes;
  ecdh.setPrivateKey(Buffer.from(scalar));
  return ecdh.getPublicKey();
}

/**
 * Validate a VAPID key pair.
 *
 * A mismatched pair is the classic silent web-push failure: the browser
 * accepts the subscription (it only sees the public key) and every send is
 * then refused with 401 by the push service, forever. Catching it up front
 * turns a permanent invisible outage into a startup warning.
 */
/**
 * A P-256 private key as the 32 bytes the curve expects.
 *
 * The scalar is a 256-bit INTEGER, and a big-endian integer has no obligation to
 * occupy its full width: when the high byte happens to be zero — about 1 pair in
 * 256, measured at 78 in 20,000 — a generator that emits the minimal encoding
 * produces 31 bytes. `d` in a JWK is base64url of that same integer and has the
 * same property.
 *
 * Requiring exactly 32 therefore rejected a VALID key pair roughly 0.4% of the
 * time, reporting a correctly configured business as `private_key_length` and
 * leaving push silently unavailable until somebody happened to regenerate.
 *
 * This was surfaced by tests/push.test.mjs failing about 1 run in 50 against
 * freshly generated keys. Padding the TEST would have made the suite green and
 * left the product broken; the length check was the thing that was wrong.
 */
function normalizeScalar(bytes) {
  if (bytes.length === 32) return bytes;
  if (bytes.length > 32 || bytes.length === 0) return null;
  const padded = new Uint8Array(32);
  padded.set(bytes, 32 - bytes.length); // left-pad: big-endian, high bytes are the zeros
  return padded;
}

export function checkVapidKeys(publicKey, privateKey) {
  const pub = fromB64Url(publicKey);
  const raw = fromB64Url(privateKey);
  const priv = normalizeScalar(raw);
  if (!priv) return { ok: false, reason: "private_key_length" };
  if (pub.length !== 65 || pub[0] !== 4) return { ok: false, reason: "public_key_format" };
  let derived;
  try {
    derived = publicKeyFromPrivate(priv);
  } catch {
    return { ok: false, reason: "private_key_invalid" };
  }
  if (derived.length !== pub.length || !timingSafeEqual(derived, pub))
    return { ok: false, reason: "key_pair_mismatch" };
  return { ok: true, reason: "ok" };
}

/**
 * Is push delivery configured? Returns a machine-readable reason when not, so
 * the caller can SAY the feature is unavailable instead of silently doing
 * nothing — which is exactly the defect being repaired.
 */
export function vapidStatus(env) {
  const publicKey = (env?.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (env?.VAPID_PRIVATE_KEY ?? "").trim();
  const subject = (env?.VAPID_SUBJECT ?? "").trim();
  if (!publicKey && !privateKey && !subject) return { available: false, reason: "not_configured" };
  if (!publicKey) return { available: false, reason: "missing_public_key" };
  if (!privateKey) return { available: false, reason: "missing_private_key" };
  if (!subject) return { available: false, reason: "missing_subject" };
  if (!/^(mailto:|https:\/\/)/.test(subject))
    return { available: false, reason: "invalid_subject" };
  const keys = checkVapidKeys(publicKey, privateKey);
  if (!keys.ok) return { available: false, reason: keys.reason };
  return { available: true, reason: "ok", publicKey, privateKey, subject };
}

/** Human sentence for a `vapidStatus` reason, in both shipped languages. */
export function pushUnavailableMessage(reason, locale = "en") {
  const en = {
    not_configured:
      "Push delivery is not configured — the business has no notification keys yet, so nothing can be delivered.",
    missing_public_key:
      "Push delivery is incomplete: NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing. Nothing will be delivered.",
    missing_private_key:
      "Push delivery is incomplete: VAPID_PRIVATE_KEY is missing. Nothing will be delivered.",
    missing_subject:
      "Push delivery is incomplete: VAPID_SUBJECT is missing. Nothing will be delivered.",
    invalid_subject:
      "Push delivery is misconfigured: VAPID_SUBJECT must be a mailto: or https: address.",
    private_key_length:
      "Push delivery is misconfigured: VAPID_PRIVATE_KEY must be a 32-byte base64url key.",
    public_key_format:
      "Push delivery is misconfigured: NEXT_PUBLIC_VAPID_PUBLIC_KEY must be a 65-byte uncompressed base64url key.",
    private_key_invalid:
      "Push delivery is misconfigured: VAPID_PRIVATE_KEY is not a valid P-256 key.",
    key_pair_mismatch:
      "Push delivery is misconfigured: the VAPID public and private keys are not a pair. Every send would be refused.",
    no_devices: "No device has enabled notifications for this person yet.",
  };
  const he = {
    not_configured:
      "משלוח ההתראות אינו מוגדר — לעסק אין עדיין מפתחות התראות, ולכן שום התראה לא תישלח.",
    missing_public_key:
      "הגדרת ההתראות חסרה: NEXT_PUBLIC_VAPID_PUBLIC_KEY לא הוגדר. שום התראה לא תישלח.",
    missing_private_key: "הגדרת ההתראות חסרה: VAPID_PRIVATE_KEY לא הוגדר. שום התראה לא תישלח.",
    missing_subject: "הגדרת ההתראות חסרה: VAPID_SUBJECT לא הוגדר. שום התראה לא תישלח.",
    invalid_subject: "הגדרת ההתראות שגויה: VAPID_SUBJECT חייב להיות כתובת mailto: או https:.",
    private_key_length:
      "הגדרת ההתראות שגויה: VAPID_PRIVATE_KEY חייב להיות מפתח base64url באורך 32 בתים.",
    public_key_format:
      "הגדרת ההתראות שגויה: NEXT_PUBLIC_VAPID_PUBLIC_KEY חייב להיות מפתח base64url באורך 65 בתים.",
    private_key_invalid: "הגדרת ההתראות שגויה: VAPID_PRIVATE_KEY אינו מפתח P-256 תקין.",
    key_pair_mismatch: "הגדרת ההתראות שגויה: המפתח הציבורי והפרטי אינם זוג. כל שליחה תידחה.",
    no_devices: "אף מכשיר עדיין לא הפעיל התראות עבור העובד הזה.",
  };
  const table = locale === "he" ? he : en;
  return (
    table[reason] ??
    (locale === "he" ? "משלוח ההתראות אינו זמין." : "Push delivery is unavailable.")
  );
}

/** The push service origin an assertion is addressed to (RFC 8292 `aud`). */
export function vapidAudience(endpoint) {
  const url = new URL(String(endpoint));
  if (url.protocol !== "https:") throw new Error("push endpoint must be https");
  return `${url.protocol}//${url.host}`;
}

function jwtSegment(value) {
  return toB64Url(Buffer.from(JSON.stringify(value), "utf8"));
}

function p256PrivateKeyObject(publicKey, privateKey) {
  const pub = fromB64Url(publicKey);
  const priv = fromB64Url(privateKey);
  return createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: toB64Url(priv),
      x: toB64Url(pub.subarray(1, 33)),
      y: toB64Url(pub.subarray(33, 65)),
    },
  });
}

/**
 * The `Authorization: vapid t=<jwt>, k=<public key>` header for one endpoint.
 * `now` is injectable so the expiry claim is testable.
 */
export function buildVapidAuthorization({
  endpoint,
  subject,
  publicKey,
  privateKey,
  now = Date.now(),
  ttlSeconds = 12 * 3600,
}) {
  const aud = vapidAudience(endpoint);
  const exp = Math.floor(now / 1000) + Math.min(ttlSeconds, 24 * 3600);
  const signingInput = `${jwtSegment({ typ: "JWT", alg: "ES256" })}.${jwtSegment({ aud, exp, sub: subject })}`;
  const signature = signWith("sha256", Buffer.from(signingInput, "utf8"), {
    key: p256PrivateKeyObject(publicKey, privateKey),
    dsaEncoding: "ieee-p1363",
  });
  const jwt = `${signingInput}.${toB64Url(signature)}`;
  return { authorization: `vapid t=${jwt}, k=${publicKey}`, jwt, aud, exp };
}

/**
 * Encrypt a push payload for one subscription (RFC 8291, aes128gcm).
 * `ephemeralPrivateKey` and `salt` are injectable purely so a test can assert
 * a byte-exact, decryptable body.
 */
export function encryptPushPayload({
  payload,
  p256dh,
  auth,
  ephemeralPrivateKey = null,
  salt = randomBytes(16),
}) {
  const uaPublic = fromB64Url(p256dh);
  const authSecret = fromB64Url(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("invalid_p256dh");
  if (authSecret.length !== 16) throw new Error("invalid_auth_secret");
  if (salt.length !== 16) throw new Error("invalid_salt");

  const ecdh = createECDH(CURVE);
  if (ephemeralPrivateKey) ecdh.setPrivateKey(Buffer.from(ephemeralPrivateKey));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublic);

  const prk = hmac(authSecret, sharedSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "utf8"), uaPublic, asPublic]);
  const ikm = hmac(prk, Buffer.concat([keyInfo, Buffer.from([1])]));

  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12);

  const plaintext = Buffer.from(String(payload), "utf8");
  if (plaintext.length + 17 + 86 > RECORD_SIZE) throw new Error("payload_too_large");
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), // 0x02 = last record
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(21);
  Buffer.from(salt).copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ciphertext]);
}

/**
 * What to do with a push service's answer.
 *
 * `gone` is the one that matters for data hygiene: 404/410 means the browser
 * threw the subscription away. Without acting on it the table accumulates dead
 * endpoints for ever and every future send burns a request on each of them.
 */
export function classifyPushResponse(status) {
  const code = Number(status);
  if (code >= 200 && code < 300) return "sent";
  if (code === 404 || code === 410) return "gone";
  if (code === 413) return "too_large";
  if (code === 429 || code >= 500) return "retry";
  if (code === 401 || code === 403) return "unauthorized";
  return "failed";
}

/** Only `sent` counts as delivered to the push service. */
export const isDelivered = (status) => classifyPushResponse(status) === "sent";
/** A subscription in this state must be removed, not retried for ever. */
export const shouldDropSubscription = (status) => classifyPushResponse(status) === "gone";

/** Bilingual "you have been assigned a job" notification. */
export function jobAssignedNotification({
  locale = "en",
  service,
  customerName,
  scheduledDate,
  startTime,
  jobId,
}) {
  const he = locale === "he";
  const when = [scheduledDate ?? "", (startTime ?? "").slice(0, 5)].filter(Boolean).join(" ");
  const who = (customerName ?? "").trim();
  const what = (service ?? "").trim() || (he ? "עבודה" : "Job");
  return {
    title: he ? "שובצת לעבודה חדשה" : "New job assigned to you",
    body: [what, who, when].filter(Boolean).join(" · ").slice(0, 300),
    url: jobId ? `/jobs/${jobId}` : "/tech",
  };
}
