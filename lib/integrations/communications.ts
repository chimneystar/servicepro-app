import type { NormalizedCommunication } from "./types";

type SupabaseLike = any;

export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export async function recordCommunication(client: SupabaseLike, input: NormalizedCommunication) {
  const contactKey = input.channel === "sms" ? normalizePhone(input.contactKey) : normalizeEmail(input.contactKey);
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const { data: existingConversation } = await client
    .from("conversations")
    .select("id, unread_count")
    .eq("organization_id", input.organizationId)
    .eq("channel", input.channel)
    .eq("contact_key", contactKey)
    .maybeSingle();

  let conversation = existingConversation;
  if (!conversation) {
    const { data, error } = await client.from("conversations").insert({
      organization_id: input.organizationId,
      customer_id: input.customerId ?? null,
      channel: input.channel,
      contact_key: contactKey,
      provider_thread_id: input.providerThreadId ?? null,
      subject: input.subject ?? null,
      unread_count: input.direction === "inbound" ? 1 : 0,
      last_message_at: occurredAt,
    }).select("id, unread_count").single();
    if (error) throw new Error(error.message);
    conversation = data;
  } else {
    const nextUnread = input.direction === "inbound" ? Number(conversation.unread_count ?? 0) + 1 : Number(conversation.unread_count ?? 0);
    const { error } = await client.from("conversations").update({
      customer_id: input.customerId ?? undefined,
      provider_thread_id: input.providerThreadId ?? undefined,
      subject: input.subject ?? undefined,
      unread_count: nextUnread,
      last_message_at: occurredAt,
      updated_at: new Date().toISOString(),
    }).eq("id", conversation.id);
    if (error) throw new Error(error.message);
  }

  if (input.providerMessageId) {
    const { data: duplicate, error: duplicateError } = await client
      .from("communications")
      .select("id, conversation_id")
      .eq("organization_id", input.organizationId)
      .eq("provider", input.provider)
      .eq("provider_message_id", input.providerMessageId)
      .maybeSingle();
    if (duplicateError) throw new Error(duplicateError.message);
    if (duplicate) return duplicate;
  }

  const { data, error } = await client.from("communications").insert({
    organization_id: input.organizationId,
    conversation_id: conversation.id,
    customer_id: input.customerId ?? null,
    channel: input.channel,
    direction: input.direction,
    status: input.status,
    from_address: input.fromAddress ?? null,
    to_address: input.toAddress ?? null,
    subject: input.subject ?? null,
    body: input.body,
    provider: input.provider,
    provider_message_id: input.providerMessageId ?? null,
    provider_thread_id: input.providerThreadId ?? null,
    business_event_key: input.businessEventKey ?? null,
    metadata: input.metadata ?? {},
    sent_at: input.direction === "outbound" ? occurredAt : null,
    created_at: occurredAt,
  }).select("id, conversation_id").single();
  if (error) throw new Error(error.message);
  return data;
}
