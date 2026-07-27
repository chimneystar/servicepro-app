import crypto from "crypto";
import { decryptJson, encryptJson, signState } from "./crypto";
import { recordCommunication, normalizeEmail } from "./communications";
import type { IntegrationConnection } from "./types";

type SupabaseLike = any;

export type GmailCredentials = { refreshToken: string; email: string };

function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured");
  return { clientId, clientSecret };
}

export function createGoogleAuthorization(input: { organizationId: string; userId: string; redirectUri: string }) {
  const { clientId } = googleConfig();
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = signState({
    organizationId: input.organizationId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    verifier,
    exp: Date.now() + 10 * 60 * 1000,
  });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
    ].join(" "),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(input: { code: string; redirectUri: string; verifier: string }) {
  const { clientId, clientSecret } = googleConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.verifier,
    }),
    cache: "no-store",
  });
  const token = await response.json();
  if (!response.ok || !token.access_token || !token.refresh_token) {
    throw new Error(token.error_description || token.error || "Google did not return an offline refresh token");
  }
  return token as { access_token: string; refresh_token: string; expires_in: number };
}

export async function refreshGmailAccessToken(connection: IntegrationConnection) {
  if (!connection.encrypted_credentials) throw new Error("Gmail is not connected");
  const credentials = decryptJson<GmailCredentials>(connection.encrypted_credentials);
  const { clientId, clientSecret } = googleConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const token = await response.json();
  if (!response.ok || !token.access_token) throw new Error(token.error_description || token.error || "Could not refresh Gmail access");
  return { accessToken: token.access_token as string, credentials };
}

async function gmailJson(accessToken: string, path: string, init?: RequestInit) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Gmail API error ${response.status}`);
  return data;
}

export async function gmailProfile(accessToken: string) {
  return gmailJson(accessToken, "profile") as Promise<{ emailAddress: string; historyId: string }>;
}

export async function registerGmailWatch(connection: IntegrationConnection) {
  const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
  if (!topicName) throw new Error("GOOGLE_PUBSUB_TOPIC is not configured");
  const { accessToken } = await refreshGmailAccessToken(connection);
  return gmailJson(accessToken, "watch", {
    method: "POST",
    body: JSON.stringify({ topicName, labelIds: ["INBOX"], labelFilterBehavior: "include" }),
  }) as Promise<{ historyId: string; expiration: string }>;
}

function cleanHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function htmlToText(html: string) {
  return html.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
}

function mimeMessage(input: { fromName: string; fromEmail: string; to: string; subject: string; html: string; inReplyTo?: string | null }) {
  const boundary = `servicepro_${crypto.randomBytes(12).toString("hex")}`;
  const headers = [
    `From: ${cleanHeader(input.fromName)} <${cleanHeader(input.fromEmail)}>`,
    `To: ${cleanHeader(input.to)}`,
    `Subject: ${cleanHeader(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary=\"${boundary}\"`,
  ];
  if (input.inReplyTo) headers.push(`In-Reply-To: ${cleanHeader(input.inReplyTo)}`, `References: ${cleanHeader(input.inReplyTo)}`);
  const text = Buffer.from(htmlToText(input.html), "utf8").toString("base64");
  const html = Buffer.from(input.html, "utf8").toString("base64");
  return [
    ...headers,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    text,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    html,
    `--${boundary}--`,
  ].join("\r\n");
}

export async function sendGmail(input: {
  client: SupabaseLike;
  connection: IntegrationConnection;
  organizationId: string;
  organizationName: string;
  to: string;
  subject: string;
  html: string;
  customerId?: string | null;
  threadId?: string | null;
  inReplyTo?: string | null;
  businessEventKey?: string | null;
}) {
  const { accessToken, credentials } = await refreshGmailAccessToken(input.connection);
  const raw = Buffer.from(mimeMessage({
    fromName: input.organizationName,
    fromEmail: credentials.email,
    to: input.to,
    subject: input.subject,
    html: input.html,
    inReplyTo: input.inReplyTo,
  }), "utf8").toString("base64url");
  const sent = await gmailJson(accessToken, "messages/send", {
    method: "POST",
    body: JSON.stringify({ raw, threadId: input.threadId || undefined }),
  }) as { id: string; threadId: string };
  await recordCommunication(input.client, {
    organizationId: input.organizationId,
    customerId: input.customerId,
    channel: "email",
    direction: "outbound",
    status: "sent",
    contactKey: input.to,
    fromAddress: credentials.email,
    toAddress: input.to,
    subject: input.subject,
    body: htmlToText(input.html),
    provider: "gmail",
    providerMessageId: sent.id,
    providerThreadId: sent.threadId,
    businessEventKey: input.businessEventKey,
  });
  return sent;
}

