import crypto from "crypto";

function key(): Buffer {
  const configured = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!configured) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
  const decoded = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (decoded.length !== 32) throw new Error("INTEGRATION_ENCRYPTION_KEY must decode to 32 bytes");
  return decoded;
}

export function encryptJson(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptJson<T>(encoded: string): T {
  const [version, ivText, tagText, payloadText] = encoded.split(".");
  if (version !== "v1" || !ivText || !tagText || !payloadText) throw new Error("Invalid encrypted credential payload");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(payloadText, "base64url")), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

export function signState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyState<T>(state: string): T {
  const [body, signature] = state.split(".");
  if (!body || !signature) throw new Error("Invalid OAuth state");
  const expected = crypto.createHmac("sha256", key()).update(body).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) throw new Error("Invalid OAuth state signature");
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
  if (parsed.exp && parsed.exp < Date.now()) throw new Error("OAuth state expired");
  return parsed;
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
