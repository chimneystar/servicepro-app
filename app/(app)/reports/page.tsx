import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { money } from "@/lib/format";
import { redirect } from "next/navigation";
import Link from "next/link";
// @ts-ignore — shared, unit-tested reporting arithmetic (tests/reporting.test.mjs)
import {
  periodTotals,
  collectedMinor,
  invoiceRevenueExTaxMinor,
  materialsCostMinor,
  COLLECTED_STATUSES,
} from "@/lib/core/reporting.mjs";

export const dynamic = "force-dynamic";

function range(period: string): { start: string; end: string; label: string } {
  const now = new Date(),
    y = now.getFullYear(),
    m = now.getMonth();
  if (period === "year") return { start: `${y}-01-01`, end: `${y}-12-31`, label: String(y) };
  if (period === "all") return { start: "1900-01-01", end: "2999-12-31", label: "All time" };
  const start = new Date(y, m, 1).toISOString().slice(0, 10);
  const end = new Date(y, m + 1, 0).toISOString().slice(0, 10);
  return { start, end, label: now.toLocaleString("en-US", { month: "long", year: "numeric" }) };
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const search = await searchParams;
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const locale = await getLocale();
  const supabase = await createClient();
  const period = search.period ?? "month";
  const { start, end, label } = range(period);

  const { data: org } = await supabase.from("organizations").select("currency").single();
  const cur = org?.currency ?? "USD";

  const { data: invoices } = await supabase
    .from("invoices")
    .select(
      "id, total_minor, discount_minor, tax_rate_bps, issue_date, jobs(assigned_to, profiles!jobs_assigned_to_fkey(full_name))",
    )
    .eq("status", "paid")
    .is("deleted_at", null)
    .gte("issue_date", start)
    .lte("issue_date", end);
  const invs = invoices ?? [];
  const ids = invs.map((i) => i.id);

  let items: any[] = [];
  if (ids.length) {
    const { data } = await supabase
      .from("invoice_items")
      .select("invoice_id, qty_milli, unit_price_minor, cost_minor, taxable")
      .in("invoice_id", ids);
    items = data ?? [];
  }

  // Cash actually received in the period. Revenue used to be the sum of
  // invoices.total_minor for invoices marked paid — what was BILLED, not what
  // arrived. That ignored partial payments, refunds and surcharges, and counted
  // an invoice someone hand-marked paid at full face value.
  const { data: periodPayments } = await supabase
    .from("payments")
    .select("invoice_id, base_amount_minor, amount_minor, refunded_minor, normalized_status")
    .in("normalized_status", COLLECTED_STATUSES)
    .gte("paid_at", `${start}T00:00:00`)
    .lte("paid_at", `${end}T23:59:59`);

  const { data: expenses } = await supabase
    .from("expenses")
    .select("amount_minor")
    .gte("expense_date", start)
    .lte("expense_date", end);
  const { data: unpaid } = await supabase
    .from("invoices")
    .select("total_minor, issue_date")
    .eq("status", "unpaid")
    .is("deleted_at", null)
    .limit(2000);

  // Server request time is intentionally captured once for the aging report.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const buckets = [
    { label: "0–30 days", min: 0, max: 30 },
    { label: "31–60 days", min: 31, max: 60 },
    { label: "61–90 days", min: 61, max: 90 },
    { label: "90+ days", min: 91, max: 999999 },
  ];
  const aging = buckets.map((b) => {
    const rows = (unpaid ?? []).filter((i) => {
      const age = Math.floor((nowMs - new Date(i.issue_date + "T00:00:00").getTime()) / 864e5);
      return age >= b.min && age <= b.max;
    });
    return {
      label: b.label,
      count: rows.length,
      total: rows.reduce((s, i) => s + i.total_minor, 0),
    };
  });
  const agingTotal = (unpaid ?? []).reduce((s, i) => s + i.total_minor, 0);

  const itemsByInvoice: Record<string, any[]> = {};
  items.forEach((it) => {
    (itemsByInvoice[it.invoice_id] ||= []).push(it);
  });

  const totalExp = (expenses ?? []).reduce((s, e) => s + e.amount_minor, 0);

  // All revenue and margin arithmetic lives in lib/core/reporting.mjs so the
  // dashboard, the custom report and the commission report cannot disagree —
  // and so it is unit-tested rather than reasoned about.
  const totals = periodTotals({
    payments: periodPayments ?? [],
    invoices: invs as any[],
    itemsByInvoice,
    expensesMinor: totalExp,
  });
  const revenueCollected = totals.collectedMinor;
  const gross = totals.grossProfitMinor;
  const net = totals.netProfitMinor;

  // Attribute collected cash to the technician on the invoice's job.
  const techByInvoice: Record<string, string> = {};
  invs.forEach((i: any) => {
    techByInvoice[i.id] = i.jobs?.profiles?.full_name || "Unassigned";
  });

  const byTech: Record<string, { collected: number; profit: number; count: number }> = {};
  (periodPayments ?? []).forEach((p: any) => {
    const name = techByInvoice[p.invoice_id] ?? "Unassigned";
    const b = byTech[name] || { collected: 0, profit: 0, count: 0 };
    b.collected += collectedMinor([p]);
    byTech[name] = b;
  });
  invs.forEach((i: any) => {
    const name = techByInvoice[i.id];
    const b = byTech[name] || { collected: 0, profit: 0, count: 0 };
    const invoiceItems = itemsByInvoice[i.id] ?? [];
    b.profit += invoiceRevenueExTaxMinor(i, invoiceItems) - materialsCostMinor(invoiceItems);
    b.count += 1;
    byTech[name] = b;
  });
  const techRows = Object.entries(byTech).sort((a, b) => b[1].collected - a[1].collected);

  const pill = (p: string, l: string) => (
    <Link href={`/reports?period=${p}`} style={{ ...seg, ...(period === p ? segOn : {}) }}>
      {l}
    </Link>
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800 }}>{t(locale, "nav.reports")}</h1>
        <div style={{ display: "flex", background: "#eef2f8", borderRadius: 10, padding: 3 }}>
          {pill("month", "This month")}
          {pill("year", "This year")}
          {pill("all", "All time")}
        </div>
      </div>
      <p style={{ color: "#5c6675", fontSize: "0.8125rem", marginBottom: 12 }}>{label}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <Link
          href="/reports/custom"
          style={{
            background: "#e0ebff",
            color: "#1d4ed8",
            borderRadius: 10,
            padding: "9px 14px",
            fontWeight: 700,
            fontSize: "0.875rem",
            textDecoration: "none",
          }}
        >
          🧩 Custom report
        </Link>
        <Link
          href="/reports/export"
          style={{
            background: "#e6f6ec",
            color: "#15803d",
            borderRadius: 10,
            padding: "9px 14px",
            fontWeight: 700,
            fontSize: "0.875rem",
            textDecoration: "none",
          }}
        >
          ⬇ Accounting export
        </Link>
        <Link
          href="/reports/timesheets"
          style={{
            background: "#fdf1dc",
            color: "#b45309",
            borderRadius: 10,
            padding: "9px 14px",
            fontWeight: 700,
            fontSize: "0.875rem",
            textDecoration: "none",
          }}
        >
          ⏱️ Timesheets
        </Link>
        <Link
          href="/reports/commission"
          style={{
            background: "#ede9fe",
            color: "#7c3aed",
            borderRadius: 10,
            padding: "9px 14px",
            fontWeight: 700,
            fontSize: "0.875rem",
            textDecoration: "none",
          }}
        >
          💵 Commission
        </Link>
        {/* Ledger 6c.9 and 6c.7 — the numbers come to you, and the schedule
            goes to your calendar. */}
        <Link
          href="/reports/schedule"
          style={{
            background: "#e0f2fe",
            color: "#0369a1",
            borderRadius: 10,
            padding: "9px 14px",
            fontWeight: 700,
            fontSize: "0.875rem",
            textDecoration: "none",
          }}
        >
          📧 Emailed reports
        </Link>
        <Link
          href="/reports/calendar"
          style={{
            background: "#f1f5f9",
            color: "#334155",
            borderRadius: 10,
            padding: "9px 14px",
            fontWeight: 700,
            fontSize: "0.875rem",
            textDecoration: "none",
          }}
        >
          📅 Calendar feed
        </Link>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <Kpi
          icon="💰"
          tone="#15803d"
          label="Revenue collected"
          value={money(revenueCollected, cur)}
        />
        <Kpi
          icon="📊"
          tone="#2563eb"
          label="Gross profit (ex-tax − materials)"
          value={money(gross, cur)}
        />
        <Kpi icon="💸" tone="#b45309" label="Expenses" value={money(totalExp, cur)} />
        <Kpi
          icon="✅"
          tone={net >= 0 ? "#15803d" : "#dc2626"}
          label="Net profit"
          value={money(net, cur)}
        />
      </div>

      <div style={{ fontWeight: 800, fontSize: "1rem", margin: "4px 4px 10px" }}>
        Sales by technician
      </div>
      <div className="rlist">
        {techRows.map(([name, b]) => (
          <div className="ritem" key={name}>
            <div className="rmain">
              <div className="rtitle">{name}</div>
              <div className="rsub">
                {b.count} paid · {b.collected ? Math.round((b.profit / b.collected) * 100) : 0}%
                margin
              </div>
            </div>
            <div className="rend">
              <b style={{ fontSize: "0.9375rem" }}>{money(b.collected, cur)}</b>
              <span
                style={{
                  fontSize: "0.8125rem",
                  fontWeight: 700,
                  color: b.profit >= 0 ? "#15803d" : "#dc2626",
                }}
              >
                {money(b.profit, cur)} profit
              </span>
            </div>
          </div>
        ))}
        {techRows.length === 0 && <div className="rempty">No paid invoices in this period.</div>}
      </div>

      <div style={{ fontWeight: 800, fontSize: "1rem", margin: "20px 4px 10px" }}>
        Aging — unpaid invoices ({money(agingTotal, cur)})
      </div>
      <div className="rlist">
        {aging.map((b) => (
          <div className="ritem" key={b.label}>
            <div className="rmain">
              <div className="rtitle">{b.label}</div>
              <div className="rsub">
                {b.count} invoice{b.count === 1 ? "" : "s"}
              </div>
            </div>
            <div className="rend">
              <b
                style={{
                  fontSize: "0.9375rem",
                  color: b.label.startsWith("90+") && b.total > 0 ? "#dc2626" : "#0b1524",
                }}
              >
                {money(b.total, cur)}
              </b>
            </div>
          </div>
        ))}
        {agingTotal === 0 && <div className="rempty">No unpaid invoices 🎉</div>}
      </div>

      <div
        style={{
          background: "#e0ebff",
          color: "#1d4ed8",
          padding: "11px 14px",
          borderRadius: 12,
          fontSize: "0.8125rem",
          marginTop: 4,
        }}
      >
        ℹ️ Profit uses the <b>cost</b> you enter per line item. Add costs on estimates/invoices (and
        later in the Price Book) to make profitability precise.
      </div>
    </div>
  );
}

