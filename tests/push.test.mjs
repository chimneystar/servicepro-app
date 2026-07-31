import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createECDH,
  createDecipheriv,
  createHmac,
  randomBytes,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import {
  vapidStatus,
  pushUnavailableMessage,
  checkVapidKeys,
  publicKeyFromPrivate,
  buildVapidAuthorization,
  vapidAudience,
  encryptPushPayload,
  classifyPushResponse,
  isDelivered,
  shouldDropSubscription,
  jobAssignedNotification,
  toB64Url,
  fromB64Url,
} from "../lib/core/push.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// The defect: subscriptions were stored, `public/sw.js` handled `push`, and no
// sender existed anywhere. These prove the sender's crypto is real — a sender
// that produces a body no browser can decrypt is the same silence with extra
// steps.
// ---------------------------------------------------------------------------

/** Stand in for a browser: generate a subscription, then decrypt what we send. */
function fakeSubscriber() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const authSecret = randomBytes(16);
  return {
    p256dh: toB64Url(ecdh.getPublicKey()),
    auth: toB64Url(authSecret),
    /** RFC 8291 receiver side. Throws if the ciphertext does not authenticate. */
    decrypt(body) {
      const salt = body.subarray(0, 16);
      const keyLength = body.readUInt8(20);
      const asPublic = body.subarray(21, 21 + keyLength);
      const ciphertext = body.subarray(21 + keyLength);
      const shared = ecdh.computeSecret(asPublic);
      const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
      const prk = hmac(authSecret, shared);
      const keyInfo = Buffer.concat([
        Buffer.from("WebPush: info\0", "utf8"),
        ecdh.getPublicKey(),
        asPublic,
      ]);
      const ikm = hmac(prk, Buffer.concat([keyInfo, Buffer.from([1])]));
      const expand = (info, length) =>
        hmac(
          hmac(salt, ikm),
          Buffer.concat([Buffer.from(info, "utf8"), Buffer.from([1])]),
        ).subarray(0, length);
      const cek = expand("Content-Encoding: aes128gcm\0", 16);
      const nonce = expand("Content-Encoding: nonce\0", 12);
      const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
      decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
      const plain = Buffer.concat([
        decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
        decipher.final(),
      ]);
      return plain.subarray(0, plain.length - 1).toString("utf8"); // strip the 0x02 delimiter
    },
  };
}

test("an encrypted push payload is decryptable by the subscriber it was sealed for", () => {
  const subscriber = fakeSubscriber();
  const message = JSON.stringify({
    title: "New job assigned to you",
    body: "Boiler service · Dana Levi · 2026-08-03 09:00",
    url: "/jobs/abc",
  });
  const body = encryptPushPayload({
    payload: message,
    p256dh: subscriber.p256dh,
    auth: subscriber.auth,
  });
  assert.equal(subscriber.decrypt(body), message);
});

test("the push body carries the aes128gcm header the push service requires", () => {
  const subscriber = fakeSubscriber();
  const salt = randomBytes(16);
  const body = encryptPushPayload({
    payload: "{}",
    p256dh: subscriber.p256dh,
    auth: subscriber.auth,
    salt,
  });
  assert.deepEqual(body.subarray(0, 16), salt, "the record salt must be the first 16 bytes");
  assert.equal(body.readUInt32BE(16), 4096, "record size");
  assert.equal(body.readUInt8(20), 65, "an uncompressed P-256 point is 65 bytes");
  assert.equal(body.readUInt8(21), 4, "and starts with the uncompressed marker");
});

test("a payload sealed for one subscriber CANNOT be opened by another", () => {
  // The other direction: if this passed, the encryption would be decorative.
  const intended = fakeSubscriber();
  const other = fakeSubscriber();
  const body = encryptPushPayload({
    payload: "secret job details",
    p256dh: intended.p256dh,
    auth: intended.auth,
  });
  assert.throws(() => other.decrypt(body));
});

test("a wrong auth secret fails authentication rather than yielding plaintext", () => {
  const subscriber = fakeSubscriber();
  const body = encryptPushPayload({
    payload: "secret",
    p256dh: subscriber.p256dh,
    auth: toB64Url(randomBytes(16)),
  });
  assert.throws(() => subscriber.decrypt(body));
});

test("malformed subscription keys are refused, not silently sent to", () => {
  const subscriber = fakeSubscriber();
  assert.throws(
    () => encryptPushPayload({ payload: "x", p256dh: "not-a-key", auth: subscriber.auth }),
    /invalid_p256dh/,
  );
  assert.throws(
    () =>
      encryptPushPayload({
        payload: "x",
        p256dh: subscriber.p256dh,
        auth: toB64Url(randomBytes(8)),
      }),
    /invalid_auth_secret/,
  );
  assert.throws(
    () =>
      encryptPushPayload({
        payload: "x".repeat(5000),
        p256dh: subscriber.p256dh,
        auth: subscriber.auth,
      }),
    /payload_too_large/,
  );
});

