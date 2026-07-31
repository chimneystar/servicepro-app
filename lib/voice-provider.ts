import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

export function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
  authToken: string,
) {
  if (!signature || !authToken) return false;
  const payload = Object.keys(params)
    .sort()
    .reduce((result, key) => `${result}${key}${params[key]}`, url);
  const expected = createHmac("sha1", authToken).update(payload, "utf8").digest("base64");
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(signature);
  return (
    expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
  );
}

export function webhookUrl(requestUrl: string) {
  const incoming = new URL(requestUrl);
  const configured = process.env.TWILIO_WEBHOOK_BASE_URL?.replace(/\/$/, "");
  return configured ? `${configured}${incoming.pathname}${incoming.search}` : incoming.toString();
}

export function formRecord(form: FormData) {
  const record: Record<string, string> = {};
  form.forEach((value, key) => {
    record[key] = String(value);
  });
  return record;
}
