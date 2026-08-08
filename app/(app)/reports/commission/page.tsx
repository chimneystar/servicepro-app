import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import CommissionClient, { type TechRow } from "@/components/CommissionClient";
// @ts-ignore — shared, unit-tested reporting arithmetic (tests/reporting.test.mjs)
import { collectedMinor } from "@/lib/core/reporting.mjs";
import * as jobsRepo from "@/lib/data/jobs";
import * as invoicesRepo from "@/lib/data/invoices";
import * as paymentsRepo from "@/lib/data/payments";
import * as reporting from "@/lib/data/reporting";

export const dynamic = "force-dynamic";

export default async function CommissionPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const search = await searchParams;
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const supabase = await createClient();
  const now = new Date();
  const from =
    search.from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to =
    search.to || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const [statuses, profiles, { data: org }] = await Promise.all([
    reporting.listJobStatusesForCommission(supabase),
    reporting.listActiveProfilesForCommission(supabase),
    supabase.from("organizations").select("currency").single(),
  ]);
  const doneNames = statuses.filter((s) => s.is_done).map((s) => s.name);
  const doneSet = new Set(doneNames.length ? doneNames : ["Done"]);

  const jobs = await jobsRepo.listForCommission(supabase, from, to);

  // Commission is paid on money COLLECTED, not on what was quoted.
  //
  // This previously summed jobs.price_minor for completed jobs, so a technician
  // earned commission on work the business was never paid for — an unpaid or
  // partly-paid invoice still generated a full payout, and a refund never
  // clawed anything back.
  const completedJobs = jobs.filter(
    (j: any) => (doneSet.has(j.stage) || j.status === "done") && j.assigned_to,
  );
  const jobIds = completedJobs.map((j: any) => j.id);

  // Invoices raised against those jobs, and the settled payments against them.
  const invoiceRows = await invoicesRepo.listByJobIds(supabase, jobIds);
  const invoiceIds = invoiceRows.map((i) => i.id);
  const paymentRows = await paymentsRepo.listCollectedForInvoices(supabase, invoiceIds);
  const jobByInvoice: Record<string, string | null> = {};
  invoiceRows.forEach((i) => {
    jobByInvoice[i.id] = i.job_id;
  });
  const techByJob: Record<string, string> = {};
  completedJobs.forEach((j: any) => {
    techByJob[j.id] = j.assigned_to;
  });

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

  const rows: TechRow[] = profiles
    .filter((p) => agg[p.id])
    .map((p) => ({
      profileId: p.id,
      name: p.full_name || "Technician",
      pct: p.commission_pct ?? 0,
      jobs: agg[p.id].jobs,
      revenueMinor: agg[p.id].revenue,
      expensesMinor: agg[p.id].expenses,
    }))
    .sort((a, b) => b.revenueMinor - a.revenueMinor);

  return (
    <div style={{ maxWidth: 760 }}>
      <Link href="/reports" className="sp-link">
        ‹ Reports
      </Link>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: "8px 0 4px" }}>
        Technician commission
      </h1>
      <p style={{ color: "#5c6675", fontSize: "0.875rem", marginBottom: 12 }}>
        Payroll based on money actually collected on completed jobs, after costs & fees.
      </p>

      <form
        method="get"
        style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "end" }}
      >
        <div>
          <label className="sp-field">
            <span style={lbl}>From</span>
            <input type="date" name="from" defaultValue={from} style={inp} />
          </label>
        </div>
        <div>
          <label className="sp-field">
            <span style={lbl}>To</span>
            <input type="date" name="to" defaultValue={to} style={inp} />
          </label>
        </div>
        <button
          type="submit"
          style={{
            background: "#eef2f8",
            color: "#2563eb",
            border: "none",
            borderRadius: 10,
            padding: "10px 16px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Apply
        </button>
      </form>

      <CommissionClient
        rows={rows}
        currency={org?.currency ?? "USD"}
        canEditPct={profile.role === "owner"}
      />
    </div>
  );
}
const lbl: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 700,
  color: "#334155",
  display: "block",
  marginBottom: 5,
};
const inp: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: "1rem",
  outline: "none",
};
