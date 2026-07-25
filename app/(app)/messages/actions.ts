"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { providers, sendSms } from "@/lib/providers";

export type SendResult = { ok: boolean; configured: boolean; error?: string };

/** Send a text to a client. Uses Twilio if connected; otherwise the caller
 *  falls back to opening the phone's Messages app. Every send is logged. */
export async function sendText(phone: string, body: string): Promise<SendResult> {
  const profile = await requireProfile();
  const to = phone.trim(); const msg = body.trim();
  if (!to || !msg) return { ok: false, configured: providers.sms(), error: "Empty" };
  if (!providers.sms()) return { ok: false, configured: false };
  try {
    const sid = await sendSms(to, msg);
    await supabaseLog(profile.organization_id!, to, msg, sid, "sent");
    revalidatePath(`/messages/${encodeURIComponent(to)}`); revalidatePath("/messages");
    return { ok: true, configured: true };
  } catch (e: any) {
    await supabaseLog(profile.organization_id!, to, msg, null, "failed", String(e?.message ?? e).slice(0, 400));
    return { ok: false, configured: true, error: "Send failed" };
  }
}

async function supabaseLog(org: string, to: string, body: string, sid: string | null, status: string, error?: string) {
  const supabase = createClient();
  await supabase.from("sms_messages").insert({
    organization_id: org, to_phone: to, body, direction: "outbound",
    provider: "twilio", provider_message_id: sid, status, error: error ?? null, sent_at: new Date().toISOString(),
  });
}
