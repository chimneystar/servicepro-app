"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { providers, sendSms } from "@/lib/providers";
import { getConnection } from "@/lib/integrations/connections";
import { normalizeEmail, normalizePhone } from "@/lib/integrations/communications";
import { sendTwilioSms } from "@/lib/integrations/twilio";
import { sendGmail } from "@/lib/integrations/gmail";

export type SendResult = { ok: boolean; configured: boolean; error?: string };

export async function sendText(phone: string, body: string): Promise<SendResult> {
  const profile = await requireProfile();
  const to = normalizePhone(phone);
  const message = body.trim();
  if (!to || !message) return { ok: false, configured: false, error: "Enter a phone number and message" };
  const client = createClient();
  try {
    const connection = await getConnection(client, profile.organization_id!, "twilio");
    if (connection?.encrypted_credentials) {
      const { data: customers } = await client.from("customers").select("id, phone").is("deleted_at", null);
      const customer = (customers ?? []).find((item: any) => normalizePhone(item.phone ?? "") === to);
      await sendTwilioSms({ client, connection, to, body: message, customerId: customer?.id ?? null });
      revalidatePath("/messages");
      return { ok: true, configured: true };
    }
  } catch (error: any) {
    return { ok: false, configured: true, error: String(error?.message ?? error).slice(0, 240) };
  }

  if (!providers.sms()) return { ok: false, configured: false };
  try {
    const sid = await sendSms(to, message);
    await client.from("sms_messages").insert({
      organization_id: profile.organization_id!, to_phone: to, body: message, direction: "outbound",
      provider: "twilio", provider_message_id: sid, status: "sent", sent_at: new Date().toISOString(),
    });
    revalidatePath("/messages");
    return { ok: true, configured: true };
  } catch (error: any) {
    return { ok: false, configured: true, error: String(error?.message ?? error).slice(0, 240) };
  }
}

export async function sendCustomerEmail(input: { to: string; subject: string; body: string; customerId?: string | null; threadId?: string | null }): Promise<SendResult> {
  const profile = await requireProfile();
  const to = normalizeEmail(input.to);
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!to || !subject || !body) return { ok: false, configured: false, error: "Enter an email, subject, and message" };
  const client = createClient();
  try {
    const connection = await getConnection(client, profile.organization_id!, "gmail");
    if (!connection?.encrypted_credentials) return { ok: false, configured: false };
    const { data: organization } = await client.from("organizations").select("name").eq("id", profile.organization_id!).single();
    await sendGmail({
      client,
      connection,
      organizationId: profile.organization_id!,
      organizationName: organization?.name ?? "Service business",
      to,
      subject,
      html: `<p>${escapeHtml(body).replace(/\n/g, "<br>")}</p>`,
      customerId: input.customerId,
      threadId: input.threadId,
    });
    revalidatePath("/messages");
    return { ok: true, configured: true };
  } catch (error: any) {
    return { ok: false, configured: true, error: String(error?.message ?? error).slice(0, 240) };
  }
}

export async function markConversationRead(conversationId: string) {
  const profile = await requireProfile();
  const client = createClient();
  await client.from("conversations").update({ unread_count: 0, updated_at: new Date().toISOString() }).eq("id", conversationId).eq("organization_id", profile.organization_id!);
  await client.from("communications").update({ read_at: new Date().toISOString() }).eq("conversation_id", conversationId).eq("direction", "inbound").is("read_at", null);
  revalidatePath("/messages");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char] ?? char));
}