// ---------------------------------------------------------------------------
// VAPID: the assertion is verified with the public key, exactly as the push
// service will verify it.
// ---------------------------------------------------------------------------

function vapidPair() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: toB64Url(ecdh.getPublicKey()), privateKey: toB64Url(ecdh.getPrivateKey()) };
}

test("the VAPID assertion verifies against the advertised public key", () => {
  const { publicKey, privateKey } = vapidPair();
  const { authorization, jwt, aud, exp } = buildVapidAuthorization({
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    subject: "mailto:ops@example.com",
    publicKey,
    privateKey,
    now: 1_800_000_000_000,
  });
  assert.match(authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.equal(aud, "https://fcm.googleapis.com");
  assert.equal(exp, 1_800_000_000 + 12 * 3600);

  const [header, payload, signature] = jwt.split(".");
  assert.deepEqual(JSON.parse(fromB64Url(header).toString()), { typ: "JWT", alg: "ES256" });
  assert.equal(JSON.parse(fromB64Url(payload).toString()).sub, "mailto:ops@example.com");

  const raw = fromB64Url(publicKey);
  const key = createPublicKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      x: toB64Url(raw.subarray(1, 33)),
      y: toB64Url(raw.subarray(33, 65)),
    },
  });
  assert.equal(
    verifySignature(
      "sha256",
      Buffer.from(`${header}.${payload}`, "utf8"),
      { key, dsaEncoding: "ieee-p1363" },
      fromB64Url(signature),
    ),
    true,
  );
});

test("a VAPID assertion signed by the WRONG key does not verify", () => {
  const mine = vapidPair();
  const theirs = vapidPair();
  const { jwt } = buildVapidAuthorization({
    endpoint: "https://push.example.com/x",
    subject: "mailto:a@b.c",
    publicKey: mine.publicKey,
    privateKey: mine.privateKey,
  });
  const [header, payload, signature] = jwt.split(".");
  const raw = fromB64Url(theirs.publicKey);
  const key = createPublicKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      x: toB64Url(raw.subarray(1, 33)),
      y: toB64Url(raw.subarray(33, 65)),
    },
  });
  assert.equal(
    verifySignature(
      "sha256",
      Buffer.from(`${header}.${payload}`, "utf8"),
      { key, dsaEncoding: "ieee-p1363" },
      fromB64Url(signature),
    ),
    false,
  );
});

test("the audience is the push service origin, and plaintext endpoints are refused", () => {
  assert.equal(
    vapidAudience("https://updates.push.services.mozilla.com/wpush/v2/abc"),
    "https://updates.push.services.mozilla.com",
  );
  assert.throws(() => vapidAudience("http://insecure.example.com/x"), /https/);
});

test("a mismatched VAPID key pair is caught instead of failing on every send for ever", () => {
  const a = vapidPair(),
    b = vapidPair();
  assert.equal(checkVapidKeys(a.publicKey, a.privateKey).ok, true);
  assert.equal(checkVapidKeys(b.publicKey, a.privateKey).reason, "key_pair_mismatch");
  assert.equal(checkVapidKeys(a.publicKey, toB64Url(randomBytes(16))).reason, "private_key_length");
  assert.equal(checkVapidKeys(toB64Url(randomBytes(65)), a.privateKey).reason, "public_key_format");
  assert.deepEqual(publicKeyFromPrivate(fromB64Url(a.privateKey)), fromB64Url(a.publicKey));
});

// ---------------------------------------------------------------------------
// Degrade LOUDLY. Silently doing nothing is the defect being repaired.
// ---------------------------------------------------------------------------

test("push reports itself UNAVAILABLE with a reason when keys are absent or broken", () => {
  const { publicKey, privateKey } = vapidPair();
  assert.deepEqual(vapidStatus({}), { available: false, reason: "not_configured" });
  assert.equal(vapidStatus({ VAPID_PRIVATE_KEY: privateKey }).reason, "missing_public_key");
  assert.equal(
    vapidStatus({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: publicKey }).reason,
    "missing_private_key",
  );
  assert.equal(
    vapidStatus({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey }).reason,
    "missing_subject",
  );
  assert.equal(
    vapidStatus({
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: publicKey,
      VAPID_PRIVATE_KEY: privateKey,
      VAPID_SUBJECT: "ops@example.com",
    }).reason,
    "invalid_subject",
  );
  assert.equal(
    vapidStatus({
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapidPair().publicKey,
      VAPID_PRIVATE_KEY: privateKey,
      VAPID_SUBJECT: "mailto:a@b.c",
    }).reason,
    "key_pair_mismatch",
  );
  // Every refusal must produce a sentence in both languages — an unexplained
  // "unavailable" is barely better than the silence it replaces.
  for (const reason of [
    "not_configured",
    "missing_public_key",
    "missing_private_key",
    "missing_subject",
    "invalid_subject",
    "key_pair_mismatch",
    "no_devices",
  ]) {
    assert.ok(pushUnavailableMessage(reason, "en").length > 20, reason);
    assert.ok(pushUnavailableMessage(reason, "he").length > 20, reason);
    assert.notEqual(pushUnavailableMessage(reason, "he"), pushUnavailableMessage(reason, "en"));
  }
});

