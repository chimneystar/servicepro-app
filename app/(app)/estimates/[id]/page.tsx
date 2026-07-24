import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import DocView, { type ViewItem } from "@/components/DocView";
import DocDetailActions from "@/components/DocDetailActions";
import PrintButton from "@/components/PrintButton";
// @ts-ignore
import { computeDocument } from "@/lib/core/money.mjs";

export const dynamic = "force-dynamic";

export default async function EstimateDetailPage({ params }: { params: { id: string } }) {
  await requireProfile();
  const supabase = createClient();
  const { data: est } = await supabase.from("estimates")
    .select("id, number, status, discount_minor, tax_rate_bps, issue_date, notes, public_token, customers(name, address, city, phone, email)")
    .eq("id", params.id).is("deleted_at", null).maybeSingle();
  const { data: org } = await supabase.from("organizations").select("name, logo_url, tagline, phone, email, currency, tax_label, accent_color").single();
  if (!est) return <div><Link href="/estimates" style={back}>‹ Estimates</Link><div style={{ padding: 40, textAlign: "center", color: "#5c6675" }}>Estimate not found.</div></div>;

  const { data: rows } = await supabase.from("estimate_items").select("title, description, qty_milli, unit_price_minor, taxable, image_path").eq("estimate_id", params.id).order("sort");
  const items: ViewItem[] = (rows ?? []).map((r: any) => ({
    title: r.title, description: r.description, qty_milli: r.qty_milli, unit_price_minor: r.unit_price_minor, taxable: r.taxable,
    imageUrl: r.image_path ? supabase.storage.from("item-photos").getPublicUrl(r.image_path).data.publicUrl : null,
  }));
  const totals = computeDocument({ items: items.map((i) => ({ qtyMilli: i.qty_milli, unitPriceMinor: i.unit_price_minor, taxable: i.taxable })), discountMinor: est.discount_minor, taxRateBps: est.tax_rate_bps });
  const c: any = est.customers;
  const accent = org?.accent_color || "#2563eb";

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <Link href="/estimates" style={back}>‹ Estimates</Link>
        <PrintButton label="Save as PDF" />
      </div>
      <div className="no-print" style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <DocDetailActions kind="estimate" id={est.id} token={est.public_token} status={est.status} number={est.number}
          customerName={c?.name ?? "—"} customerEmail={c?.email ?? null} customerPhone={c?.phone ?? null} orgName={org?.name ?? ""} />
      </div>
      <DocView title="Estimate" number={est.number} accent={accent} currency={org?.currency ?? "USD"} org={org} customer={c}
        issueDate={est.issue_date} items={items} totals={totals} taxLabel={org?.tax_label ?? "Tax"} taxRateBps={est.tax_rate_bps} notes={est.notes} />
    </div>
  );
}
const back: React.CSSProperties = { color: "#2563eb", fontWeight: 700, fontSize: 14, textDecoration: "none" };
