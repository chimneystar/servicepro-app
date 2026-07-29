import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { money, todayISO, monthBounds, fmtDate } from "@/lib/format";
import { Donut, Bars, Legend } from "@/components/MiniCharts";
import SetupChecklist, { type Step } from "@/components/SetupChecklist";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const profile = await requireProfile();
  const locale = (await getLocale());
  const he = locale === "he";
  const supabase = await createClient();
  const { start, end } = monthBounds();
  const today = todayISO();
  const past14 = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);

  const [{ data: org }, { data: invoices }, { data: estimates }, { data: expenses }, { data: jobs }, { data: leads }, { count: custCount }] = await Promise.all([
    supabase.from("organizations").select("currency, logo_url, tax_rate_bps, review_url, onboarding_dismissed").single(),
    supabase.from("invoices").select("status, total_minor, issue_date").is("deleted_at", null),
    supabase.from("estimates").select("status, total_minor").is("deleted_at", null),
    supabase.from("expenses").select("amount_minor, expense_date"),
    supabase.from("jobs").select("service, source, status, price_minor, scheduled_date, start_time, customer_id, customers(name)").is("deleted_at", null),
    supabase.from("leads").select("status"),
    supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("archived", false),
  ]);
  const openLeads = (leads ?? []).filter((l) => !["won", "lost"].includes(l.status)).length;

  // Onboarding checklist (owner only, until dismissed / complete)
  const steps: Step[] = [
    { label: he ? "הוספת לוגו לעסק" : "Add your business logo", done: !!org?.logo_url, href: "/settings" },
    { label: he ? "הגדרת שיעור המס" : "Set your sales-tax rate", done: (org?.tax_rate_bps ?? 0) > 0, href: "/settings" },
    { label: he ? "הוספת הלקוח הראשון" : "Add your first customer", done: (custCount ?? 0) > 0, href: "/customers" },
    { label: he ? "יצירת הצעת המחיר הראשונה" : "Create your first estimate", done: (estimates ?? []).length > 0, href: "/estimates" },
    { label: he ? "שיבוץ העבודה הראשונה" : "Schedule your first job", done: (jobs ?? []).length > 0, href: "/schedule" },
    { label: he ? "הוספת קישור לביקורת" : "Add your review link", done: !!org?.review_url, href: "/settings" },
  ];
  const showChecklist = profile.role === "owner" && !org?.onboarding_dismissed && steps.some((s) => !s.done);
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
  const wonN = estBy("approved").length, lostN = estBy("rejected").length;
  const winRate = wonN + lostN > 0 ? Math.round((wonN / (wonN + lostN)) * 100) : 0;

  // 6-month revenue series (paid invoices) + paid-vs-due donut
  const base = new Date();
  const series = Array.from({ length: 6 }, (_, k) => {
    const dt = new Date(base.getFullYear(), base.getMonth() - (5 - k), 1);
    const ym = dt.toISOString().slice(0, 7);
    const sum = paid.filter((i) => (i.issue_date ?? "").slice(0, 7) === ym).reduce((a, i) => a + i.total_minor, 0);
    return { label: dt.toLocaleString(he ? "he-IL" : "en-US", { month: "short" }), value: Math.round(sum / 100) };
  });
  const collectRate = collectedAll + dueSum > 0 ? Math.round((collectedAll / (collectedAll + dueSum)) * 100) : 0;
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
      <p style={{ color: "#5c6675", marginBottom: 14, fontSize: 13.5 }}>{t(locale, "dash.overview")}</p>

      {showChecklist && <SetupChecklist steps={steps} />}

      <div className="scroll-x" style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {[["/schedule", he ? "עבודה חדשה" : "New job"], ["/estimates", he ? "הצעות מחיר" : "Estimates"], ["/invoices", he ? "חשבוניות" : "Invoices"], ["/leads", he ? "לידים" : "Leads"], ["/route", he ? "המסלול של היום" : "Today’s route"], ["/messages", he ? "הודעות" : "Messages"], ["/reports", he ? "דוחות" : "Reports"]].map(([href, label]) => (
          <Link key={href} href={href} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 13px", fontWeight: 700, fontSize: 13, color: "#0b1524", textDecoration: "none", whiteSpace: "nowrap" }}>{label}</Link>
        ))}
      </div>

      <div className="dash" style={grid}>
        <Card span={8} title={he ? "הכנסות · ששת החודשים האחרונים" : "Revenue · last 6 months"}>
          <Bars data={series} />
        </Card>
        <Card span={4} title={he ? "גבייה" : "Collections"}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <Donut segments={[{ value: collectedAll, color: "#15803d" }, { value: dueSum, color: "#f59e0b" }]} centerTop={`${collectRate}%`} centerSub={he ? "נגבה" : "collected"} />
            <Legend items={[{ label: he ? "שולם" : "Paid", color: "#15803d", value: money(collectedAll, cur) }, { label: he ? "לתשלום" : "Due", color: "#f59e0b", value: money(dueSum, cur) }]} />
          </div>
        </Card>

        <Card span={4} title={he ? "צבר מכירות" : "Pipeline"}>
          <Row label={he ? "לידים פתוחים" : "Open leads"} value={String(openLeads)} />
          <Row label={he ? "אחוז הצעות שאושרו" : "Estimate win rate"} value={`${winRate}%`} strong />
          <Row label={he ? "אושרו / נדחו" : "Approved / Declined"} value={`${wonN} / ${lostN}`} />
        </Card>
        <Card span={4} title={he ? "מכירות · החודש" : "Sales · this month"}>
          <Big>{money(monthSales, cur)}</Big>
          <Sub>{he ? `${paid.length} חשבוניות שולמו · ${money(collectedAll, cur)} בסך הכול` : `${paid.length} paid invoices · ${money(collectedAll, cur)} all time`}</Sub>
        </Card>
        <Card span={4} title={he ? "חשבוניות" : "Invoices"}>
          <div style={{ borderInlineStart: "4px solid #b45309", paddingInlineStart: 12, marginBottom: 12 }}>
            <Sub>{he ? "לתשלום" : "Due"} · {unpaid.length}</Sub><Big small>{money(dueSum, cur)}</Big>
          </div>
          <div style={{ borderInlineStart: "4px solid #dc2626", paddingInlineStart: 12 }}>
            <Sub>{he ? "באיחור" : "Past due"} · {pastDue.length}</Sub><Big small>{money(pastDueSum, cur)}</Big>
          </div>
        </Card>
        <Card span={4} title={he ? "החודש" : "This month"}>
          <Row label={he ? "הוצאות" : "Expenses"} value={money(monthExp, cur)} />
          <Row label={he ? "נטו אחרי הוצאות" : "Net after expenses"} value={money(monthSales - monthExp, cur)} strong />
          <Row label={he ? "עבודות היום" : "Jobs today"} value={String(todayJobs.length)} />
        </Card>

        <Card span={3} title={he ? "הצעות מחיר" : "Estimates"}>
          {[["draft", he ? "טיוטה" : "Draft"], ["sent", he ? "נשלחו" : "Sent"], ["approved", he ? "אושרו" : "Approved"], ["rejected", he ? "נדחו" : "Declined"]].map(([k, l]) => (
            <Row key={k} label={l} value={`${estBy(k).length} · ${money(estBy(k).reduce((s, e) => s + e.total_minor, 0), cur)}`} />
          ))}
        </Card>
        <Card span={5} title={he ? "היום" : "Today"}>
          {todayJobs.length === 0 ? <Sub>{he ? "אין עבודות היום" : "No jobs today"}</Sub> : todayJobs.map((j: any, i) => (
            <div key={i} style={rowLine}>
              <b style={{ minWidth: 48 }}>{(j.start_time ?? "").slice(0, 5) || "—"}</b>
              <span style={{ flex: 1 }}>{j.customers?.name ?? "—"} · {j.service}</span>
              <b>{money(j.price_minor, cur)}</b>
            </div>
          ))}
        </Card>
        <Card span={4} title={he ? "בהמשך" : "Coming up"}>
          {upcoming.length === 0 ? <Sub>{he ? "אין עבודות מתוכננות" : "Nothing scheduled"}</Sub> : upcoming.map((j: any, i) => (
            <div key={i} style={rowLine}><span style={{ flex: 1 }}>{j.customers?.name ?? "—"}</span><Sub>{fmtDate(j.scheduled_date)}</Sub></div>
          ))}
        </Card>

        <Card span={8} title={he ? "עבודות אחרונות" : "Recent jobs"}>
          {recent.length === 0 && <div style={{ color: "#5c6675", fontSize: 13, padding: 8 }}>—</div>}
          {recent.map((j: any, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderTop: i ? "1px solid #f1f4f9" : "none" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.customers?.name ?? "—"}</div>
                <div style={{ fontSize: 12.5, color: "#5c6675" }}>{j.service} · {fmtDate(j.scheduled_date)}</div>
              </div>
              <div style={{ textAlign: "end", whiteSpace: "nowrap" }}>
                <b>{money(j.price_minor, cur)}</b>
                <div style={{ marginTop: 3 }}><span style={statusChip(j.status)}>{t(locale, `st.${j.status}`)}</span></div>
              </div>
            </div>
          ))}
        </Card>
        <Card span={4} title={he ? "סוגי עבודות ומקורות מובילים" : "Top job types & sources"}>
          <Sub>{he ? "סוגי עבודות" : "Job types"}</Sub>
          {topType.map(([k, v]) => <Row key={k} label={k} value={String(v)} />)}
          <div style={{ height: 8 }} />
          <Sub>{he ? "מקורות לידים" : "Lead sources"}</Sub>
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
