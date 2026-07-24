"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { convertEstimateToInvoice } from "@/app/(app)/estimates/actions";
import { setInvoicePaid } from "@/app/(app)/invoices/actions";

export type DocRow = { id: string; number: number; status: string; total_minor: number; issue_date: string; customer_name: string; public_token: string };

const SYM: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };
const STATUS_COLOR: Record<string, string> = {
  draft: "#eef1f6|#57606f", sent: "#e0ebff|#2563eb", approved: "#e6f6ec|#15803d", rejected: "#fdeaea|#dc2626",
  unpaid: "#fdf1dc|#b45309", paid: "#e6f6ec|#15803d", void: "#eef1f6|#57606f",
};

export default function DocList({ rows, locale, currency, kind, emptyKey, statusPrefix }: {
  rows: DocRow[]; locale: Locale; currency: string; kind: "estimate" | "invoice"; emptyKey: string; statusPrefix: "dst" | "ist";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);
  const cur = SYM[currency] ?? "$";
  const m = (v: number) => cur + (v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const d = (iso: string) => { if (!iso) return "—"; const x = new Date(iso + "T00:00:00"); return `${x.getDate()}/${x.getMonth() + 1}/${x.getFullYear()}`; };

  function copyLink(token: string) {
    const url = `${window.location.origin}/p/${token}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(token); setTimeout(() => setCopied(null), 1600);
  }
  function convert(id: string) {
    if (!confirm("Create an invoice from this estimate?")) return;
    start(async () => { await convertEstimateToInvoice(id); router.refresh(); });
  }
  function togglePaid(id: string, paid: boolean) {
    start(async () => { await setInvoicePaid(id, paid); router.refresh(); });
  }

  return (
    <div className="rlist">
      {rows.map((r) => {
        const [bg, fg] = (STATUS_COLOR[r.status] ?? "#eef1f6|#57606f").split("|");
        return (
          <div className="ritem" key={r.id} style={{ flexWrap: "wrap" }}>
            <div className="rmain">
              <div className="rtitle">#{r.number} · {r.customer_name}</div>
              <div className="rsub">{d(r.issue_date)}</div>
            </div>
            <div className="rend">
              <b style={{ fontSize: 15 }}>{m(r.total_minor)}</b>
              <span className="pill" style={{ background: bg, color: fg }}>{t(locale, `${statusPrefix}.${r.status}`)}</span>
            </div>
            <div style={{ display: "flex", gap: 8, width: "100%", marginTop: 8 }}>
              <button onClick={() => copyLink(r.public_token)} style={actBtn}>{copied === r.public_token ? t(locale, "doc.copied") : `🔗 ${t(locale, "doc.link")}`}</button>
              {kind === "estimate" && <button onClick={() => convert(r.id)} disabled={pending} style={actBtn}>🧾 {t(locale, "doc.to_invoice")}</button>}
              {kind === "invoice" && r.status === "unpaid" && <button onClick={() => togglePaid(r.id, true)} disabled={pending} style={{ ...actBtn, background: "#e6f6ec", color: "#15803d" }}>✓ Mark paid</button>}
              {kind === "invoice" && r.status === "paid" && <button onClick={() => togglePaid(r.id, false)} disabled={pending} style={actBtn}>↩ Mark due</button>}
            </div>
          </div>
        );
      })}
      {rows.length === 0 && <div className="rempty">{t(locale, emptyKey)}</div>}
    </div>
  );
}

const actBtn: React.CSSProperties = { background: "#eef2f8", color: "#2563eb", border: "none", borderRadius: 9, padding: "8px 12px", fontWeight: 700, fontSize: 13, cursor: "pointer" };
