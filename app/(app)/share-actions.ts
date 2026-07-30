"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { providers, sendEmail, sendSms } from "@/lib/providers";
import type { Locale } from "@/lib/i18n";

export type SendResult = { ok: boolean; configured: boolean; error?: string };

/**
 * Send a document to the client automatically IF a provider is connected.
 * When not configured, returns { configured:false } so the UI can explain
 * that automatic delivery must be connected. ServicePro never opens another app.
 */
export async function autoSendDocument(token: string, channel: "email" | "text", to: string, origin: string, locale: Locale): Promise<SendResult> {
  const profile = await requireProfile();
  if (channel === "email" && !providers.email()) return { ok: false, configured: false };
  if (channel === "text" && !providers.sms()) return { ok: false, configured: false };

  const supabase = await createClient();
  const { data } = await supabase.rpc("public_document", { p_token: token });
  const doc: any = data;
  if (!doc) return { ok: false, configured: true, error: "Document not found" };

  const he = locale === "he";
  const label = doc.kind === "invoice" ? (he ? "חשבונית" : "invoice") : (he ? "הצעת מחיר" : "estimate");
  const link = `${origin}/p/${token}`;
  const orgName = doc.org?.name ?? "";
  const who = (doc.customer?.name ?? "there").split(" ")[0];
  const safe = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));

  try {
    if (channel === "email") {
      const subject = he ? `${orgName} — ${label} מס׳ ${doc.number}` : `${orgName} — ${label} #${doc.number}`;
      const html = he
        ? `<div dir="rtl"><p>שלום ${safe(who)},</p><p>${safe(orgName)} שלחו לך ${safe(label)} מס׳ ${doc.number} לעיון ולאישור:</p><p><a href="${safe(link)}">פתיחת המסמך המאובטח</a></p><p>אפשר לאשר ולחתום ישירות בקישור. תודה!</p></div>`
        : `<p>Hi ${safe(who)},</p><p>Please review your ${safe(label)} #${doc.number} from ${safe(orgName)}:</p><p><a href="${safe(link)}">Open the secure document</a></p><p>You can approve and sign it online. Thank you!</p>`;
      const id = await sendEmail(to, subject, html);
      await supabase.from("email_messages").insert({
        organization_id: profile.organization_id, related_type: label, related_id: null,
        to_email: to, subject, provider: "resend", provider_message_id: id, status: "sent", sent_at: new Date().toISOString(),
      });
    } else {
      const body = he ? `${orgName}: ${label} מס׳ ${doc.number} לעיון ולאישור — ${link}` : `${orgName}: your ${label} #${doc.number} — ${link}`;
      const sid = await sendSms(to, body);
      await supabase.from("sms_messages").insert({
        organization_id: profile.organization_id, to_phone: to, body,
        provider: "twilio", provider_message_id: sid, status: "sent", sent_at: new Date().toISOString(),
      });
    }
    return { ok: true, configured: true };
  } catch (e: any) {
    return { ok: false, configured: true, error: String(e?.message ?? e).slice(0, 300) };
  }
}