function Kpi({
  icon,
  tone,
  label,
  value,
}: {
  icon: string;
  tone: string;
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 14,
        padding: 16,
        boxShadow: "0 6px 18px rgba(15,42,94,.06)",
      }}
    >
      <div style={{ fontSize: "1.375rem" }}>{icon}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 800, color: tone, marginTop: 6 }}>{value}</div>
      <div style={{ fontSize: "0.8125rem", color: "#5c6675", fontWeight: 600 }}>{label}</div>
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 14,
        boxShadow: "0 6px 18px rgba(15,42,94,.06)",
        marginBottom: 16,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid #eef1f6",
          fontWeight: 800,
          fontSize: "0.9375rem",
        }}
      >
        {title}
      </div>
      <div style={{ padding: "6px 18px 14px" }}>{children}</div>
    </div>
  );
}
function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: "10px 8px",
        borderBottom: "2px solid #e2e8f0",
        fontWeight: 700,
        textAlign: "start",
      }}
    >
      {children}
    </th>
  );
}
function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: "11px 8px", textAlign: "start", ...style }}>{children}</td>;
}
const seg: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 8,
  fontWeight: 700,
  fontSize: "0.8125rem",
  color: "#5c6675",
  textDecoration: "none",
};
const segOn: React.CSSProperties = {
  background: "#fff",
  color: "#0b1524",
  boxShadow: "0 1px 3px rgba(0,0,0,.12)",
};
