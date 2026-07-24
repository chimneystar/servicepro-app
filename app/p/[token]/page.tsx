import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { money } from "@/lib/format";
import SignApprove from "@/components/SignApprove";
import PrintButton from "@/components/PrintButton";
// @ts-ignore
import { computeDocument, lineSubtotalMinor } from "@/lib/core/money.mjs";

export const dynamic = "force-dynamic";

export default async function PublicDocPage({ params }: { params: { token: string } }) {
  const locale = getLocale();
  const supabase = createClient();
  const { data } = await supabase.rpc("public_document", { p_token: params.token });
  const doc: any = data;

  if (!doc) {
    return <Center><p style={{ color: "#5c6675" }}>This link is invalid or has expired.</p></Center>;
  }

  const cur = doc.currency ?? "USD";
  const items: any[] = doc.items ?? [];
  const totals = computeDocument({ items: items.map((i) => ({ qtyMilli: i.qty_milli, unitPriceMinor: i.unit_price_minor })), discountMinor: doc.discount_minor, taxRateBps: doc.tax_rate_bps });
  const title = doc.kind === "invoice" ? "Invoice" : "Estimate";
  const signed = !!doc.signed_at;

  return (
    <Center>
      <div className="no-print" style={{ width: "100%", maxWidth: 640, marginBottom: 10, display: "flex", justifyContent: "flex-end" }}>
        <PrintButton label="Save as PDF" />
      </div>
      <div className="print-card" style={{ background: "#fff", borderRadius: 18, boxShadow: "0 20px 60px rgba(15,42,94,.15)", overflow: "hidden", maxWidth: 640, width: "100%" }}>
        {/* header */}
        <div style={{ background: "linear-gradient(135deg,#0f2a5e,#2563eb)", color: "#fff", padding: "22px 24px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center", minWidth: 0 }}>
            <div style={{ width: 54, height: 54, borderRadius: 14, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, flexShrink: 0, overflow: "hidden" }}>
              {doc.org?.logo_url ? <img src={doc.org.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "❄️"}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{doc.org?.name}</div>
              <div style={{ fontSize: 12.5, opacity: .85 }}>{doc.org?.tagline}</div>
            </div>
          </div>
          <div style={{ textAlign: "end" }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{title}</div>
            <div style={{ fontSize: 13, opacity: .9 }}>#{doc.number}</div>
          </div>
        </div>

        <div style={{ padding: "20px 24px" }}>
          <div style={{ fontSize: 13, color: "#5c6675" }}>Prepared for</div>
          <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 14 }}>{doc.customer?.name}</div>

          {/* items */}
          <div style={{ borderTop: "1px solid #eef1f6" }}>
            {items.map((it, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid #f1f4f9", fontSize: 14 }}>
                <span>{it.description} <span style={{ color: "#9aa3b2" }}>×{(it.qty_milli / 1000).toLocaleString()}</span></span>
                <b style={{ whiteSpace: "nowrap" }}>{money(lineSubtotalMinor(it.qty_milli, it.unit_price_minor), cur)}</b>
              </div>
            ))}
          </div>

          {/* totals */}
          <div style={{ marginTop: 12, marginInlineStart: "auto", maxWidth: 260 }}>
            <Line label="Subtotal" value={money(totals.subtotalMinor, cur)} />
            {totals.discountMinor > 0 && <Line label="Discount" value={"-" + money(totals.discountMinor, cur)} red />}
            <Line label={`${doc.tax_label || "Tax"} ${doc.tax_rate_bps / 100}%`} value={money(totals.taxMinor, cur)} />
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, marginTop: 6, borderTop: "2px solid #0f2a5e", fontSize: 19, fontWeight: 800, color: "#2563eb" }}>
              <span>Total</span><span>{money(totals.totalMinor, cur)}</span>
            </div>
          </div>

          {doc.notes && <div style={{ marginTop: 16, background: "#f8fafc", borderRadius: 10, padding: 12, fontSize: 12.5, color: "#475569" }}><b>Notes</b><br />{doc.notes}</div>}
          {doc.org?.terms && <div style={{ marginTop: 8, fontSize: 11.5, color: "#94a3b8" }}>{doc.org.terms}</div>}

          {/* sign / approve */}
          <div style={{ marginTop: 22 }}>
            {signed ? (
              <div style={{ background: "#e6f6ec", color: "#15803d", padding: "14px 16px", borderRadius: 12, fontWeight: 700 }}>
                ✓ {t(locale, "doc.approved")} — {doc.signer_name} · {new Date(doc.signed_at).toLocaleDateString()}
              </div>
            ) : (
              <div className="no-print"><SignApprove token={params.token} locale={locale} /></div>
            )}
          </div>
        </div>
      </div>
    </Center>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: "100vh", background: "#eef3fb", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", padding: "20px 14px" }}>{children}</div>;
}
function Line({ label, value, red }: { label: string; value: string; red?: boolean }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 14, color: red ? "#dc2626" : "#334155" }}><span>{label}</span><b>{value}</b></div>;
}
