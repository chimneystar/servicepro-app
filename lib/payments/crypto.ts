import crypto from "crypto";

const VERSION = "v1";

function paymentKey(): Buffer {
  const raw = process.env.PAYMENT_SECRETS_KEY?.trim();
  if (!raw) throw new Error("PAYMENT_SECRETS_KEY is not configured");
  const key = raw.startsWith("hex:")
    ? Buffer.from(raw.slice(4), "hex")
    : Buffer.from(raw.replace(/^base64:/, ""), "base64");
  if (key.length !== 32) throw new Error("PAYMENT_SECRETS_KEY must decode to exactly 32 bytes");
  return key;
}
export function encryptPaymentSecret(value: string): string {
  if (!value) throw new Error("Cannot encrypt an empty payment secret");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", paymentKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptPaymentSecret(payload: string): string {
  const [version, ivValue, tagValue, encryptedValue] = payload.split(":");
  if (version !== VERSION || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Unsupported encrypted payment secret");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    paymentKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