function decodeGmailBody(data?: string) {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

function bodyFromPayload(payload: any): string {
  if (payload?.mimeType === "text/plain" && payload?.body?.data) return decodeGmailBody(payload.body.data);
  for (const part of payload?.parts ?? []) {
    const body = bodyFromPayload(part);
    if (body) return part.mimeType === "text/html" ? htmlToText(body) : body;
  }
  return decodeGmailBody(payload?.body?.data);
}

function attachmentsFromPayload(payload: any, output: Array<{ id: string; filename: string; contentType: string; size: number }> = []) {
  if (payload?.filename && payload?.body?.attachmentId) {
    output.push({ id: payload.body.attachmentId, filename: payload.filename, contentType: payload.mimeType || "application/octet-stream", size: Number(payload.body.size || 0) });
  }
  for (const part of payload?.parts ?? []) attachmentsFromPayload(part, output);
  return output;
}

function header(payload: any, name: string) {
  return String((payload?.headers ?? []).find((item: any) => String(item.name).toLowerCase() === name.toLowerCase())?.value ?? "");
}

function emailAddress(value: string) {
  return normalizeEmail(value.match(/<([^>]+)>/)?.[1] ?? value.split(",")[0]);
}

export async function syncGmailHistory(client: SupabaseLike, connection: IntegrationConnection, notificationHistoryId: string) {
  const { accessToken, credentials } = await refreshGmailAccessToken(connection);
  const metadata = { ...(connection.metadata ?? {}) } as Record<string, any>;
  const startHistoryId = String(metadata.history_id ?? "");
  if (!startHistoryId) {
    await client.from("integration_connections").update({ metadata: { ...metadata, history_id: notificationHistoryId }, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", connection.id);
    return 0;
  }

  const history = await gmailJson(accessToken, `history?startHistoryId=${encodeURIComponent(startHistoryId)}&historyTypes=messageAdded&labelId=INBOX`);
  const ids = new Set<string>();
  for (const item of history.history ?? []) for (const added of item.messagesAdded ?? []) if (added?.message?.id) ids.add(added.message.id);
  let imported = 0;
  for (const id of ids) {
    const message = await gmailJson(accessToken, `messages/${encodeURIComponent(id)}?format=full`);
    if (!(message.labelIds ?? []).includes("INBOX")) continue;
    const from = emailAddress(header(message.payload, "From"));
    if (!from || from === normalizeEmail(credentials.email)) continue;
    const { data: customer } = await client.from("customers").select("id").eq("organization_id", connection.organization_id).ilike("email", from).is("deleted_at", null).maybeSingle();
    const recorded = await recordCommunication(client, {
      organizationId: connection.organization_id,
      customerId: customer?.id ?? null,
      channel: "email",
      direction: "inbound",
      status: "received",
      contactKey: from,
      fromAddress: from,
      toAddress: emailAddress(header(message.payload, "To")),
      subject: header(message.payload, "Subject") || "(no subject)",
      body: bodyFromPayload(message.payload),
      provider: "gmail",
      providerMessageId: message.id,
      providerThreadId: message.threadId,
      occurredAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : undefined,
      metadata: { rfc_message_id: header(message.payload, "Message-ID") },
    });
    if (recorded?.id) {
      const attachments = attachmentsFromPayload(message.payload);
      if (attachments.length) await client.from("communication_attachments").insert(attachments.map((item) => ({
        organization_id: connection.organization_id,
        communication_id: recorded.id,
        provider_attachment_id: item.id,
        filename: item.filename,
        content_type: item.contentType,
        size_bytes: item.size,
      })));
      imported += 1;
    }
  }
  await client.from("integration_connections").update({
    metadata: { ...metadata, history_id: String(history.historyId ?? notificationHistoryId) },
    last_synced_at: new Date().toISOString(),
    error_message: null,
    updated_at: new Date().toISOString(),
  }).eq("id", connection.id);
  return imported;
}

export function gmailCredentialPayload(refreshToken: string, email: string) {
  return encryptJson({ refreshToken, email: normalizeEmail(email) } satisfies GmailCredentials);
}
