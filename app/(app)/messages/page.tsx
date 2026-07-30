import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { providers } from "@/lib/providers";
import { getLocale } from "@/lib/locale-server";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const profile = await requireProfile();
  const he = (await getLocale()) === "he";
  if (profile.role === "tech") redirect("/");
  const supabase = await createClient();
  const [{ data: msgs }, { data: customers }] = await Promise.all([
    supabase.from("sms_messages").select("to_phone, from_phone, body, direction, created_at").order("created_at", { ascending: false }),
    supabase.from("customers").select("name, phone").is("deleted_at", null),
  ]);
  const nameByPhone = new Map<string, string>();
  (customers ?? []).forEach((c) => { if (c.phone) nameByPhone.set(digits(c.phone), c.name); });

  const threads = new Map<string, { phone: string; name: string; last: string; at: string }>();
  (msgs ?? []).forEach((m: any) => {
    const phone = m.direction === "inbound" ? (m.from_phone || m.to_phone) : m.to_phone;
    if (!phone) return;
    const key = digits(phone);
    if (!threads.has(key)) threads.set(key, { phone, name: nameByPhone.get(key) ?? phone, last: m.body, at: m.created_at });
  });
  const list = [...threads.values()];

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>{he ? "הודעות" : "Messages"}</h1>
      <p style={{ color: "#5c6675", fontSize: 14, marginBottom: 8 }}>{he ? "כל ההתכתבויות עם הלקוחות במקום אחד." : "All customer text conversations in one place."}</p>
      {!providers.sms() && (
        <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", borderRadius: 12, padding: "10px 14px", fontSize: 14, marginBottom: 14 }}>
          {he ? "כדי לשלוח ולקבל הודעות מתוך המערכת, מחברים מספר Twilio. עד אז אפשר לפתוח שיחה ולשלוח הודעה מהטלפון." : "Connect a Twilio number to send and receive messages here. Until then, open a conversation to text from your phone."}
        </div>
      )}
      <div style={{ display: "grid", gap: 8 }}>
        {list.map((th) => (
          <Link key={th.phone} href={`/messages/${encodeURIComponent(th.phone)}`} style={{ display: "flex", gap: 12, alignItems: "center", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, textDecoration: "none", color: "inherit" }}>
            <div style={{ width: 42, height: 42, borderRadius: "50%", background: "#e0ebff", color: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>{(th.name[0] ?? "?").toUpperCase()}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{th.name}</div>
              <div style={{ fontSize: 14, color: "#5c6675", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{th.last}</div>
            </div>
            <span style={{ color: "#b6bfcc" }}>›</span>
          </Link>
        ))}
        {list.length === 0 && <div className="rempty">{he ? "עוד אין שיחות. אפשר להתחיל שיחה מתוך כרטיס הלקוח." : "No conversations yet. Start one from a customer record."}</div>}
      </div>
    </div>
  );
}

function digits(p: string) { return (p || "").replace(/[^0-9]/g, "").slice(-10); }
