import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import TimesheetExport, { type TSRow } from "@/components/TimesheetExport";

export const dynamic = "force-dynamic";

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const search = await searchParams;
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const supabase = await createClient();
  const now = new Date();
  const from = search.from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = search.to || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const { data: entries } = await supabase.from("job_time_entries")
    .select("started_at, ended_at, profiles(full_name), jobs(service)")
    .gte("started_at", `${from}T00:00:00`).lte("started_at", `${to}T23:59:59`).order("started_at");

  // Server request time is intentionally captured once for open time entries.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const rows: TSRow[] = (entries ?? []).map((e: any) => {
    const st = new Date(e.started_at).getTime(); const en = e.ended_at ? new Date(e.ended_at).getTime() : nowMs;
    const hrs = Math.max(0, (en - st) / 3600000);
    return { tech: e.profiles?.full_name || "Unassigned", date: (e.started_at ?? "").slice(0, 10), service: e.jobs?.service || "—", hours: hrs.toFixed(2) };
  });
  const byTech: Record<string, number> = {};
  rows.forEach((r) => { byTech[r.tech] = (byTech[r.tech] || 0) + parseFloat(r.hours); });
  const totals = Object.entries(byTech).sort((a, b) => b[1] - a[1]);

  return (
    <div style={{ maxWidth: 720 }}>
      <Link href="/reports" style={{ color: "#2563eb", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>‹ Reports</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, margin: "8px 0 14px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>Timesheets</h1>
        <TimesheetExport rows={rows} filename={`timesheets_${from}_${to}.csv`} />
      </div>

      <form method="get" style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "end" }}>
        <div><label style={lbl}>From</label><input type="date" name="from" defaultValue={from} style={inp} /></div>
        <div><label style={lbl}>To</label><input type="date" name="to" defaultValue={to} style={inp} /></div>
        <button type="submit" style={{ background: "#eef2f8", color: "#2563eb", border: "none", borderRadius: 10, padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}>Apply</button>
      </form>

      <div style={{ fontWeight: 800, fontSize: 15, margin: "4px 0 8px" }}>Hours by technician</div>
      <div className="rlist">
        {totals.map(([tech, hrs]) => (
          <div className="ritem" key={tech}><div className="rmain"><div className="rtitle">{tech}</div></div><div className="rend"><b>{hrs.toFixed(2)} h</b></div></div>
        ))}
        {totals.length === 0 && <div className="rempty">No clock-in time recorded in this period.</div>}
      </div>
    </div>
  );
}
const lbl: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: "#334155", display: "block", marginBottom: 5 };
const inp: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 16, outline: "none" };
