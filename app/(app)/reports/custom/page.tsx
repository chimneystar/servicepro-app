import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";
import { redirect } from "next/navigation";
import Link from "next/link";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const ALL = [
  ["sales", "Sales summary"], ["profit", "Profit & loss"], ["tech", "Sales by technician"],
  ["aging", "Aging invoices"], ["expenses", "Expenses"],
] as const;

const itemRev = (it: any) => Math.round((it.qty_milli * it.unit_price_minor) / 1000);
const itemCost = (it: any) => Math.round((it.qty_milli * (it.cost_minor ?? 0)) / 1000);

export default async function CustomReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; sec?: string | string[] }> }) {
  const search = await searchParams;
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const supabase = await createClient();

  const now = new Date();
  const from = search.from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = search.to || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const secParam = search.sec;
  const selected = new Set(secParam == null ? ALL.map((s) => s[0]) : Array.isArray(secParam) ? secParam : [secParam]);

  const { data: org } = await supabase.from("organizations").select("currency, name").single();
  const cur = org?.currency ?? "USD";

  const { data: paid } = await supabase.from("invoices")
    .select("id, total_minor, jobs(profiles!jobs_assigned_to_fkey(full_name))")
    .eq("status", "paid").is("deleted_at", null).gte("issue_date", from).lte("issue_date", to);
  const invs = paid ?? [];
  const ids = invs.map((i) => i.id);
  let items: any[] = [];
  if (ids.length) { const { data } = await supabase.from("invoice_items").select("invoice_id, qty_milli, unit_price_minor, cost_minor").in("invoice_id", ids); items = data ?? []; }
  const { data: exp } = await supabase.from("expenses").select("amount_minor, category, expense_date").gte("expense_date", from).lte("expense_date", to);
  const { data: unpaid } = await supabase.from("invoices").select("total_minor, issue_date").eq("status", "unpaid").is("deleted_at", null);

  const revenue = invs.reduce((s, i) => s + i.total_minor, 0);
  const totalItemRev = items.reduce((s, it) => s + itemRev(it), 0);
  const totalItemCost = items.reduce((s, it) => s + itemCost(it), 0);
  const totalExp = (exp ?? []).reduce((s, e) => s + e.amount_minor, 0);
  const gross = totalItemRev - totalItemCost;

  const revByInv: Record<string, number> = {}, costByInv: Record<string, number> = {};
  items.forEach((it) => { revByInv[it.invoice_id] = (revByInv[it.invoice_id] || 0) + itemRev(it); costByInv[it.invoice_id] = (costByInv[it.invoice_id] || 0) + itemCost(it); });
  const byTech: Record<string, { collected: number; profit: number; count: number }> = {};
  invs.forEach((i: any) => { const n = i.jobs?.profiles?.full_name || "Unassigned"; const b = byTech[n] || { collected: 0, profit: 0, count: 0 }; b.collected += i.total_minor; b.profit += (revByInv[i.id] || 0) - (costByInv[i.id] || 0); b.count++; byTech[n] = b; });

  const nowMs = Date.now();
  const buckets = [["0–30 days", 0, 30], ["31–60 days", 31, 60], ["61–90 days", 61, 90], ["90+ days", 91, 9e9]] as const;
  const aging = buckets.map(([label, min, max]) => { const rows = (unpaid ?? []).filter((i) => { const age = Math.floor((nowMs - new Date(i.issue_date + "T00:00:00").getTime()) / 864e5); return age >= min && age <= max; }); return { label, total: rows.reduce((s, i) => s + i.total_minor, 0), count: rows.length }; });
  const byCat: Record<string, number> = {}; (exp ?? []).forEach((e) => byCat[e.category] = (byCat[e.category] || 0) + e.amount_minor);

  const chk = (k: string) => selected.has(k);

  return (
    <div style={{ maxWidth: 780 }}>
      <Link href="/reports" style={{ color: "#2563eb", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>‹ Reports</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, margin: "8px 0 14px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>Custom report</h1>
        <PrintButton label="Save as PDF" />
      </div>

      {/* Builder */}
      <form method="get" className="no-print" style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 16, marginBottom: 18, boxShadow: "0 6px 18px rgba(15,42,94,.06)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div><label style={lbl}>From</label><input type="date" name="from" defaultValue={from} style={inp} /></div>
          <div><label style={lbl}>To</label><input type="date" name="to" defaultValue={to} style={inp} /></div>
        </div>
        <label style={lbl}>Include sections</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "6px 0 12px" }}>
          {ALL.map(([k, label]) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
              <input type="checkbox" name="sec" value={k} defaultChecked={selected.has(k)} style={{ width: 18, height: 18 }} /> {label}
            </label>
          ))}
        </div>
        <button type="submit" style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 10, padding: "11px 18px", fontWeight: 800, cursor: "pointer" }}>Generate report</button>
      </form>

      {/* Report */}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 22 }} className="print-card">
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{org?.name}</div>
          <div style={{ color: "#5c6675", fontSize: 13 }}>Report · {fmt(from)} – {fmt(to)}</div>
        </div>

        {chk("sales") && <Section title="Sales summary">
          <KV label="Revenue collected" value={money(revenue, cur)} />
          <KV label="Paid invoices" value={String(invs.length)} />
          <KV label="Average invoice" value={money(invs.length ? Math.round(revenue / invs.length) : 0, cur)} />
        </Section>}

        {chk("profit") && <Section title="Profit & loss">
          <KV label="Item revenue" value={money(totalItemRev, cur)} />
          <KV label="Item cost" value={money(totalItemCost, cur)} />
          <KV label="Gross profit" value={money(gross, cur)} />
          <KV label="Expenses" value={money(totalExp, cur)} />
          <KV label="Net profit" value={money(gross - totalExp, cur)} strong />
        </Section>}

        {chk("tech") && <Section title="Sales by technician">
          {Object.entries(byTech).sort((a, b) => b[1].collected - a[1].collected).map(([n, b]) => (
            <KV key={n} label={`${n} (${b.count})`} value={`${money(b.collected, cur)} · ${money(b.profit, cur)} profit`} />
          ))}
          {Object.keys(byTech).length === 0 && <Empty />}
        </Section>}

        {chk("aging") && <Section title="Aging — unpaid invoices">
          {aging.map((b) => <KV key={b.label} label={`${b.label} (${b.count})`} value={money(b.total, cur)} />)}
        </Section>}

        {chk("expenses") && <Section title="Expenses by category">
          {Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => <KV key={c} label={c} value={money(v, cur)} />)}
          {Object.keys(byCat).length === 0 && <Empty />}
        </Section>}

        {selected.size === 0 && <div style={{ textAlign: "center", color: "#5c6675", padding: 20 }}>Select at least one section above.</div>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 18 }}><h3 style={{ fontSize: 15, fontWeight: 800, borderBottom: "2px solid #0f2a5e", paddingBottom: 6, marginBottom: 8 }}>{title}</h3>{children}</div>;
}
function KV({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f4f9", fontSize: 14 }}><span style={{ color: "#334155" }}>{label}</span><b style={{ color: strong ? "#15803d" : "#0b1524" }}>{value}</b></div>;
}
function Empty() { return <div style={{ color: "#5c6675", fontSize: 13, padding: "6px 0" }}>No data in this period.</div>; }
function fmt(iso: string) { const d = new Date(iso + "T00:00:00"); return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`; }
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", marginBottom: 5 };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none" };
