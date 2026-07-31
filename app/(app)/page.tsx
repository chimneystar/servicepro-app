import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { money, todayISO, monthBounds, fmtDate } from "@/lib/format";
// @ts-ignore — pure date arithmetic, unit-tested by node:test.
import { monthsBack, isTruncated } from "@/lib/core/query-window.mjs";
import { Donut, Bars, Legend } from "@/components/MiniCharts";
import SetupChecklist, { type Step } from "@/components/SetupChecklist";
import Link from "next/link";
import { redirect } from "next/navigation";
// @ts-ignore — shared, unit-tested reporting arithmetic (tests/reporting.test.mjs)
import { collectedMinor, COLLECTED_STATUSES } from "@/lib/core/reporting.mjs";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/tech");
  if (profile.role === "office") redirect("/dispatch");
  const locale = (await getLocale());
  const he = locale === "he";
  const supabase = await createClient();
  const { start, end } = monthBounds();
  const today = todayISO();
  const past14Date = new Date(`${today}T12:00:00Z`);
  past14Date.setUTCDate(past14Date.getUTCDate() - 14);
  const past14 = past14Date.toISOString().slice(0, 10);

  // THE BUG: this page read EVERY invoice, estimate, expense, job and lead in
  // the organisation with no date filter, aggregated them in JavaScript, and did
  // it on every single load because the route is force-dynamic. The screen only
  // ever shows a rolling window (this month, the last six months, what is on
  // today, what is coming up) plus the open receivables, so that is what is now
  // asked for. Anything still open — an unpaid invoice, a live estimate — is
  // fetched regardless of age, because those must never fall off the edge.
  const windowStart: string = monthsBack(today, 12);
  const ROW_CEILING = 2000, JOB_CEILING = 1000;

  const [{ data: org }, { data: invoices }, { data: estimates }, { data: expenses }, { data: jobs }, { count: custCount }, { count: openLeadCount }, { count: newLeadCount }, { count: estimateCount }, { count: jobCount }, { data: windowPayments }] = await Promise.all([
    supabase.from("organizations").select("currency, logo_url, tax_rate_bps, review_url, onboarding_dismissed").single(),
    supabase.from("invoices").select("id, number, status, total_minor, issue_date").is("deleted_at", null)
      .or(`status.eq.unpaid,issue_date.gte.${windowStart}`)
      .order("issue_date", { ascending: false }).limit(ROW_CEILING),
    supabase.from("estimates").select("id, number, status, total_minor, issue_date").is("deleted_at", null)
      .or(`status.in.(draft,sent),issue_date.gte.${windowStart}`)
      .order("issue_date", { ascending: false }).limit(ROW_CEILING),
    // Only this month's expenses are displayed, so only this month is read.
    supabase.from("expenses").select("amount_minor, expense_date").gte("expense_date", start).lte("expense_date", end).limit(ROW_CEILING),
    supabase.from("jobs").select("id, assigned_to, service, source, status, price_minor, scheduled_date, start_time, customer_id, customers(name)")
      .is("deleted_at", null).gte("scheduled_date", windowStart)
      .order("scheduled_date", { ascending: false }).limit(JOB_CEILING),
    supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("archived", false),
    // Leads were only ever counted here, never listed — so count them in SQL.
    supabase.from("leads").select("id", { count: "exact", head: true }).not("status", "in", "(won,lost)"),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "new"),
    // Exact, age-independent counts for the setup checklist, which asks "have
    // you ever…" and must not be answered from a rolling window.
    supabase.from("estimates").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("jobs").select("id", { count: "exact", head: true }).is("deleted_at", null),
    // Money RECEIVED in the window. The Collections card previously summed
    // invoices.total_minor for invoices marked paid — what was BILLED, not what
    // arrived. Same defect that was fixed in /reports; the dashboard has its own
    // copy of the calculation, so fixing one screen left this one wrong.
    supabase.from("payments")
      .select("base_amount_minor, amount_minor, refunded_minor, normalized_status, paid_at")
      .in("normalized_status", COLLECTED_STATUSES)
      .gte("paid_at", `${windowStart}T00:00:00`)
      .limit(ROW_CEILING),
  ]);
  const openLeads = openLeadCount ?? 0;

  // Onboarding checklist (owner only, until dismissed / complete)
  const steps: Step[] = [
    { label: he ? "הוספת לוגו לעסק" : "Add your business logo", done: !!org?.logo_url, href: "/settings" },
    { label: he ? "הגדרת שיעור המס" : "Set your sales-tax rate", done: (org?.tax_rate_bps ?? 0) > 0, href: "/settings" },
    { label: he ? "הוספת הלקוח הראשון" : "Add your first customer", done: (custCount ?? 0) > 0, href: "/customers" },
    { label: he ? "יצירת הצעת המחיר הראשונה" : "Create your first estimate", done: (estimateCount ?? 0) > 0, href: "/estimates" },
    { label: he ? "שיבוץ העבודה הראשונה" : "Schedule your first job", done: (jobCount ?? 0) > 0, href: "/schedule" },
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
  // Cash actually RECEIVED in the window, net of refunds and excluding declined
  // and in-flight payments. Shared with /reports via lib/core/reporting.mjs so
  // the two screens cannot disagree about what "collected" means.
  //
  // It covers the loaded window, not all time, and the card label says so — a
  // rolling figure presented as an all-time one would be a lie, and this page
  // cannot read every payment ever taken to produce the latter.
  const collected12 = collectedMinor(windowPayments ?? []);
  const monthExp = exp.reduce((s, e) => s + e.amount_minor, 0);
  const windowLabel = he ? "ב-12 החודשים האחרונים" : "last 12 months";
  const truncated: boolean = isTruncated(inv.length, ROW_CEILING) || isTruncated(est.length, ROW_CEILING) || isTruncated(jb.length, JOB_CEILING);

  const estBy = (st: string) => est.filter((e) => e.status === st);
  const wonN = estBy("approved").length, lostN = estBy("rejected").length;
  const winRate = wonN + lostN > 0 ? Math.round((wonN / (wonN + lostN)) * 100) : 0;

  // 6-month revenue series + paid-vs-due donut.
  //
  // Built from PAYMENTS, not from invoice totals. The card is titled "Revenue",
  // so it must show money received: an invoice marked paid by hand, or one whose
  // card was later declined, is not revenue. This was the third copy of the same
  // billed-versus-received mistake (the others were /reports and the Collections
  // card above) — all three now share lib/core/reporting.mjs.
  const base = new Date();
  const series = Array.from({ length: 6 }, (_, k) => {
    const dt = new Date(base.getFullYear(), base.getMonth() - (5 - k), 1);
    const ym = dt.toISOString().slice(0, 7);
    const inMonth = (windowPayments ?? []).filter((p: any) => String(p.paid_at ?? "").slice(0, 7) === ym);
    return { label: dt.toLocaleString(he ? "he-IL" : "en-US", { month: "short" }), value: Math.round(collectedMinor(inMonth) / 100) };
  });
  const collectRate = collected12 + dueSum > 0 ? Math.round((collected12 / (collected12 + dueSum)) * 100) : 0;
  const todayJobs = jb.filter((j) => j.scheduled_date === today).sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));
  const upcoming = jb.filter((j) => j.scheduled_date >= today && j.status === "scheduled")
    .sort((a, b) => (a.scheduled_date + (a.start_time ?? "")).localeCompare(b.scheduled_date + (b.start_time ?? ""))).slice(0, 5);
  const recent = jb.slice().sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date)).slice(0, 6);

  const byType: Record<string, number> = {}; jb.forEach((j) => { byType[j.service] = (byType[j.service] || 0) + 1; });
  const topType = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const bySrc: Record<string, number> = {}; jb.forEach((j) => { if (j.source) bySrc[j.source] = (bySrc[j.source] || 0) + 1; });
  const topSrc = Object.entries(bySrc).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const srcMax = Math.max(...topSrc.map((s) => s[1]), 1);
  const unassigned = jb.filter((job: any) => !job.assigned_to && job.status !== "cancelled" && job.scheduled_date >= today);
  const waitingEstimates = est.filter((estimate: any) => estimate.status === "sent");
  const newLeadsTotal = newLeadCount ?? 0;
  const nextAssigned = jb.filter((job: any) => job.assigned_to === profile.id && job.status !== "cancelled" && job.status !== "done" && job.scheduled_date >= today).sort((a: any,b: any)=>(a.scheduled_date+(a.start_time??"")).localeCompare(b.scheduled_date+(b.start_time??"")))[0] as any;
  const focus = profile.role === "owner"
    ? { eyebrow: he ? "ממתין לגבייה" : "Waiting to be collected", title: money(dueSum, cur), copy: he ? `${unpaid.length} חשבוניות פתוחות, מהן ${pastDue.length} באיחור.` : `${unpaid.length} open invoices, including ${pastDue.length} past due.`, href: "/invoices?filter=unpaid", action: he ? "לחשבוניות הפתוחות" : "Open invoices" }
    : profile.role === "office"
      ? { eyebrow: he ? "צריך לשבץ" : "Needs dispatch", title: he ? `${unassigned.length} עבודות ללא שיבוץ` : `${unassigned.length} unassigned jobs`, copy: he ? "פותחים את לוח השיבוץ ומחברים את העבודה לאדם הנכון." : "Open dispatch and put the right person on each job.", href: "/dispatch", action: he ? "ללוח השיבוץ" : "Open dispatch" }
      : { eyebrow: he ? "העבודה הבאה" : "Your next stop", title: nextAssigned ? `${(nextAssigned.start_time??"").slice(0,5)||"—"} · ${nextAssigned.customers?.name??nextAssigned.service}` : (he ? "אין עבודה נוספת" : "No next job"), copy: nextAssigned ? `${nextAssigned.service} · ${fmtDate(nextAssigned.scheduled_date)}` : (he ? "אפשר לבדוק שהסנכרון מעודכן או לפנות למשרד." : "Check sync status or contact the office if you expect an assignment."), href: nextAssigned ? `/jobs/${nextAssigned.id}` : "/tech", action: nextAssigned ? (he ? "לפרטי העבודה" : "Open job") : (he ? "ליום העבודה" : "My workday") };
  const attention = [
    ...(pastDue.length ? [{ tone:"danger", title: he ? `${pastDue.length} חשבוניות באיחור` : `${pastDue.length} past-due invoices`, copy: money(pastDueSum,cur), href:"/invoices?filter=unpaid" }] : []),
    ...(unassigned.length ? [{ tone:"warning", title: he ? `${unassigned.length} עבודות ללא שיבוץ` : `${unassigned.length} jobs need dispatch`, copy: he ? "העבודה הקרובה מחכה לאיש צוות" : "Upcoming work is waiting for a team member", href:"/dispatch" }] : []),
    ...(newLeadsTotal ? [{ tone:"blue", title: he ? `${newLeadsTotal} לידים חדשים` : `${newLeadsTotal} new leads`, copy: he ? "כדאי לחזור אליהם לפני שימשיכו הלאה" : "Respond before they move on", href:"/leads" }] : []),
    ...(waitingEstimates.length ? [{ tone:"blue", title: he ? `${waitingEstimates.length} הצעות מחכות לתשובה` : `${waitingEstimates.length} estimates await a decision`, copy: he ? "אפשר לקבוע מעקב מהיר" : "Schedule a clear follow-up", href:"/growth" }] : []),
  ].slice(0,4);

  return (
    <div className="dashboard-experience">
      <section className="dashboard-hero"><div><span className="dashboard-live"><i />{new Intl.DateTimeFormat(he?"he-IL":"en-US",{weekday:"long",month:"long",day:"numeric"}).format(new Date())}</span><h1>{t(locale, "dash.greeting", { name: profile.full_name || "👋" })}</h1><p>{profile.role==="owner"?(he?"העסק מול העיניים. מתחילים במה שהכי חשוב.":"Start with what needs your attention, then review the numbers."):profile.role==="office"?(he?"השיבוץ והלקוחות מסודרים לפי מה שצריך לקרות עכשיו.":"Dispatch and customer work are ordered by what happens next."):(he?"כל מה שצריך לעבודה הבאה נמצא כאן.":"Everything for your next stop is ready here.")}</p></div><article className="dashboard-focus"><span>{focus.eyebrow}</span><strong>{focus.title}</strong><p>{focus.copy}</p><Link href={focus.href}>{focus.action}<b>→</b></Link></article></section>

      {showChecklist && <SetupChecklist steps={steps} />}

      {truncated && (
        <div role="status" style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", borderRadius: 12, padding: "10px 14px", fontSize: "0.8125rem", marginBottom: 12 }}>
          {he
            ? "יש יותר רשומות ממה שנטען לעמוד הזה, ולכן חלק מהמספרים כאן חלקיים. הדוחות המלאים נמצאים במסך הדוחות."
            : "This business has more records than this page loads, so some figures here are partial. Reports has the complete numbers."}
        </div>
      )}

      <section className="dashboard-now"><JobPulse jobs={todayJobs as any[]} he={he}/><AttentionQueue rows={attention} he={he}/></section>

      <div className="scroll-x" style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {[["/schedule", he ? "עבודה חדשה" : "New job"], ["/estimates", he ? "הצעות מחיר" : "Estimates"], ["/invoices", he ? "חשבוניות" : "Invoices"], ["/leads", he ? "לידים" : "Leads"], ["/route", he ? "המסלול של היום" : "Today’s route"], ["/messages", he ? "הודעות" : "Messages"], ["/reports", he ? "דוחות" : "Reports"]].map(([href, label]) => (
          <Link key={href} href={href} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 13px", fontWeight: 700, fontSize: "0.8125rem", color: "#0b1524", textDecoration: "none", whiteSpace: "nowrap" }}>{label}</Link>
        ))}
      </div>

      <div className="dash" style={grid}>
        <Card span={8} title={he ? "הכנסות · ששת החודשים האחרונים" : "Revenue · last 6 months"}>
          <Bars data={series} />
        </Card>
        <Card span={4} title={he ? `גבייה · ${windowLabel}` : `Collections · ${windowLabel}`}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <Donut segments={[{ value: collected12, color: "#15803d" }, { value: dueSum, color: "#f59e0b" }]} centerTop={`${collectRate}%`} centerSub={he ? "נגבה" : "collected"} />
            <Legend items={[{ label: he ? "שולם" : "Paid", color: "#15803d", value: money(collected12, cur) }, { label: he ? "לתשלום" : "Due", color: "#f59e0b", value: money(dueSum, cur) }]} />
          </div>
        </Card>

        <Card span={4} title={he ? "צבר מכירות" : "Pipeline"}>
          <Row label={he ? "לידים פתוחים" : "Open leads"} value={String(openLeads)} />
          <Row label={he ? "אחוז הצעות שאושרו" : "Estimate win rate"} value={`${winRate}%`} strong />
          <Row label={he ? "אושרו / נדחו" : "Approved / Declined"} value={`${wonN} / ${lostN}`} />
        </Card>
        <Card span={4} title={he ? "מכירות · החודש" : "Sales · this month"}>
          <Big>{money(monthSales, cur)}</Big>
          <Sub>{he ? `${paid.length} חשבוניות שולמו · ${money(collected12, cur)} ${windowLabel}` : `${paid.length} paid invoices · ${money(collected12, cur)} in the ${windowLabel}`}</Sub>
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
          {recent.length === 0 && <div style={{ color: "#5c6675", fontSize: "0.8125rem", padding: 8 }}>—</div>}
          {recent.map((j: any, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderTop: i ? "1px solid #f1f4f9" : "none" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "0.875rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.customers?.name ?? "—"}</div>
                <div style={{ fontSize: "0.8125rem", color: "#5c6675" }}>{j.service} · {fmtDate(j.scheduled_date)}</div>
              </div>
              <div style={{ textAlign: "end", whiteSpace: "nowrap" }}>
                <b>{money(j.price_minor, cur)}</b>
                <div style={{ marginTop: 3 }}><span style={statusChip(j.status)}>{t(locale, `st.${j.status}`)}</span></div>
              </div>
            </div>
          ))}
        </Card>
        <Card span={4} title={he ? `סוגי עבודות ומקורות מובילים · ${windowLabel}` : `Top job types & sources · ${windowLabel}`}>
          <Sub>{he ? "סוגי עבודות" : "Job types"}</Sub>
          {topType.map(([k, v]) => <Row key={k} label={k} value={String(v)} />)}
          <div style={{ height: 8 }} />
          <Sub>{he ? "מקורות לידים" : "Lead sources"}</Sub>
          {topSrc.map(([k, v]) => (
            <div key={k} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem" }}><b>{k}</b><b>{v}</b></div>
              <div style={{ height: 6, background: "#eef1f6", borderRadius: 5, overflow: "hidden" }}><i style={{ display: "block", height: "100%", width: `${v / srcMax * 100}%`, background: "linear-gradient(90deg,#2563eb,#38bdf8)" }} /></div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(12,1fr)", gap: 14 };
function JobPulse({ jobs, he }: { jobs: any[]; he: boolean }) {
  return <article className="job-pulse"><header><div><span>{he?"מה קורה היום":"Today’s job pulse"}</span><h2>{he?"מה הסתיים, מה הבא ומה מחכה":"Done, next, and coming up"}</h2></div><Link href="/schedule">{he?"לכל היומן":"Full schedule"}</Link></header><div className="job-pulse-track">{jobs.length?jobs.slice(0,7).map((job,index)=>{const done=job.status==="done",active=!done&&index===jobs.findIndex((row)=>row.status!=="done"&&row.status!=="cancelled");return <Link href={`/jobs/${job.id}`} key={job.id} className={`${done?"done":""}${active?" active":""}`}><i>{done?"✓":index+1}</i><b>{(job.start_time??"").slice(0,5)||"—"}</b><strong>{job.customers?.name??job.service}</strong><small>{job.service}</small></Link>}):<div className="job-pulse-empty">{he?"אין עבודות היום. אפשר לפתוח את היומן ולהוסיף עבודה.":"No jobs today. Open the schedule to add one."}</div>}</div></article>;
}
function AttentionQueue({rows,he}:{rows:{tone:string;title:string;copy:string;href:string}[];he:boolean}){return <aside className="dashboard-attention"><header><div><span>{he?"צריך טיפול":"Needs attention"}</span><h2>{he?"מה לא כדאי לפספס":"Don’t let these wait"}</h2></div><b>{rows.length}</b></header>{rows.length?rows.map((row,index)=><Link href={row.href} key={`${row.href}-${index}`}><i className={row.tone}/><span><strong>{row.title}</strong><small>{row.copy}</small></span><b>›</b></Link>):<div className="dashboard-all-clear"><span>✓</span>{he?"אין כרגע דברים דחופים.":"Nothing urgent right now."}</div>}</aside>}
function Card({ span, title, children }: { span: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ gridColumn: `span ${span}`, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 16, boxShadow: "0 6px 18px rgba(15,42,94,.06)", minWidth: 0 }}>
      <div style={{ fontSize: "0.875rem", fontWeight: 800, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}
function Big({ children, small }: { children: React.ReactNode; small?: boolean }) { return <div style={{ fontSize: small ? "1.375rem" : "1.75rem", fontWeight: 800, letterSpacing: "-.3px" }}>{children}</div>; }
function Sub({ children }: { children: React.ReactNode }) { return <div style={{ fontSize: "0.8125rem", color: "#5c6675", fontWeight: 600 }}>{children}</div>; }
function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f4f9", fontSize: "0.875rem" }}><span style={{ color: "#5c6675" }}>{label}</span><b style={{ color: strong ? "#15803d" : "#0b1524" }}>{value}</b></div>;
}
const rowLine: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #f1f4f9", fontSize: "0.875rem" };
function Td({ children }: { children: React.ReactNode }) { return <td style={{ padding: "9px 6px", textAlign: "start" }}>{children}</td>; }
function statusChip(s: string): React.CSSProperties {
  const map: Record<string, string> = { scheduled: "#e0ebff|#2563eb", in_progress: "#fdf1dc|#b45309", done: "#e6f6ec|#15803d", cancelled: "#eef1f6|#57606f" };
  const [bg, fg] = (map[s] ?? "#eef1f6|#57606f").split("|");
  return { background: bg, color: fg, padding: "3px 9px", borderRadius: 20, fontSize: "0.8125rem", fontWeight: 700 };
}
