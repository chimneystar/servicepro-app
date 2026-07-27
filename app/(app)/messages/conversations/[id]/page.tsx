import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import UnifiedComposer from "@/components/UnifiedComposer";

export const dynamic = "force-dynamic";

export default async function ConversationPage({ params }: { params: { id: string } }) {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const client = createClient();
  const { data: conversation } = await client.from("conversations").select("id, customer_id, channel, contact_key, subject, provider_thread_id, unread_count").eq("id", params.id).eq("organization_id", profile.organization_id!).maybeSingle();
  if (!conversation) return <div><Link href="/messages" style={back}>‹ Messages</Link><div className="rempty">Conversation not found.</div></div>;
  const [{ data: messages }, { data: customer }, { data: connection }] = await Promise.all([
    client.from("communications").select("id, direction, status, body, subject, created_at, error_message").eq("conversation_id", conversation.id).order("created_at"),
    conversation.customer_id ? client.from("customers").select("name").eq("id", conversation.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    client.from("integration_connections").select("status, encrypted_credentials").eq("organization_id", profile.organization_id!).eq("provider", conversation.channel === "sms" ? "twilio" : "gmail").maybeSingle(),
  ]);
  if (conversation.unread_count > 0) {
    await Promise.all([
      client.from("conversations").update({ unread_count: 0, updated_at: new Date().toISOString() }).eq("id", conversation.id),
      client.from("communications").update({ read_at: new Date().toISOString() }).eq("conversation_id", conversation.id).eq("direction", "inbound").is("read_at", null),
    ]);
  }
  const title = customer?.name ?? conversation.contact_key;
  return (
    <div style={{ maxWidth: 680, display: "flex", flexDirection: "column", minHeight: "72vh" }}>
      <Link href="/messages" style={back}>‹ Messages</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 10, margin: "8px 0 14px" }}>
        <div><h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{title}</h1><div style={{ color: "#5c6675", fontSize: 12.5 }}>{conversation.channel === "sms" ? "💬" : "✉️"} {conversation.contact_key}</div></div>
        <span className="pill" style={{ background: conversation.channel === "sms" ? "#e0ebff" : "#f3e8ff", color: conversation.channel === "sms" ? "#1d4ed8" : "#7e22ce" }}>{conversation.channel === "sms" ? "Text" : "Email"}</span>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 9, paddingBottom: 14 }}>
        {(messages ?? []).map((message: any) => <MessageBubble key={message.id} message={message} channel={conversation.channel} />)}
        {(messages ?? []).length === 0 && <div className="rempty">No messages yet.</div>}
      </div>
      <UnifiedComposer channel={conversation.channel} contact={conversation.contact_key} customerId={conversation.customer_id} subject={conversation.subject} threadId={conversation.provider_thread_id} connected={!!connection?.encrypted_credentials} />
    </div>
  );
}

function MessageBubble({ message, channel }: { message: any; channel: string }) {
  const inbound = message.direction === "inbound";
  return (
    <div style={{ alignSelf: inbound ? "flex-start" : "flex-end", maxWidth: "84%" }}>
      {channel === "email" && message.subject && <div style={{ fontSize: 11.5, fontWeight: 800, marginBottom: 3 }}>{message.subject}</div>}
      <div style={{ background: inbound ? "#fff" : "#2563eb", color: inbound ? "#0b1524" : "#fff", border: inbound ? "1px solid #e2e8f0" : "none", borderRadius: 16, padding: "10px 13px", fontSize: 14, whiteSpace: "pre-wrap" }}>{message.body}</div>
      <div style={{ fontSize: 10.5, color: message.status === "failed" ? "#dc2626" : "#94a3b8", marginTop: 2, textAlign: inbound ? "start" : "end" }}>{new Date(message.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {message.status}</div>
      {message.error_message && <div style={{ color: "#dc2626", fontSize: 10.5 }}>{message.error_message}</div>}
    </div>
  );
}

const back: React.CSSProperties = { color: "#2563eb", fontWeight: 700, fontSize: 14, textDecoration: "none" };
