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
/** Minimal HTML entity escape for values interpolated into the email body. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Resolve the app's public origin from configuration, never from the caller.
 */
function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  return (configured ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * SECURITY: `origin` used to be supplied by the browser and interpolated straight
 * into the link inside an email sent from the business's own Resend/Twilio
 * identity — so any signed-in user could send branded phishing to any address.
 * The origin is now derived server-side, the document must belong to the
 * caller's organisation, and interpolated values are escaped.
 *
 * The `origin` parameter is kept for call-site compatibility and ignored.
 */
export async function autoSendDocument(token: string, channel: "email" | "text", to: string, _origin?: string): Promise<SendResult> {
  const profile = await requireProfile();
  if (channel === "email" && !providers.email()) return { ok: false, configured: false };
  if (channel === "text" && !providers.sms()) return { ok: false, configured: false };
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { ok: false, configured: true, error: "Invalid document" };

  const supabase = await createClient();

  // Prove the token belongs to THIS organisation before sending anything.
  // These reads go through the caller's RLS-bound client, so a token from
  // another tenant simply returns nothing. public_document is SECURITY DEFINER
  // and org-agnostic, so it cannot be used for this check.
  const [{ data: est }, { data: inv }] = await Promise.all([
    supabase.from("estimates").select("id").eq("public_token", token).is("deleted_at", null).maybeSingle(),
    supabase.from("invoices").select("id").eq("public_token", token).is("deleted_at", null).maybeSingle(),
  ]);
  if (!est && !inv) return { ok: false, configured: true, error: "Document not found" };

  const { data } = await supabase.rpc("public_document", { p_token: token });
  const doc: any = data;
  if (!doc) return { ok: false, configured: true, error: "Document not found" };

  const label = doc.kind === "invoice" ? "invoice" : "estimate";
  const link = `${appOrigin()}/p/${token}`;
  const orgName = doc.org?.name ?? "";
  const who = (doc.customer?.name ?? "there").split(" ")[0];

  try {
    if (channel === "email") {
      const subject = `${orgName} — ${label} #${doc.number}`;
      const html = `<p>Hi ${esc(who)},</p><p>Please review your ${label} #${esc(String(doc.number))} from ${esc(orgName)}:</p><p><a href="${esc(link)}">${esc(link)}</a></p><p>You can approve and sign it online. Thank you!</p>`;
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
