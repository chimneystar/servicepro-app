"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { providers, sendEmail, sendSms } from "@/lib/providers";
import { getConnection } from "@/lib/integrations/connections";
import { sendGmail } from "@/lib/integrations/gmail";
import { sendTwilioSms } from "@/lib/integrations/twilio";

export type SendResult = { ok: boolean; configured: boolean; error?: string };

/** Send an estimate or invoice through the organization's connected Gmail or
 * Twilio account. Legacy platform providers remain as a temporary fallback. */
export async function autoSendDocument(token: string, channel: "email" | "text", to: string, origin: string): Promise<SendResult> {
  const profile = await requireProfile();
  const client = createClient();
  const { data } = await client.rpc("public_document", { p_token: token });
  const doc: any = data;
  if (!doc) return { ok: false, configured: true, error: "Document not found" };
  const label = doc.kind === "invoice" ? "invoice" : "estimate";
  const link = `${origin}/p/${token}`;
  const organizationName = doc.org?.name ?? "Service business";
  const firstName = String(doc.customer?.name ?? "there").split(" ")[0];
  const customerId = doc.customer?.id ?? null;

  try {
    const provider = channel === "email" ? "gmail" : "twilio";
    const connection = await getConnection(client, profile.organization_id!, provider);
    if (channel === "email" && connection?.encrypted_credentials) {
      const subject = `${organizationName} — ${label} #${doc.number}`;
      const html = `<p>Hi ${escapeHtml(firstName)},</p><p>Please review your ${label} #${doc.number} from ${escapeHtml(organizationName)}:</p><p><a href="${escapeHtml(link)}">View ${label}</a></p><p>Thank you!</p>`;
      await sendGmail({ client, connection, organizationId: profile.organization_id!, organizationName, to, subject, html, customerId, businessEventKey: `${label}:${token}` });
      return { ok: true, configured: true };
    }
    if (channel === "text" && connection?.encrypted_credentials) {
      await sendTwilioSms({ client, connection, to, body: `${organizationName}: your ${label} #${doc.number} — ${link}`, customerId, businessEventKey: `${label}:${token}` });
      return { ok: true, configured: true };
    }
  } catch (error: any) {
    return { ok: false, configured: true, error: String(error?.message ?? error).slice(0, 300) };
  }

  try {
    if (channel === "email" && providers.email()) {
      const subject = `${organizationName} — ${label} #${doc.number}`;
      const html = `<p>Hi ${escapeHtml(firstName)},</p><p>Please review your ${label}: <a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`;
      const id = await sendEmail(to, subject, html);
      await client.from("email_messages").insert({ organization_id: profile.organization_id, related_type: label, related_id: null, to_email: to, subject, provider: "resend", provider_message_id: id, status: "sent", sent_at: new Date().toISOString() });
      return { ok: true, configured: true };
    }
    if (channel === "text" && providers.sms()) {
      const body = `${organizationName}: your ${label} #${doc.number} — ${link}`;
      const sid = await sendSms(to, body);
      await client.from("sms_messages").insert({ organization_id: profile.organization_id, to_phone: to, body, provider: "twilio", provider_message_id: sid, status: "sent", sent_at: new Date().toISOString() });
      return { ok: true, configured: true };
    }
    return { ok: false, configured: false };
  } catch (error: any) {
    return { ok: false, configured: true, error: String(error?.message ?? error).slice(0, 300) };
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char] ?? char));
}
