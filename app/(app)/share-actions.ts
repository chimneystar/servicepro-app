"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { providers, sendEmail, sendSms } from "@/lib/providers";

export type SendResult = { ok: boolean; configured: boolean; error?: string };

/**
 * Send a document to the client automatically IF a provider is connected.
 * When not configured, returns { configured:false } so the UI falls back to
 * opening the user's own email / Messages app (which always works).
 */
export async function autoSendDocument(token: string, channel: "email" | "text", to: string, origin: string): Promise<SendResult> {
  const profile = await requireProfile();
  if (channel === "email" && !providers.email()) return { ok: false, configured: false };
  if (channel === "text" && !providers.sms()) return { ok: false, configured: false };

  const supabase = await createClient();
  const { data } = await supabase.rpc("public_document", { p_token: token });
  const doc: any = data;
  if (!doc) return { ok: false, configured: true, error: "Document not found" };

  const label = doc.kind === "invoice" ? "invoice" : "estimate";
  const link = `${origin}/p/${token}`;
  const orgName = doc.org?.name ?? "";
  const who = (doc.customer?.name ?? "there").split(" ")[0];

  try {
    if (channel === "email") {
      const subject = `${orgName} — ${label} #${doc.number}`;
      const html = `<p>Hi ${who},</p><p>Please review your ${label} #${doc.number} from ${orgName}:</p><p><a href="${link}">${link}</a></p><p>You can approve and sign it online. Thank you!</p>`;
      const id = await sendEmail(to, subject, html);
      await supabase.from("email_messages").insert({
        organization_id: profile.organization_id, related_type: label, related_id: null,
        to_email: to, subject, provider: "resend", provider_message_id: id, status: "sent", sent_at: new Date().toISOString(),
      });
    } else {
      const body = `${orgName}: your ${label} #${doc.number} — ${link}`;
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
