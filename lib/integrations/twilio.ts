import crypto from "crypto";
import { integrationAppUrl } from "./url";
import { decryptJson, encryptJson } from "./crypto";
import { normalizePhone, recordCommunication } from "./communications";
import type { IntegrationConnection } from "./types";

type SupabaseLike = any;
type TwilioCredentials = { accountSid: string; authToken: string };

function basic(sid: string, token: string) {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
}

async function twilioRequest(input: { url: string; sid: string; token: string; form?: Record<string, string>; method?: string }) {
  const response = await fetch(input.url, {
    method: input.method ?? (input.form ? "POST" : "GET"),
    headers: { Authorization: basic(input.sid, input.token), ...(input.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: input.form ? new URLSearchParams(input.form).toString() : undefined,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Twilio API error ${response.status}`);
  return data;
}

function parentCredentials() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("Twilio is not configured");
  return { sid, token };
}

export async function provisionTwilioOrganization(input: { organizationId: string; businessName: string; areaCode: string }) {
  const parent = parentCredentials();
  if (!/^\d{3}$/.test(input.areaCode)) throw new Error("Enter a valid three-digit US area code");
  const account = await twilioRequest({
    url: "https://api.twilio.com/2010-04-01/Accounts.json",
    sid: parent.sid,
    token: parent.token,
    form: { FriendlyName: `${input.businessName} — ServicePro` },
  });
  const credentials: TwilioCredentials = { accountSid: account.sid, authToken: account.auth_token };
  try {
    const service = await twilioRequest({
      url: "https://messaging.twilio.com/v1/Services",
      sid: credentials.accountSid,
      token: credentials.authToken,
      form: {
        FriendlyName: `${input.businessName} messaging`,
        InboundRequestUrl: `${integrationAppUrl()}/api/twilio/inbound`,
        StatusCallback: `${integrationAppUrl()}/api/twilio/status`,
      },
    });
    const available = await twilioRequest({
      url: `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/AvailablePhoneNumbers/US/Local.json?AreaCode=${input.areaCode}&SmsEnabled=true&PageSize=1`,
      sid: credentials.accountSid,
      token: credentials.authToken,
    });
    const candidate = available.available_phone_numbers?.[0]?.phone_number;
    if (!candidate) throw new Error(`No SMS number is currently available in area code ${input.areaCode}`);
    const number = await twilioRequest({
      url: `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/IncomingPhoneNumbers.json`,
      sid: credentials.accountSid,
      token: credentials.authToken,
      form: { PhoneNumber: candidate, SmsUrl: `${integrationAppUrl()}/api/twilio/inbound`, SmsMethod: "POST" },
    });
    await twilioRequest({
      url: `https://messaging.twilio.com/v1/Services/${service.sid}/PhoneNumbers`,
      sid: credentials.accountSid,
      token: credentials.authToken,
      form: { PhoneNumberSid: number.sid },
    });
    return {
      externalAccountId: credentials.accountSid,
      encryptedCredentials: encryptJson(credentials),
      metadata: {
        phone_number: number.phone_number,
        phone_number_sid: number.sid,
        messaging_service_sid: service.sid,
        area_code: input.areaCode,
        a2p_status: "registration_required",
        monthly_message_cap: 200,
        messages_sent_this_month: 0,
      },
    };
  } catch (error) {
    await twilioRequest({
      url: `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}.json`,
      sid: parent.sid,
      token: parent.token,
      form: { Status: "closed" },
    }).catch(() => undefined);
    throw error;
  }
}

export function twilioCredentials(connection: IntegrationConnection) {
  if (!connection.encrypted_credentials) throw new Error("Text messaging is not connected");
  return decryptJson<TwilioCredentials>(connection.encrypted_credentials);
}

export async function sendTwilioSms(input: {
  client: SupabaseLike;
  connection: IntegrationConnection;
  to: string;
  body: string;
  customerId?: string | null;
  businessEventKey?: string | null;
}) {
  const credentials = twilioCredentials(input.connection);
  const metadata = input.connection.metadata as Record<string, any>;
  const cap = Number(metadata.monthly_message_cap ?? 200);
  const used = Number(metadata.messages_sent_this_month ?? 0);
  if (used >= cap) throw new Error(`Monthly pilot text limit of ${cap} reached`);
  const messagingServiceSid = String(metadata.messaging_service_sid ?? "");
  if (!messagingServiceSid) throw new Error("Twilio Messaging Service is missing");
  const to = normalizePhone(input.to);
  const sent = await twilioRequest({
    url: `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Messages.json`,
    sid: credentials.accountSid,
    token: credentials.authToken,
    form: {
      To: to,
      MessagingServiceSid: messagingServiceSid,
      Body: input.body,
      StatusCallback: `${integrationAppUrl()}/api/twilio/status`,
    },
  });
  await recordCommunication(input.client, {
    organizationId: input.connection.organization_id,
    customerId: input.customerId,
    channel: "sms",
    direction: "outbound",
    status: sent.status === "queued" ? "queued" : "sent",
    contactKey: to,
    fromAddress: String(metadata.phone_number ?? ""),
    toAddress: to,
    body: input.body,
    provider: "twilio",
    providerMessageId: sent.sid,
    businessEventKey: input.businessEventKey,
  });
  await input.client.from("integration_connections").update({
    metadata: { ...metadata, messages_sent_this_month: used + 1 },
    updated_at: new Date().toISOString(),
  }).eq("id", input.connection.id);
  return sent.sid as string;
}

export function verifyTwilioSignature(input: { authToken: string; signature: string | null; url: string; params: URLSearchParams }) {
  if (!input.signature) return false;
  let data = input.url;
  const keys = Array.from(new Set(Array.from(input.params.keys()))).sort();
  for (const key of keys) for (const value of input.params.getAll(key).sort()) data += key + value;
  const expected = crypto.createHmac("sha1", input.authToken).update(data).digest("base64");
  const left = Buffer.from(expected);
  const right = Buffer.from(input.signature);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
