import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import MessageComposer from "@/components/MessageComposer";
// @ts-ignore — pure helpers, unit-tested by node:test.
import { clampLimit, isTruncated } from "@/lib/core/query-window.mjs";
// @ts-ignore — shared phone logic, unit-tested by node:test.
import { phoneSearchSuffix } from "@/lib/core/calls.mjs";
// @ts-ignore — PostgREST filter escaping, unit-tested by node:test.
import { quoteFilterValue, escapeLikePattern } from "@/lib/core/postgrest-filter.mjs";

export const dynamic = "force-dynamic";

// THE BUG: to show ONE conversation this read every sms_messages row and every
// customer in the organisation and then filtered both in JavaScript. The thread
// is now selected in SQL, newest-first with a limit, and reversed for display
// so the reading order is unchanged.
const DEFAULT_THREAD_PAGE = 200;
const MAX_THREAD_PAGE = 2000;

export default async function ThreadPage({ params, searchParams }: {
  params: Promise<{ phone: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const { phone: encodedPhone } = await params;
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const phone = decodeURIComponent(encodedPhone);
  const last10 = phone.replace(/[^0-9]/g, "").slice(-10);
  const search = await searchParams;
  const pageSize: number = clampLimit(search.show, DEFAULT_THREAD_PAGE, MAX_THREAD_PAGE);

  const supabase = await createClient();
  // Four digits is the narrowest suffix that stays contiguous across every way
  // a number gets stored ("+15551234567", "(555) 123-4567"); the exact last-ten
  // comparison still happens below, so what is shown is unchanged.
  const suffix: string = phoneSearchSuffix(last10);
  const like = suffix ? quoteFilterValue(`%${escapeLikePattern(suffix)}`) : "";

  const [{ data: msgs }, { data: cust }] = await Promise.all([
    suffix
      ? supabase.from("sms_messages").select("body, direction, created_at, to_phone, from_phone")
        .or(`to_phone.ilike.${like},from_phone.ilike.${like}`)
        .order("created_at", { ascending: false }).limit(pageSize)
      : Promise.resolve({ data: [] as any[] }),
    suffix
      ? supabase.from("customers").select("name, phone").is("deleted_at", null)
        .ilike("phone", `%${suffix}`).limit(50)
      : Promise.resolve({ data: [] as { name: string; phone: string | null }[] }),
  ]);

  const name = (cust ?? []).find((c) => (c.phone ?? "").replace(/[^0-9]/g, "").slice(-10) === last10)?.name ?? phone;
  // The suffix query is deliberately loose; the exact match is re-applied here.
  const matched = (msgs ?? []).filter((m: any) => {
    const p = m.direction === "inbound" ? (m.from_phone || m.to_phone) : m.to_phone;
    return (p ?? "").replace(/[^0-9]/g, "").slice(-10) === last10;
  });
  const truncated: boolean = isTruncated(msgs?.length ?? 0, pageSize);
  const thread = matched.slice().reverse(); // oldest first, as before

  return (
    <div style={{ maxWidth: 620, display: "flex", flexDirection: "column", minHeight: "70vh" }}>
      <Link href="/messages" style={{ color: "#2563eb", fontWeight: 700, fontSize: "0.875rem", textDecoration: "none" }}>‹ Messages</Link>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 800, margin: "8px 0 2px" }}>{name}</h1>
      <p style={{ color: "#5c6675", fontSize: "0.8125rem", marginBottom: 12 }}>{phone}</p>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, paddingBottom: 12 }}>
        {truncated && (
          <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", borderRadius: 12, padding: "9px 13px", fontSize: "0.8125rem", textAlign: "center" }}>
            Showing the most recent {pageSize} messages.{" "}
            {pageSize < MAX_THREAD_PAGE && (
              <Link href={`/messages/${encodeURIComponent(phone)}?show=${Math.min(pageSize * 2, MAX_THREAD_PAGE)}`} style={{ color: "#9a3412", fontWeight: 800 }}>
                Load earlier messages
              </Link>
            )}
          </div>
        )}
        {thread.map((m: any, i: number) => (
          <div key={i} style={{ alignSelf: m.direction === "inbound" ? "flex-start" : "flex-end", maxWidth: "80%" }}>
            <div style={{ background: m.direction === "inbound" ? "#fff" : "#2563eb", color: m.direction === "inbound" ? "#0b1524" : "#fff", border: m.direction === "inbound" ? "1px solid #e2e8f0" : "none", borderRadius: 16, padding: "9px 13px", fontSize: "0.875rem" }}>{m.body}</div>
            <div style={{ fontSize: "0.8125rem", color: "#94a3b8", marginTop: 2, textAlign: m.direction === "inbound" ? "start" : "end" }}>{new Date(m.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
          </div>
        ))}
        {thread.length === 0 && <div className="rempty">No messages yet — say hello 👋</div>}
      </div>

      <MessageComposer phone={phone} />
    </div>
  );
}
