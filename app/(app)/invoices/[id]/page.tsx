import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";
import Link from "next/link";
import DocView, { type ViewItem } from "@/components/DocView";
import DocDetailActions from "@/components/DocDetailActions";
import PrintButton from "@/components/PrintButton";
// @ts-ignore
import { computeDocument } from "@/lib/core/money.mjs";
import ActivityTimeline from "@/components/ActivityTimeline";
import { loadActivity } from "@/lib/activity";
import { getLocale } from "@/lib/locale-server";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireProfile();
  const locale = await getLocale();
  const supabase = await createClient();
  const { data: inv } = await supabase.from("invoices")
    .select("id, number, status, discount_minor, tax_rate_bps, issue_date, notes, public_token, customers(name, address, city, phone, email)")
    .eq("id", id).is("deleted_at", null).maybeSingle();
  const { data: org } = await supabase.from("organizations").select("name, logo_url, tagline, phone, email, currency, tax_label, accent_color").single();
  if (!inv) return <div><Link href="/invoices" style={back}>‹ Invoices</Link><div style={{ padding: 40, textAlign: "center", color: "#5c6675" }}>Invoice not found.</div></div>;
  const activity = await loadActivity("invoices", id);

  const { data: rows } = await supabase.from("invoice_items").select("title, description, qty_milli, unit_price_minor, taxable, image_path").eq("invoice_id", id).order("sort");
  const items: ViewItem[] = (rows ?? []).map((r: any) => ({
    title: r.title, description: r.description, qty_milli: r.qty_milli, unit_price_minor: r.unit_price_minor, taxable: r.taxable,
    imageUrl: r.image_path ? supabase.storage.from("item-photos").getPublicUrl(r.image_path).data.publicUrl : null,
  }));
  const totals = computeDocument({ items: items.map((i) => ({ qtyMilli: i.qty_milli, unitPriceMinor: i.unit_price_minor, taxable: i.taxable })), discountMinor: inv.discount_minor, taxRateBps: inv.tax_rate_bps });

  // Payment summary
  const { data: pays } = await supabase.from("payments").select("amount_minor, method, reference, paid_at").eq("invoice_id", id).order("paid_at");
  const paid = (pays ?? []).reduce((s: number, p: any) => s + p.amount_minor, 0);
  const balance = Math.max(0, totals.totalMinor - paid);
  const c: any = inv.customers;
  const accent = org?.accent_color || "#2563eb";
  const cur = org?.currency ?? "USD";

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <Link href="/invoices" style={back}>‹ Invoices</Link>
        <PrintButton label="Save as PDF" />
      </div>
      <div className="no-print" style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <DocDetailActions kind="invoice" id={inv.id} token={inv.public_token} status={inv.status} number={inv.number}
          customerName={c?.name ?? "—"} customerEmail={c?.email ?? null} customerPhone={c?.phone ?? null} orgName={org?.name ?? ""} locale={locale} />
      </div>

      {(pays ?? []).length > 0 && (
        <div className="no-print" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div style={{ background: "#e6f6ec", borderRadius: 12, padding: "12px 14px" }}><div style={{ fontSize: 14, color: "#15803d", fontWeight: 700 }}>Paid</div><div style={{ fontSize: 20, fontWeight: 800, color: "#15803d" }}>{money(paid, cur)}</div></div>
          <div style={{ background: balance > 0 ? "#fdf1dc" : "#eef2f8", borderRadius: 12, padding: "12px 14px" }}><div style={{ fontSize: 14, color: "#b45309", fontWeight: 700 }}>Balance</div><div style={{ fontSize: 20, fontWeight: 800, color: balance > 0 ? "#b45309" : "#15803d" }}>{money(balance, cur)}</div></div>
        </div>
      )}

      <DocView title="Invoice" number={inv.number} accent={accent} currency={cur} org={org} customer={c}
        issueDate={inv.issue_date} items={items} totals={totals} taxLabel={org?.tax_label ?? "Tax"} taxRateBps={inv.tax_rate_bps} notes={inv.notes} />
      <ActivityTimeline entries={activity} locale={locale} />
    </div>
  );
}
const back: React.CSSProperties = { color: "#2563eb", fontWeight: 700, fontSize: 14, textDecoration: "none" };
