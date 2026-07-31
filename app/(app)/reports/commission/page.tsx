import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import CommissionClient, { type TechRow } from "@/components/CommissionClient";
// @ts-ignore — shared, unit-tested reporting arithmetic (tests/reporting.test.mjs)
import { collectedMinor, COLLECTED_STATUSES } from "@/lib/core/reporting.mjs";

export const dynamic = "force-dynamic";

export default async function CommissionPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const search = await searchParams;
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const supabase = await createClient();
  const now = new Date();
  const from = search.from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = search.to || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const [{ data: statuses }, { data: profiles }, { data: org }] = await Promise.all([
    supabase.from("job_statuses").select("name, is_done"),
    supabase.from("profiles").select("id, full_name, commission_pct").eq("active", true),
    supabase.from("organizations").select("currency").single(),
  ]);
  const doneNames = (statuses ?? []).filter((s) => s.is_done).map((s) => s.name);
  const doneSet = new Set(doneNames.length ? doneNames : ["Done"]);

  const { data: jobs } = await supabase.from("jobs")
    .select("id, assigned_to, price_minor, job_expenses_minor, stage, status, scheduled_date")
    .is("deleted_at", null).gte("scheduled_date", from).lte("scheduled_date", to);

  // Commission is paid on money COLLECTED, not on what was quoted.
  //
  // This previously summed jobs.price_minor for completed jobs, so a technician
  // earned commission on work the business was never paid for — an unpaid or
  // partly-paid invoice still generated a full payout, and a refund never
  // clawed anything back.
  const completedJobs = (jobs ?? []).filter((j: any) => (doneSet.has(j.stage) || j.status === "done") && j.assigned_to);
  const jobIds = completedJobs.map((j: any) => j.id);

  // Invoices raised against those jobs, and the settled payments against them.
  let invoiceRows: any[] = [], paymentRows: any[] = [];
  if (jobIds.length) {
    const { data: invs } = await supabase.from("invoices").select("id, job_id").in("job_id", jobIds).is("deleted_at", null);
    invoiceRows = invs ?? [];
    const invoiceIds = invoiceRows.map((i) => i.id);
    if (invoiceIds.length) {
      const { data: pays } = await supabase.from("payments")
        .select("invoice_id, base_amount_minor, amount_minor, refunded_minor, normalized_status")
        .in("invoice_id", invoiceIds)
        .in("normalized_status", COLLECTED_STATUSES);
      paymentRows = pays ?? [];
    }
  }
  const jobByInvoice: Record<string, string> = {};
  invoiceRows.forEach((i) => { jobByInvoice[i.id] = i.job_id; });
  const techByJob: Record<string, string> = {};
  completedJobs.forEach((j: any) => { techByJob[j.id] = j.assigned_to; });

  const agg: Record<string, { revenue: number; expenses: number; jobs: number }> = {};
  completedJobs.forEach((j: any) => {
    const a = (agg[j.assigned_to] ??= { revenue: 0, expenses: 0, jobs: 0 });
    a.expenses += j.job_expenses_minor ?? 0;
    a.jobs += 1;
  });
  paymentRows.forEach((p: any) => {
    const tech = techByJob[jobByInvoice[p.invoice_id] ?? ""];
    if (!tech) return;
    const a = (agg[tech] ??= { revenue: 0, expenses: 0, jobs: 0 });
    a.revenue += collectedMinor([p]);
  });

  const rows: TechRow[] = (profiles ?? [])
    .filter((p) => agg[p.id])
    .map((p) => ({ profileId: p.id, name: p.full_name || "Technician", pct: p.commission_pct ?? 0, jobs: agg[p.id].jobs, revenueMinor: agg[p.id].revenue, expensesMinor: agg[p.id].expenses }))
    .sort((a, b) => b.revenueMinor - a.revenueMinor);

  return (
    <div style={{ maxWidth: 760 }}>
      <Link href="/reports" style={{ color: "#2563eb", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>‹ Reports</Link>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: "8px 0 4px" }}>Technician commission</h1>
      <p style={{ color: "#5c6675", fontSize: 13, marginBottom: 12 }}>Payroll based on money actually collected on completed jobs, after costs & fees.</p>

      <form method="get" style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "end" }}>
        <div><label style={{ display: "block" }}><span style={lbl}>From</span><input type="date" name="from" defaultValue={from} style={inp} /></label></div>
        <div><label style={{ display: "block" }}><span style={lbl}>To</span><input type="date" name="to" defaultValue={to} style={inp} /></label></div>
        <button type="submit" style={{ background: "#eef2f8", color: "#2563eb", border: "none", borderRadius: 10, padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}>Apply</button>
      </form>

      <CommissionClient rows={rows} currency={org?.currency ?? "USD"} canEditPct={profile.role === "owner"} />
    </div>
  );
}
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", marginBottom: 5 };
const inp: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 16, outline: "none" };
