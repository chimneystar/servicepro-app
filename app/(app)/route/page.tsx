import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { money, todayISO, fmtDate } from "@/lib/format";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function RoutePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const search = await searchParams;
  const profile = await requireProfile();
  const supabase = await createClient();
  const date = search.date || todayISO();

  const { data: jobs } = await supabase.from("jobs")
    .select("id, service, status, price_minor, start_time, end_time, job_address, job_city, customers(name, address, city, phone), profiles!jobs_assigned_to_fkey(full_name)")
    .eq("scheduled_date", date).is("deleted_at", null)
    .neq("status", "cancelled").order("start_time");
  const { data: org } = await supabase.from("organizations").select("currency").single();
  const cur = org?.currency ?? "USD";

  const stops = (jobs ?? []).map((j: any) => {
    const c = j.customers;
    const addr = [j.job_address || c?.address, j.job_city || c?.city].filter(Boolean).join(", ");
    return { id: j.id, name: c?.name ?? "—", service: j.service, time: (j.start_time ?? "").slice(0, 5), phone: c?.phone, addr, price: j.price_minor, tech: j.profiles?.full_name, status: j.status };
  });
  const withAddr = stops.filter((s) => s.addr);
  const mapsRoute = withAddr.length ? "https://www.google.com/maps/dir/" + withAddr.map((s) => encodeURIComponent(s.addr)).join("/") : null;

  const prev = shift(date, -1), next = shift(date, 1);

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>Today’s route</h1>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Link href={`/route?date=${prev}`} style={navBtn}>‹</Link>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#5c6675" }}>{fmtDate(date)}</span>
          <Link href={`/route?date=${next}`} style={navBtn}>›</Link>
        </div>
      </div>
      <p style={{ color: "#5c6675", fontSize: 13, marginBottom: 14 }}>{stops.length} stop{stops.length === 1 ? "" : "s"}</p>

      {mapsRoute && <a href={mapsRoute} target="_blank" style={{ display: "block", textAlign: "center", background: "#2563eb", color: "#fff", borderRadius: 12, padding: 14, fontWeight: 800, textDecoration: "none", marginBottom: 14 }}>🗺️ Open full route in Google Maps ({withAddr.length} stops)</a>}

      <div style={{ display: "grid", gap: 10 }}>
        {stops.map((s, i) => (
          <div key={s.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 14, display: "flex", gap: 12 }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#0f2a5e", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, flexShrink: 0 }}>{i + 1}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <b style={{ fontSize: 15 }}>{s.time || "—"} · {s.name}</b>
                <b>{money(s.price, cur)}</b>
              </div>
              <div style={{ fontSize: 13, color: "#5c6675" }}>{s.service}{s.tech ? ` · ${s.tech}` : ""}</div>
              {s.addr && <div style={{ fontSize: 13, color: "#5c6675" }}>📍 {s.addr}</div>}
              <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
                <Link href={`/jobs/${s.id}`} style={clink}>Open job</Link>
                {s.addr && <a href={"https://maps.google.com/?q=" + encodeURIComponent(s.addr)} target="_blank" style={clink}>🧭 Navigate</a>}
                {s.phone && <a href={"tel:" + s.phone.replace(/[^0-9+]/g, "")} style={clink}>📞 Call</a>}
              </div>
            </div>
          </div>
        ))}
        {stops.length === 0 && <div className="rempty">No jobs scheduled for this day.</div>}
      </div>
    </div>
  );
}

function shift(iso: string, days: number) { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
const navBtn: React.CSSProperties = { background: "#eef2f8", color: "#2563eb", borderRadius: 8, padding: "6px 12px", fontWeight: 800, textDecoration: "none", fontSize: 16 };
const clink: React.CSSProperties = { color: "#2563eb", textDecoration: "none", fontWeight: 700, fontSize: 13 };
