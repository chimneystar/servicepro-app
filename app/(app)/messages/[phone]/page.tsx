import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import MessageComposer from "@/components/MessageComposer";

export const dynamic = "force-dynamic";

export default async function ThreadPage({ params }: { params: { phone: string } }) {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const phone = decodeURIComponent(params.phone);
  const last10 = phone.replace(/[^0-9]/g, "").slice(-10);
  const supabase = createClient();
  const [{ data: msgs }, { data: cust }] = await Promise.all([
    supabase.from("sms_messages").select("body, direction, created_at, to_phone, from_phone").order("created_at"),
    supabase.from("customers").select("name, phone").is("deleted_at", null),
  ]);
  const name = (cust ?? []).find((c) => (c.phone ?? "").replace(/[^0-9]/g, "").slice(-10) === last10)?.name ?? phone;
  const thread = (msgs ?? []).filter((m: any) => {
    const p = m.direction === "inbound" ? (m.from_phone || m.to_phone) : m.to_phone;
    return (p ?? "").replace(/[^0-9]/g, "").slice(-10) === last10;
  });

  return (
    <div style={{ maxWidth: 620, display: "flex", flexDirection: "column", minHeight: "70vh" }}>
      <Link href="/messages" style={{ color: "#2563eb", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>‹ Messages</Link>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: "8px 0 2px" }}>{name}</h1>
      <p style={{ color: "#5c6675", fontSize: 12.5, marginBottom: 12 }}>{phone}</p>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, paddingBottom: 12 }}>
        {thread.map((m: any, i: number) => (
          <div key={i} style={{ alignSelf: m.direction === "inbound" ? "flex-start" : "flex-end", maxWidth: "80%" }}>
            <div style={{ background: m.direction === "inbound" ? "#fff" : "#2563eb", color: m.direction === "inbound" ? "#0b1524" : "#fff", border: m.direction === "inbound" ? "1px solid #e2e8f0" : "none", borderRadius: 16, padding: "9px 13px", fontSize: 14 }}>{m.body}</div>
            <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 2, textAlign: m.direction === "inbound" ? "start" : "end" }}>{new Date(m.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
          </div>
        ))}
        {thread.length === 0 && <div className="rempty">No messages yet — say hello 👋</div>}
      </div>

      <MessageComposer phone={phone} />
    </div>
  );
}
