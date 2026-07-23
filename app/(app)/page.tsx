import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { money, todayISO, monthBounds, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const profile = await requireProfile();
  const locale = getLocale();
  const supabase = createClient();
  const { start, end } = monthBounds();
  const today = todayISO();
  const past14 = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);

  const [{ data: org }, { data: invoices }, { data: estimates }, { data: expenses }, { data: jobs }] = await Promise.all([
    supabase.from("organizations").select("currency").single(),
    supabase.from("invoices").select("status, total_minor, issue_date").is("deleted_at", null),
    supabase.from("estimates").select("status, total_minor").is("deleted_at", null),
    supabase.from("expenses").select("amount_minor, expense_date"),
    supabase.from("jobs").select("service, source, status, price_minor, scheduled_date, start_time, customer_id, customers(name)").is("deleted_at", null),
  ]);
  const cur = org?.currency ?? "USD";
  const inv = invoices ?? [], est = estimates ?? [], exp = expenses ?? [], jb = jobs ?? [];

  const paid = inv.filter((i) => i.status === "paid");
  const monthSales = paid.filter((i) => i.issue_date >= start && i.issue_date <= end).reduce((s, i) => s + i.total_minor, 0);
  const unpaid = inv.filter((i) => i.status === "unpaid");
  const dueSum = unpaid.reduce((s, i) => s + i.total_minor, 0);
  const pastDue = unpaid.filter((i) => i.issue_date < past14);
  const pastDueSum = pastDue.reduce((s, i) => s + i.total_minor, 0);
  const collectedAll = paid.reduce((s, i) => s + i.total_minor, 0);
  const monthExp = exp.filter((e) => e.expense_date >= start && e.expense_date <= end).reduce((s, e) => s + e.amount_minor, 0);

  const estBy = (st: string) => est.filter((e) => e.status === st);
  const todayJobs = jb.filter((j) => j.scheduled_date === today).sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));
  const upcoming = jb.filter((j) => j.scheduled_date >= today && j.status === "scheduled")
    .sort((a, b) => (a.scheduled_date + (a.start_time ?? "")).localeCompare(b.scheduled_date + (b.start_time ?? ""))).slice(0, 5);
  const recent = jb.slice().sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date)).slice(0, 6);

  const byType: Record<string, number> = {}; jb.forEach((j) => { byType[j.service] = (byType[j.service] || 0) + 1; });
  const topType = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const bySrc: Record<string, number> = {}; jb.forEach((j) => { if (j.source) bySrc[j.source] = (bySrc[j.source] || 0) + 1; });
  const topSrc = Object.entries(bySrc).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const srcMax = Math.max(...topSrc.map((s) => s[1]), 1);

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 3 }}>{t(locale, "dash.greeting", { name: profile.full_name || "👋" })}</h1>
      <p style={{ color: "#5c6675", marginBottom: 20, fontSize: 13.5 }}>{t(locale, "dash.overview")}</p>

      <div style={grid}>
        <Card span={4} title="Sales · this month">
          <Big>{money(monthSales, cur)}</Big>
          <Sub>{paid.length} paid invoices · {money(collectedAll, cur)} all time</Sub>
        </Card>
        <Card span={4} title="Invoices">
          <div style={{ borderInlineStart: "4px solid #b45309", paddingInlineStart: 12, marginBottom: 12 }}>
            <Sub>Due · {unpaid.length}</Sub><Big small>{money(dueSum, cur)}</Big>
          </div>
          <div style={{ borderInlineStart: "4px solid #dc2626", paddingInlineStart: 12 }}>
            <Sub>Past due · {pastDue.length}</Sub><Big small>{money(pastDueSum, cur)}</Big>
          </div>
        </Card>
        <Card span={4} title="This month">
          <Row label="Expenses" value={money(monthExp, cur)} />
          <Row label="Net (sales − exp)" value={money(monthSales - monthExp, cur)} strong />
          <Row label="Jobs today" value={String(todayJobs.length)} />
        </Card>

        <Card span={3} title="Estimates">
          {[["draft", "Draft"], ["sent", "Sent"], ["approved", "Approved"], ["rejected", "Declined"]].map(([k, l]) => (
            <Row key={k} label={l} value={`${estBy(k).length} · ${money(estBy(k).reduce((s, e) => s + e.total_minor, 0), cur)}`} />
          ))}
        </Card>
        <Card span={5} title="Today">
          {todayJobs.length === 0 ? <Sub>No jobs today 🌤️</Sub> : todayJobs.map((j: any, i) => (
            <div key={i} style={rowLine}>
              <b style={{ minWidth: 48 }}>{(j.start_time ?? "").slice(0, 5) || "—"}</b>
              <span style={{ flex: 1 }}>{j.customers?.name ?? "—"} · {j.service}</span>
              <b>{money(j.price_minor, cur)}</b>
            </div>
          ))}
        </Card>
        <Card span={4} title="Coming up">
          {upcoming.length === 0 ? <Sub>Nothing scheduled</Sub> : upcoming.map((j: any, i) => (
            <div key={i} style={rowLine}><span style={{ flex: 1 }}>{j.customers?.name ?? "—"}</span><Sub>{fmtDate(j.scheduled_date)}</Sub></div>
          ))}
        </Card>

        <Card span={8} title="Recent jobs">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <tbody>
              {recent.map((j: any, i) => (
                <tr key={i} style={{ borderTop: i ? "1px solid #eef1f6" : "none" }}>
                  <Td><b>{j.customers?.name ?? "—"}</b></Td><Td>{j.service}</Td>
                  <Td>{fmtDate(j.scheduled_date)}</Td><Td><b>{money(j.price_minor, cur)}</b></Td>
                  <Td><span style={statusChip(j.status)}>{j.status}</span></Td>
                </tr>
              ))}
              {recent.length === 0 && <tr><Td>—</Td></tr>}
            </tbody>
          </table>
        </Card>
        <Card span={4} title="Top job types & sources">
          <Sub>Job types</Sub>
          {topType.map(([k, v]) => <Row key={k} label={k} value={String(v)} />)}
          <div style={{ height: 8 }} />
          <Sub>Lead sources</Sub>
          {topSrc.map(([k, v]) => (
            <div key={k} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}><b>{k}</b><b>{v}</b></div>
              <div style={{ height: 6, background: "#eef1f6", borderRadius: 5, overflow: "hidden" }}><i style={{ display: "block", height: "100%", width: `${v / srcMax * 100}%`, background: "linear-gradient(90deg,#2563eb,#38bdf8)" }} /></div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(12,1fr)", gap: 14 };
function Card({ span, title, children }: { span: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ gridColumn: `span ${span}`, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 16, boxShadow: "0 6px 18px rgba(15,42,94,.06)", minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}
function Big({ children, small }: { children: React.ReactNode; small?: boolean }) { return <div style={{ fontSize: small ? 22 : 28, fontWeight: 800, letterSpacing: "-.3px" }}>{children}</div>; }
function Sub({ children }: { children: React.ReactNode }) { return <div style={{ fontSize: 12.5, color: "#5c6675", fontWeight: 600 }}>{children}</div>; }
function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f4f9", fontSize: 13.5 }}><span style={{ color: "#5c6675" }}>{label}</span><b style={{ color: strong ? "#15803d" : "#0b1524" }}>{value}</b></div>;
}
const rowLine: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #f1f4f9", fontSize: 13.5 };
function Td({ children }: { children: React.ReactNode }) { return <td style={{ padding: "9px 6px", textAlign: "start" }}>{children}</td>; }
function statusChip(s: string): React.CSSProperties {
  const map: Record<string, string> = { scheduled: "#e0ebff|#2563eb", in_progress: "#fdf1dc|#b45309", done: "#e6f6ec|#15803d", cancelled: "#eef1f6|#57606f" };
  const [bg, fg] = (map[s] ?? "#eef1f6|#57606f").split("|");
  return { background: bg, color: fg, padding: "3px 9px", borderRadius: 20, fontSize: 11.5, fontWeight: 700 };
}
