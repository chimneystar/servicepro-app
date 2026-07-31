import { money } from "@/lib/format";

export type ViewItem = { title: string | null; description: string | null; qty_milli: number; unit_price_minor: number; taxable: boolean; imageUrl: string | null };
export type ViewTotals = { subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number };

export default function DocView({ title, number, accent, currency, org, customer, issueDate, items, totals, taxLabel, taxRateBps, notes }: {
  title: string; number: number; accent: string; currency: string;
  org: any; customer: any; issueDate: string | null; items: ViewItem[]; totals: ViewTotals; taxLabel: string; taxRateBps: number; notes: string | null;
}) {
  const line = (it: ViewItem) => Math.round((it.qty_milli * it.unit_price_minor) / 1000);
  const hasNonTax = items.some((i) => i.taxable === false);
  const fmtD = (iso: string | null) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "";

  return (
    <div className="print-card" style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, overflow: "hidden", boxShadow: "0 8px 24px rgba(15,42,94,.07)" }}>
      <div style={{ background: `linear-gradient(135deg, ${accent}, ${accent})`, color: "#fff", padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.375rem", overflow: "hidden" }}>
            {org?.logo_url ? <img src={org.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "❄️"}
          </div>
          <div style={{ minWidth: 0 }}><div style={{ fontSize: "1.0625rem", fontWeight: 800 }}>{org?.name}</div><div style={{ fontSize: "0.75rem", opacity: .85 }}>{[org?.phone, org?.email].filter(Boolean).join(" · ")}</div></div>
        </div>
        <div style={{ textAlign: "end" }}><div style={{ fontSize: "1.25rem", fontWeight: 800 }}>{title.toUpperCase()}</div><div style={{ fontSize: "0.8125rem", opacity: .9 }}>#{number}</div>{issueDate && <div style={{ fontSize: "0.8125rem", opacity: .8 }}>{fmtD(issueDate)}</div>}</div>
      </div>

      <div style={{ padding: "18px 24px" }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: "0.8125rem", color: "#94a3b8", fontWeight: 800, letterSpacing: .5, textTransform: "uppercase" }}>Prepared for</div>
          <div style={{ fontSize: "1rem", fontWeight: 800 }}>{customer?.name}</div>
          <div style={{ fontSize: "0.8125rem", color: "#5c6675" }}>{[customer?.address, customer?.city].filter(Boolean).join(", ")}{customer?.phone ? ` · ${customer.phone}` : ""}</div>
        </div>

        <div style={{ borderTop: `2px solid ${accent}` }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "11px 0", borderBottom: "1px solid #f1f4f9" }}>
              {it.imageUrl && <img src={it.imageUrl} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", border: "1px solid #e2e8f0", flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "0.875rem" }}>{it.title || it.description}</div>
                {it.description && it.description !== it.title && <div style={{ fontSize: "0.8125rem", color: "#5c6675" }}>{it.description}</div>}
                <div style={{ fontSize: "0.75rem", color: "#9aa3b2" }}>{(it.qty_milli / 1000).toLocaleString("en-US")} × {money(it.unit_price_minor, currency)}{hasNonTax && it.taxable === false ? " · no tax" : ""}</div>
              </div>
              <b style={{ whiteSpace: "nowrap", fontSize: "0.875rem" }}>{money(line(it), currency)}</b>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 12, marginInlineStart: "auto", maxWidth: 260 }}>
          <Row label="Subtotal" value={money(totals.subtotalMinor, currency)} />
          {totals.discountMinor > 0 && <Row label="Discount" value={"-" + money(totals.discountMinor, currency)} red />}
          <Row label={`${taxLabel} (${taxRateBps / 100}%)`} value={money(totals.taxMinor, currency)} />
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, marginTop: 6, borderTop: `2px solid ${accent}`, fontSize: "1.125rem", fontWeight: 800, color: accent }}>
            <span>Total</span><span>{money(totals.totalMinor, currency)}</span>
          </div>
        </div>

        {notes && <div style={{ marginTop: 14, background: "#f8fafc", borderRadius: 10, padding: 12, fontSize: "0.8125rem", color: "#475569" }}><b>Notes</b><br />{notes}</div>}
      </div>
    </div>
  );
}

function Row({ label, value, red }: { label: string; value: string; red?: boolean }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: "0.875rem", color: red ? "#dc2626" : "#334155" }}><span>{label}</span><b>{value}</b></div>;
}
