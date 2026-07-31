"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ShareDoc, { type ShareTarget } from "@/components/ShareDoc";
import { duplicateEstimate, deleteEstimate, setEstimateStatus, convertEstimateToInvoice } from "@/app/(app)/estimates/actions";
import { duplicateInvoice, deleteInvoice, setInvoicePaid } from "@/app/(app)/invoices/actions";
import { ActionError, useActionStatus } from "@/components/ActionStatus";

export default function DocDetailActions({ kind, id, token, status, number, customerName, customerEmail, customerPhone, orgName }: {
  kind: "estimate" | "invoice"; id: string; token: string; status: string; number: number;
  customerName: string; customerEmail: string | null; customerPhone: string | null; orgName: string;
}) {
  const router = useRouter();
  // Every one of these buttons used to fail silently: the transition ended and
  // the page simply did not change. Duplicate, delete, convert and mark-paid
  // are all irreversible-looking operations on money documents.
  const { pending, error, run } = useActionStatus();
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [copied, setCopied] = useState(false);
  const base = kind === "estimate" ? "/estimates" : "/invoices";

  function copyLink() { navigator.clipboard?.writeText(`${window.location.origin}/p/${token}`).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1600); }
  function dup() {
    let newId: string | undefined;
    run(async () => { const r = kind === "estimate" ? await duplicateEstimate(id) : await duplicateInvoice(id); newId = r.newId; return r; },
      () => { if (newId) router.push(`${base}/${newId}`); else router.refresh(); });
  }
  function del() { if (!confirm(`Delete this ${kind}? This cannot be undone.`)) return; run(() => (kind === "estimate" ? deleteEstimate(id) : deleteInvoice(id)), () => router.push(base)); }
  function estStatus(s: string) { run(() => setEstimateStatus(id, s), () => router.refresh()); }
  function convert() { run(() => convertEstimateToInvoice(id), () => router.push("/invoices")); }
  function togglePaid(paid: boolean) { run(() => setInvoicePaid(id, paid), () => router.refresh()); }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href={`${base}/${id}/edit`} style={{ ...btn, background: "#2563eb", color: "#fff", textDecoration: "none" }}>✏️ Edit</Link>
        <button onClick={() => setShare({ kind, number, token, customerName, customerEmail, customerPhone, orgName })} style={{ ...btn, background: "#e0ebff", color: "#2563eb" }}>📤 Send</button>
        <button onClick={copyLink} style={btn}>{copied ? "✓ Copied" : "🔗 Link"}</button>
        <button onClick={dup} disabled={pending} style={btn}>⧉ Duplicate</button>
        {kind === "estimate" && status !== "approved" && <button onClick={convert} disabled={pending} style={{ ...btn, background: "#e6f6ec", color: "#15803d" }}>🧾 Convert to invoice</button>}
        {kind === "invoice" && status !== "paid" && <button onClick={() => togglePaid(true)} disabled={pending} style={{ ...btn, background: "#e6f6ec", color: "#15803d" }}>✓ Mark paid</button>}
        {kind === "invoice" && status === "paid" && <button onClick={() => togglePaid(false)} disabled={pending} style={btn}>↩ Mark due</button>}
        <button onClick={del} disabled={pending} style={{ ...btn, background: "#fdeaea", color: "#dc2626" }}>🗑️ Delete</button>
      </div>

      {kind === "estimate" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <span style={{ fontSize: 12.5, color: "#5c6675", fontWeight: 700 }}>Status:</span>
          <select value={status} onChange={(e) => estStatus(e.target.value)} disabled={pending} style={{ border: "1px solid #e2e8f0", borderRadius: 9, padding: "7px 10px", fontSize: 13, fontWeight: 600, background: "#fff" }}>
            <option value="draft">Draft</option><option value="sent">Sent</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
          </select>
        </div>
      )}

      <ActionError error={error} />

      {share && <ShareDoc target={share} onClose={() => setShare(null)} />}
    </div>
  );
}

const btn: React.CSSProperties = { background: "#eef2f8", color: "#2563eb", border: "none", borderRadius: 9, padding: "9px 13px", fontWeight: 700, fontSize: 13, cursor: "pointer" };
