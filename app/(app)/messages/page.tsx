import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Filter = "all" | "sms" | "email" | "unread" | "failed";

export default async function MessagesPage({ searchParams }: { searchParams?: { filter?: string } }) {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const client = createClient();
  const filter = (["sms", "email", "unread", "failed"].includes(searchParams?.filter ?? "") ? searchParams?.filter : "all") as Filter;
  const [{ data: conversations, error }, { data: customers }, { data: connections }] = await Promise.all([
    client.from("conversations").select("id, customer_id, channel, contact_key, subject, unread_count, last_message_at").order("last_message_at", { ascending: false }),
    client.from("customers").select("id, name").is("deleted_at", null),
    client.from("integration_connections").select("provider, status, metadata"),
  ]);

  if (error) return <LegacyNotice />;
  const ids = (conversations ?? []).map((item: any) => item.id);
  const { data: allMessages } = ids.length
    ? await client.from("communications").select("conversation_id, body, status, created_at").in("conversation_id", ids).order("created_at", { ascending: false })
    : { data: [] as any[] };
  const latest = new Map<string, any>();
  for (const message of allMessages ?? []) if (!latest.has(message.conversation_id)) latest.set(message.conversation_id, message);
  const names = new Map((customers ?? []).map((item: any) => [item.id, item.name]));
  const rows = (conversations ?? []).filter((item: any) => {
    if (filter === "sms" || filter === "email") return item.channel === filter;
    if (filter === "unread") return item.unread_count > 0;
    if (filter === "failed") return latest.get(item.id)?.status === "failed";
    return true;
  });
  const connected = new Map((connections ?? []).map((item: any) => [item.provider, item]));

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
        <div><h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 3 }}>Messages</h1><p style={{ color: "#5c6675", fontSize: 13, marginTop: 0 }}>Text and email conversations in one inbox.</p></div>
        <Link href="/settings/integrations" style={{ color: "#2563eb", fontWeight: 700, fontSize: 12.5, textDecoration: "none" }}>Manage integrations</Link>
      </div>
      {(!connected.get("twilio") || !connected.get("gmail")) && <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", borderRadius: 12, padding: "10px 14px", fontSize: 12.5, marginBottom: 12 }}>Connect Gmail and a business text number to use both channels here.</div>}
      <div style={{ display: "flex", gap: 7, overflowX: "auto", marginBottom: 12, paddingBottom: 2 }}>
        {(["all", "sms", "email", "unread", "failed"] as Filter[]).map((item) => <Link key={item} href={item === "all" ? "/messages" : `/messages?filter=${item}`} style={{ ...filterChip, ...(filter === item ? activeChip : {}) }}>{item === "sms" ? "Text" : item[0].toUpperCase() + item.slice(1)}</Link>)}
      </div>
      <div className="rlist">
        {rows.map((conversation: any) => {
          const message = latest.get(conversation.id);
          const title = names.get(conversation.customer_id) ?? conversation.contact_key;
          return <Link key={conversation.id} href={`/messages/conversations/${conversation.id}`} className="ritem">
            <div className="avatar-sm" style={{ background: conversation.channel === "sms" ? "#2563eb" : "#7c3aed" }}>{String(title)[0]?.toUpperCase() ?? "?"}</div>
            <div className="rmain"><div className="rtitle">{title} <span style={{ fontSize: 11 }}>{conversation.channel === "sms" ? "💬" : "✉️"}</span></div><div className="rsub">{message?.body ?? conversation.subject ?? "No messages"}</div></div>
            <div className="rend">{conversation.unread_count > 0 && <span className="pill" style={{ background: "#2563eb", color: "#fff" }}>{conversation.unread_count}</span>}<span style={{ fontSize: 10.5, color: message?.status === "failed" ? "#dc2626" : "#94a3b8" }}>{message?.status ?? ""}</span></div>
          </Link>;
        })}
        {rows.length === 0 && <div className="rempty">No conversations in this view yet.</div>}
      </div>
    </div>
  );
}

function LegacyNotice() {
  return <div style={{ maxWidth: 720 }}><h1 style={{ fontSize: 24, fontWeight: 800 }}>Messages</h1><div style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", borderRadius: 12, padding: 14, fontSize: 13 }}>The unified inbox is ready in this branch, but its database migration still needs to be applied to the preview Supabase project. Existing CRM data has not been changed.</div></div>;
}

const filterChip: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 999, padding: "7px 12px", color: "#475569", textDecoration: "none", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" };
const activeChip: React.CSSProperties = { background: "#2563eb", color: "#fff", borderColor: "#2563eb" };
