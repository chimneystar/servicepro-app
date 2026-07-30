"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ShareDoc, { type ShareTarget } from "@/components/ShareDoc";
import { t, type Locale } from "@/lib/i18n";
import { duplicateEstimate, deleteEstimate, setEstimateStatus, convertEstimateToInvoice } from "@/app/(app)/estimates/actions";
import { duplicateInvoice, deleteInvoice, setInvoicePaid } from "@/app/(app)/invoices/actions";

export default function DocDetailActions({ kind, id, token, status, number, customerName, customerEmail, customerPhone, orgName, locale }: {
  kind: "estimate" | "invoice"; id: string; token: string; status: string; number: number;
  customerName: string; customerEmail: string | null; customerPhone: string | null; orgName: string; locale: Locale;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [copied, setCopied] = useState(false);
  const base = kind === "estimate" ? "/estimates" : "/invoices";

  function copyLink() { navigator.clipboard?.writeText(`${window.location.origin}/p/${token}`).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1600); }
  function dup() { start(async () => { const r: any = kind === "estimate" ? await duplicateEstimate(id) : await duplicateInvoice(id); if (r.ok && r.newId) router.push(`${base}/${r.newId}`); }); }
  function del() { if (!confirm(t(locale, `doc.delete_${kind}_confirm`))) return; start(async () => { const r = kind === "estimate" ? await deleteEstimate(id) : await deleteInvoice(id); if (r.ok) router.push(base); }); }
  function estStatus(s: string) { start(async () => { await setEstimateStatus(id, s); router.refresh(); }); }
  function convert() { start(async () => { const r = await convertEstimateToInvoice(id); if (r.ok) router.push("/invoices"); }); }
  function togglePaid(paid: boolean) { start(async () => { await setInvoicePaid(id, paid); router.refresh(); }); }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href={`${base}/${id}/edit`} style={{ ...btn, background: "#2563eb", color: "#fff", textDecoration: "none" }}>✏️ {t(locale, "doc.edit")}</Link>
        <button onClick={() => setShare({ kind, number, token, customerName, customerEmail, customerPhone, orgName })} style={{ ...btn, background: "#e0ebff", color: "#2563eb" }}>📤 {t(locale, "doc.send")}</button>
        <button onClick={copyLink} style={btn}>{copied ? `✓ ${t(locale, "share.copied")}` : `🔗 ${t(locale, "doc.link")}`}</button>
        <button onClick={dup} disabled={pending} style={btn}>⧉ {t(locale, "doc.duplicate")}</button>
        {kind === "estimate" && status !== "approved" && <button onClick={convert} disabled={pending} style={{ ...btn, background: "#fff6d5", color: "#705500" }}>🧾 {t(locale, "doc.convert_invoice")}</button>}
        {kind === "invoice" && status !== "paid" && <button onClick={() => togglePaid(true)} disabled={pending} style={{ ...btn, background: "#e6f6ec", color: "#15803d" }}>✓ {t(locale, "doc.mark_paid")}</button>}
        {kind === "invoice" && status === "paid" && <button onClick={() => togglePaid(false)} disabled={pending} style={btn}>↩ {t(locale, "doc.mark_due")}</button>}
        <button onClick={del} disabled={pending} style={{ ...btn, background: "#fdeaea", color: "#dc2626" }}>🗑️ {t(locale, "doc.delete")}</button>
      </div>

      {kind === "estimate" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <span style={{ fontSize: 14, color: "#5c6675", fontWeight: 700 }}>{t(locale, "doc.status")}:</span>
          <select value={status} onChange={(e) => estStatus(e.target.value)} disabled={pending} style={{ minHeight: 44, border: "1px solid #e2e8f0", borderRadius: 9, padding: "7px 10px", fontSize: 14, fontWeight: 600, background: "#fff" }}>
            <option value="draft">{t(locale, "dst.draft")}</option><option value="sent">{t(locale, "dst.sent")}</option><option value="approved">{t(locale, "dst.approved")}</option><option value="rejected">{t(locale, "dst.rejected")}</option>
          </select>
        </div>
      )}

      {share && <ShareDoc target={share} locale={locale} onClose={() => setShare(null)} />}
    </div>
  );
}

const btn: React.CSSProperties = { minHeight: 44, background: "#eef2f8", color: "#2563eb", border: "none", borderRadius: 9, padding: "9px 13px", fontWeight: 700, fontSize: 14, cursor: "pointer" };