test("push reports itself AVAILABLE on a correct configuration", () => {
  const { publicKey, privateKey } = vapidPair();
  const status = vapidStatus({
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: privateKey,
    VAPID_SUBJECT: "mailto:ops@example.com",
  });
  assert.equal(status.available, true);
  assert.equal(status.reason, "ok");
  assert.equal(status.subject, "mailto:ops@example.com");
});

// ---------------------------------------------------------------------------
// Dead endpoints must be removed, or the table grows for ever.
// ---------------------------------------------------------------------------

test("a discarded subscription (404/410) is dropped, and a working one is NOT", () => {
  assert.equal(shouldDropSubscription(404), true);
  assert.equal(shouldDropSubscription(410), true);
  for (const status of [200, 201, 202, 429, 500, 503, 413, 401]) {
    assert.equal(shouldDropSubscription(status), false, `${status} must not delete a subscription`);
  }
});

test("push responses are classified so a transient failure is not treated as delivery", () => {
  assert.equal(classifyPushResponse(201), "sent");
  assert.equal(isDelivered(201), true);
  assert.equal(isDelivered(429), false);
  assert.equal(isDelivered(500), false);
  assert.equal(classifyPushResponse(429), "retry");
  assert.equal(classifyPushResponse(503), "retry");
  assert.equal(classifyPushResponse(413), "too_large");
  assert.equal(classifyPushResponse(401), "unauthorized");
  assert.equal(classifyPushResponse(400), "failed");
});

test("the assignment notification says what, for whom and when, in the device's language", () => {
  const en = jobAssignedNotification({
    locale: "en",
    service: "Boiler service",
    customerName: "Dana Levi",
    scheduledDate: "2026-08-03",
    startTime: "09:00:00",
    jobId: "job-1",
  });
  assert.equal(en.title, "New job assigned to you");
  assert.equal(en.body, "Boiler service · Dana Levi · 2026-08-03 09:00");
  assert.equal(en.url, "/jobs/job-1");
  const he = jobAssignedNotification({
    locale: "he",
    service: "טיפול בדוד",
    customerName: "דנה לוי",
    scheduledDate: "2026-08-03",
    startTime: "09:00:00",
    jobId: "job-1",
  });
  assert.notEqual(he.title, en.title);
  // Missing detail must not produce dangling separators or an empty notification.
  const bare = jobAssignedNotification({ locale: "en", jobId: null });
  assert.equal(bare.body, "Job");
  assert.equal(bare.url, "/tech");
});

// ---------------------------------------------------------------------------
// Structural: the sender is actually wired to a trigger, and the service
// worker can still receive what is sent. Comments are stripped first so a
// commented-out call cannot satisfy the check.
// ---------------------------------------------------------------------------

// Block comments and whole-line `//` comments go, so a commented-out call can
// never satisfy a structural check. Trailing comments are deliberately left:
// stripping every `//` would also destroy the URLs in the source.
const stripJsComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*$/gm, " ");
const withoutComments = (file) => stripJsComments(readFileSync(join(root, file), "utf8"));

test("a real trigger calls the sender — assigning a technician notifies them", () => {
  const dispatch = withoutComments("app/(app)/dispatch/actions.ts");
  assert.match(dispatch, /import\s*\{\s*notifyJobAssigned\s*\}\s*from\s*["']@\/lib\/push["']/);
  assert.match(dispatch, /notifyJobAssigned\(\{/);
  const schedule = withoutComments("app/(app)/schedule/actions.ts");
  assert.match(schedule, /notifyJobAssigned\(\{/);
});

test("the sender removes subscriptions the push service says are gone", () => {
  const sender = withoutComments("lib/push.ts");
  assert.match(sender, /classifyPushResponse/);
  // `\s*` before `.delete()`: ledger 6.4 broke the builder chain onto separate
  // lines. The table and the method are both still named, so deleting from a
  // different table, or not deleting at all, still fails.
  assert.match(sender, /device_subscriptions"\)\s*\.delete\(\)/);
  // And it must never quietly succeed when it cannot send.
  assert.match(sender, /status:\s*"unavailable"/);
});

test("the service worker still handles push, and re-subscribes when the browser rotates a subscription", () => {
  const sw = stripJsComments(readFileSync(join(root, "public", "sw.js"), "utf8"));
  assert.match(sw, /addEventListener\("push"/);
  assert.match(sw, /showNotification/);
  assert.match(sw, /addEventListener\("notificationclick"/);
  assert.match(sw, /addEventListener\("pushsubscriptionchange"/);
  assert.match(sw, /\/api\/devices\/push/);
});

test("VAPID secrets are placeholders in .env.example and never real values", () => {
  const example = readFileSync(join(root, ".env.example"), "utf8");
  for (const name of ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
    assert.match(
      example,
      new RegExp(`^${name}=\\s*$`, "m"),
      `${name} must be present and EMPTY in .env.example`,
    );
  }
});
