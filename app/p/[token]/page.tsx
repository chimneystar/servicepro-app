import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { money } from "@/lib/format";
import SignApprove from "@/components/SignApprove";
import PrintButton from "@/components/PrintButton";
import { providers } from "@/lib/providers";
import CustomerPaymentOptions from "@/components/CustomerPaymentOptions";
import type { PublicPaymentOptions } from "@/lib/payments/types";
// @ts-ignore
import { computeDocument, lineSubtotalMinor } from "@/lib/core/money.mjs";

export const dynamic = "force-dynamic";

function shade(hex: string, pct: number) {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!h) return hex || "#0f2a5e";
  const n = parseInt(h[1], 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.round(r * (1 - pct)); g = Math.round(g * (1 - pct)); b = Math.round(b * (1 - pct));
  return `rgb(${r},${g},${b})`;
}

export default async function PublicDocPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const locale = (await getLocale());
  const supabase = await createClient();
  const [{ data }, { data: paymentData }] = await Promise.all([
    supabase.rpc("public_document", { p_token: token }),
    supabase.rpc("public_payment_options", { p_token: token }),
  ]);
  const doc: any = data;
  if (!doc) return <Center accent="#0f2a5e"><p style={{ color: "#55647a", fontSize: 15 }}>{t(locale, "public.invalid")}</p></Center>;

  const accent = doc.org?.accent_color || "#2563eb";
  const accentDark = shade(accent, 0.35);
  const cur = doc.currency ?? "USD";
  const items: any[] = doc.items ?? [];
  const totals = computeDocument({ items: items.map((i) => ({ qtyMilli: i.qty_milli, unitPriceMinor: i.unit_price_minor, taxable: i.taxable })), discountMinor: doc.discount_minor, taxRateBps: doc.tax_rate_bps });
  const title = doc.kind === "invoice" ? t(locale, "public.invoice") : t(locale, "public.estimate");
  const signed = !!doc.signed_at;
  const paymentOptions = paymentData as PublicPaymentOptions | null;
  const hasNewPayments = !!paymentOptions?.methods;
  const canPayOnline = !hasNewPayments && doc.kind === "invoice" && doc.status !== "paid" && providers.stripe();
  const depositMinor = doc.deposit_minor ?? 0;
  const canPayDeposit = !hasNewPayments && signed && doc.kind === "estimate" && depositMinor > 0 && providers.stripe();
  const isPaid = doc.status === "paid";
  const hasNonTaxable = items.some((i) => i.taxable === false);
  const imgUrl = (path: string) => supabase.storage.from("item-photos").getPublicUrl(path).data.publicUrl;
  const fmtD = (iso: string) => iso ? new Date(iso + "T00:00:00").toLocaleDateString(locale === "he" ? "he-IL" : "en-US", { year: "numeric", month: "short", day: "numeric" }) : "";

  return (
    <Center accent={accent}>
      <div className="no-print" style={{ width: "100%", maxWidth: 680, marginBottom: 10, display: "flex", justifyContent: "flex-end" }}>
        <PrintButton label={t(locale, "public.save_pdf")} />
      </div>
      <div className="print-card" style={{ background: "#fff", borderRadius: 20, boxShadow: "0 24px 70px rgba(15,42,94,.18)", overflow: "hidden", maxWidth: 680, width: "100%" }}>
        {/* Header */}
        <div style={{ background: `linear-gradient(135deg, ${accentDark}, ${accent})`, color: "#fff", padding: "28px 30px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "center", minWidth: 0 }}>
              <div style={{ width: 60, height: 60, borderRadius: 16, background: "rgba(255,255,255,.16)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0, overflow: "hidden" }}>
                {doc.org?.logo_url ? <img src={doc.org.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "❄️"}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{doc.org?.name}</div>
                {doc.org?.tagline && <div style={{ fontSize: 14, opacity: .85 }}>{doc.org.tagline}</div>}
                <div style={{ fontSize: 14, opacity: .8, marginTop: 4 }}>
                  {[doc.org?.phone, doc.org?.email].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
            <div style={{ textAlign: "end", flexShrink: 0 }}>
              <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: locale === "en" ? .5 : 0, textTransform: locale === "en" ? "uppercase" : "none" }}>{title}</div>
              <div style={{ fontSize: 14, opacity: .9 }}>#{doc.number}</div>
              {doc.issue_date && <div style={{ fontSize: 14, opacity: .8, marginTop: 2 }}>{fmtD(doc.issue_date)}</div>}
            </div>
          </div>
        </div>

        <div style={{ padding: "24px 30px" }}>
          {/* Bill to / addresses */}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap", marginBottom: 20 }}>
            <div style={{ minWidth: 160 }}>
              <div style={{ fontSize: 14, color: "#55647a", fontWeight: 800, letterSpacing: locale === "en" ? .6 : 0, textTransform: locale === "en" ? "uppercase" : "none" }}>{t(locale, "public.prepared_for")}</div>
              <div style={{ fontSize: 17, fontWeight: 800, marginTop: 3 }}>{doc.customer?.name}</div>
              {(doc.customer?.address || doc.customer?.city) && <div style={{ fontSize: 14, color: "#5c6675" }}>{[doc.customer.address, doc.customer.city].filter(Boolean).join(", ")}</div>}
              {doc.customer?.phone && <div style={{ fontSize: 14, color: "#55647a" }}><bdi dir="ltr">{doc.customer.phone}</bdi></div>}
              {doc.customer?.email && <div style={{ fontSize: 14, color: "#55647a" }}><bdi dir="ltr">{doc.customer.email}</bdi></div>}
            </div>
            <div style={{ textAlign: "end" }}>
              <div style={{ fontSize: 14, color: "#55647a", fontWeight: 800, letterSpacing: locale === "en" ? .6 : 0, textTransform: locale === "en" ? "uppercase" : "none" }}>{doc.kind === "invoice" ? t(locale, "public.amount_due") : t(locale, "public.amount")}</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: accent }}>{money(totals.totalMinor, cur)}</div>
            </div>
          </div>

          {/* Items */}
          <div style={{ borderTop: `2px solid ${accent}` }}>
            {items.map((it, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "13px 0", borderBottom: "1px solid #f1f4f9" }}>
                {it.image_path && <img src={imgUrl(it.image_path)} alt="" style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover", flexShrink: 0, border: "1px solid #e2e8f0" }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{it.title || it.description}</div>
                  {it.description && it.description !== it.title && <div style={{ fontSize: 14, color: "#5c6675", marginTop: 2 }}>{it.description}</div>}
                  <div style={{ fontSize: 14, color: "#9aa3b2", marginTop: 2 }}>
                    {(it.qty_milli / 1000).toLocaleString(locale === "he" ? "he-IL" : "en-US")} × {money(it.unit_price_minor, cur)}{hasNonTaxable && it.taxable === false ? ` · ${t(locale, "public.no_tax")}` : ""}
                  </div>
                </div>
                <b style={{ whiteSpace: "nowrap", fontSize: 14.5 }}>{money(lineSubtotalMinor(it.qty_milli, it.unit_price_minor), cur)}</b>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div style={{ marginTop: 14, marginInlineStart: "auto", maxWidth: 280 }}>
            <Line label={t(locale, "doc.subtotal")} value={money(totals.subtotalMinor, cur)} />
            {totals.discountMinor > 0 && <Line label={t(locale, "doc.discount")} value={"-" + money(totals.discountMinor, cur)} red />}
            <Line label={`${doc.tax_label || t(locale, "doc.tax")} (${doc.tax_rate_bps / 100}%)`} value={money(totals.taxMinor, cur)} />
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, marginTop: 8, borderTop: `2px solid ${accent}`, fontSize: 20, fontWeight: 800, color: accent }}>
              <span>{t(locale, "doc.grand")}</span><span>{money(totals.totalMinor, cur)}</span>
            </div>
          </div>

          {depositMinor > 0 && doc.kind === "estimate" && (
            <div style={{ marginTop: 16, background: "#f8fafc", border: `1px solid ${accent}33`, borderRadius: 12, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{t(locale, "public.deposit_schedule")}</span>
              <b style={{ fontSize: 16, color: accent }}>{money(depositMinor, cur)}</b>
            </div>
          )}
          {canPayDeposit && (
            <a href={`/api/pay/${token}?deposit=1`} style={{ display: "block", marginTop: 12, background: accent, color: "#fff", padding: "15px 16px", borderRadius: 12, fontWeight: 800, fontSize: 16, textAlign: "center", textDecoration: "none" }}>
              💳 {t(locale, "public.pay_deposit", { amount: money(depositMinor, cur) })}
            </a>
          )}
          {isPaid && doc.kind === "invoice" && (
            <div style={{ marginTop: 18, background: "#e6f6ec", color: "#126b35", padding: "14px 16px", borderRadius: 12, fontWeight: 800, textAlign: "center" }}>✓ {t(locale, "public.paid_thanks")}</div>
          )}
          {canPayOnline && (
            <a href={`/api/pay/${token}`} style={{ display: "block", marginTop: 18, background: accent, color: "#fff", padding: "15px 16px", borderRadius: 12, fontWeight: 800, fontSize: 16, textAlign: "center", textDecoration: "none" }}>
              💳 {t(locale, "public.pay_now", { amount: money(totals.totalMinor, cur) })}
            </a>
          )}

          {doc.notes && <div style={{ marginTop: 18, background: "#f8fafc", borderRadius: 12, padding: 14, fontSize: 14, color: "#475569" }}><b>{t(locale, "public.notes")}</b><br />{doc.notes}</div>}
          {doc.org?.terms && <div style={{ marginTop: 12, padding: 14, border: "1px solid #d7e0ec", borderRadius: 12 }}><div style={{ fontSize: 14, color: "#55647a", fontWeight: 800, letterSpacing: locale === "en" ? .5 : 0, textTransform: locale === "en" ? "uppercase" : "none", marginBottom: 4 }}>{t(locale, "public.terms")}</div><div style={{ fontSize: 14, color: "#55647a", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{doc.org.terms}</div></div>}

          {/* Sign / approve */}
          <div style={{ marginTop: 22 }}>
            {signed ? (
              <div style={{ background: "#e6f6ec", color: "#15803d", padding: "14px 16px", borderRadius: 12, fontWeight: 700 }}>
                ✓ {t(locale, "doc.approved")} — {doc.signer_name} · {new Date(doc.signed_at).toLocaleDateString(locale === "he" ? "he-IL" : "en-US")}
              </div>
            ) : (
              <div className="no-print"><SignApprove token={token} locale={locale} /></div>
            )}
          </div>
          {paymentOptions && <div className="no-print" style={{ marginTop: 18 }}><CustomerPaymentOptions token={token} locale={locale} options={paymentOptions} accent={accent} /></div>}
        </div>

        {/* Footer */}
        <div style={{ background: "#f8fafc", borderTop: "1px solid #eef1f6", padding: "14px 30px", textAlign: "center", fontSize: 14, color: "#94a3b8" }}>
          {doc.org?.footer || `${doc.org?.name} · ${t(locale, "public.footer")}`}
        </div>
      </div>
    </Center>
  );
}

function Center({ children, accent }: { children: React.ReactNode; accent: string }) {
  return <div className="public-document-page" style={{ borderTopColor: accent }}>{children}</div>;
}
function Line({ label, value, red }: { label: string; value: string; red?: boolean }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 14, color: red ? "#dc2626" : "#334155" }}><span>{label}</span><b>{value}</b></div>;
}
