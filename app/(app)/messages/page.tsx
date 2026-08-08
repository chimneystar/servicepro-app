import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { providers } from "@/lib/providers";
import { getLocale } from "@/lib/locale-server";
// @ts-ignore — pure helpers, unit-tested by node:test.
import { clampLimit, isTruncated } from "@/lib/core/query-window.mjs";
// @ts-ignore — shared phone logic, unit-tested by node:test.
import { phoneSearchSuffix } from "@/lib/core/calls.mjs";
// @ts-ignore — PostgREST filter escaping, unit-tested by node:test.
import { quoteFilterValue, escapeLikePattern } from "@/lib/core/postgrest-filter.mjs";

export const dynamic = "force-dynamic";

// THE BUG: this page selected EVERY row of sms_messages AND every customer in
// the organisation, then grouped them into threads in JavaScript. Both tables
// grow forever; neither query had a limit. The conversation list only ever
// shows the most recent message per thread, so the fix is to read a recent page
// of messages and — crucially — SAY SO when there is more, rather than letting
// older conversations disappear without explanation.
const DEFAULT_MESSAGE_PAGE = 400;
const MAX_MESSAGE_PAGE = 4000;

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const profile = await requireProfile();
  const he = (await getLocale()) === "he";
  if (profile.role === "tech") redirect("/");
  const search = await searchParams;
  const pageSize: number = clampLimit(search.show, DEFAULT_MESSAGE_PAGE, MAX_MESSAGE_PAGE);

  const supabase = await createClient();
  const { data: msgs } = await supabase
    .from("sms_messages")
    .select("to_phone, from_phone, body, direction, created_at")
    .order("created_at", { ascending: false })
    .limit(pageSize);

  const threads = new Map<string, { phone: string; last: string; at: string }>();
  (msgs ?? []).forEach((m: any) => {
    const phone = m.direction === "inbound" ? m.from_phone || m.to_phone : m.to_phone;
    if (!phone) return;
    const key = digits(phone);
    if (!threads.has(key)) threads.set(key, { phone, last: m.body, at: m.created_at });
  });

  // Only the customers who actually appear in these threads, matched in SQL.
  // This used to be an unbounded `select name, phone from customers`.
  const nameByPhone = await namesForThreads(supabase, [...threads.keys()]);
  const list = [...threads.entries()].map(([key, thread]) => ({
    ...thread,
    name: nameByPhone.get(key) ?? thread.phone,
  }));

  const truncated: boolean = isTruncated(msgs?.length ?? 0, pageSize);
  const nextPage = Math.min(pageSize * 2, MAX_MESSAGE_PAGE);

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: 4 }}>
        {he ? "הודעות" : "Messages"}
      </h1>
      <p style={{ color: "#5c6675", fontSize: "0.875rem", marginBottom: 8 }}>
        {he
          ? "כל ההתכתבויות עם הלקוחות במקום אחד."
          : "All customer text conversations in one place."}
      </p>
      {!providers.sms() && (
        <div
          style={{
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            color: "#9a3412",
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: "0.875rem",
            marginBottom: 14,
          }}
        >
          {he
            ? "כדי לשלוח ולקבל הודעות מתוך המערכת, מחברים מספר Twilio. עד אז אפשר לפתוח שיחה ולשלוח הודעה מהטלפון."
            : "Connect a Twilio number to send and receive messages here. Until then, open a conversation to text from your phone."}
        </div>
      )}
      <div style={{ display: "grid", gap: 8 }}>
        {list.map((th) => (
          <Link
            key={th.phone}
            href={`/messages/${encodeURIComponent(th.phone)}`}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              padding: 14,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: "50%",
                background: "#e0ebff",
                color: "#2563eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
              }}
            >
              {(th.name[0] ?? "?").toUpperCase()}
            </div>
            <div className="sp-flex-fill">
              <div style={{ fontWeight: 700 }}>{th.name}</div>
              <div
                style={{
                  fontSize: "0.875rem",
                  color: "#5c6675",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {th.last}
              </div>
            </div>
            <span style={{ color: "#b6bfcc" }}>›</span>
          </Link>
        ))}
        {list.length === 0 && (
          <div className="rempty">
            {he
              ? "עוד אין שיחות. אפשר להתחיל שיחה מתוך כרטיס הלקוח."
              : "No conversations yet. Start one from a customer record."}
          </div>
        )}
      </div>
      {truncated && (
        <div
          style={{
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            color: "#9a3412",
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: "0.875rem",
            marginTop: 12,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span>
            {he
              ? `מוצגות השיחות מתוך ${pageSize} ההודעות האחרונות. ייתכן שיש שיחות ישנות יותר.`
              : `Showing conversations from the latest ${pageSize} messages. Older conversations may not appear.`}
          </span>
          {pageSize < MAX_MESSAGE_PAGE && (
            <Link
              href={`/messages?show=${nextPage}`}
              style={{ color: "#9a3412", fontWeight: 800, whiteSpace: "nowrap" }}
            >
              {he ? "טעינת שיחות ישנות יותר" : "Load older conversations"} →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Look up the customer name for each thread with one bounded query instead of
 * reading the whole customers table.
 *
 * Matching is on the last four digits because the same number is stored in
 * several formats; the exact last-ten comparison still happens here, so the
 * result is identical to the old in-memory scan.
 */
async function namesForThreads(supabase: Awaited<ReturnType<typeof createClient>>, keys: string[]) {
  const byPhone = new Map<string, string>();
  const suffixes = [
    ...new Set(keys.map((key) => phoneSearchSuffix(key)).filter(Boolean)),
  ] as string[];
  if (suffixes.length === 0) return byPhone;

  // Chunked so the `or=` expression stays inside a sane URL length; PostgREST
  // reads its filters from the query string.
  const chunks: string[][] = [];
  for (let at = 0; at < suffixes.length; at += 40) chunks.push(suffixes.slice(at, at + 40));

  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from("customers")
        .select("name, phone")
        .is("deleted_at", null)
        .or(
          chunk
            .map((suffix) => `phone.ilike.${quoteFilterValue(`%${escapeLikePattern(suffix)}`)}`)
            .join(","),
        )
        .limit(400),
    ),
  );

  for (const { data } of results) {
    (data ?? []).forEach((c) => {
      if (c.phone) byPhone.set(digits(c.phone), c.name);
    });
  }
  return byPhone;
}

function digits(p: string) {
  return (p || "").replace(/[^0-9]/g, "").slice(-10);
}
