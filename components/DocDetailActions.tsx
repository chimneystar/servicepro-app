"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ShareDoc, { type ShareTarget } from "@/components/ShareDoc";
import { duplicateEstimate, deleteEstimate, setEstimateStatus, convertEstimateToInvoice, markEstimateSent } from "@/app/(app)/estimates/actions";
import { duplicateInvoice, deleteInvoice, setInvoicePaid, markInvoiceSent } from "@/app/(app)/invoices/actions";
import { ActionError, useActionStatus } from "@/components/ActionStatus";

export default function DocDetailActions({ kind, id, token, status, number, locked = false, voided = false, customerName, customerEmail, customerPhone, orgName }: {
  kind: "estimate" | "invoice"; id: string; token: string; status: string; number: number;
  locked?: boolean; voided?: boolean;
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

  /**
   * Ledger 6a.5 — the product tracked "sent" nowhere, so an invoice could be
   * repriced after the customer had it and nothing recorded that it had
   * changed. Putting the public link in front of the customer — by copying it
   * or by opening the Send dialog — is the moment the figures leave the
   * building, so that is where sent_at is stamped. From then on the amounts are
   * locked and a correction is a credit note, a void or (for an estimate) a
   * recorded reopen. Failure to stamp is deliberately not surfaced: it must
   * never stop someone sending a document.
   */
  function recordSent() {
    if (locked || voided) return;
    (kind === "estimate" ? markEstimateSent(id) : markInvoiceSent(id)).then(() => router.refresh()).catch(() => {});
  }
  function copyLink() {
    navigator.clipboard?.writeText(`${window.location.origin}/p/${token}`).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1600);
    recordSent();
  }
  function openShare() {
    setShare({ kind, number, token, customerName, customerEmail, customerPhone, orgName });
    recordSent();
  }
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
        {/* Editing a locked document is refused by the action AND by a database
            trigger. Showing the button anyway would just walk the user into a
            refusal, so it is replaced by the reason. */}
        {!locked && <Link href={`${base}/${id}/edit`} style={{ ...btn, background: "#2563eb", color: "#fff", textDecoration: "none" }}>✏️ Edit</Link>}
        {locked && !voided && <span style={{ ...btn, background: "#fdf1dc", color: "#7c4a03", cursor: "default" }}>🔒 Amounts locked</span>}
        {!voided && <button onClick={openShare} style={{ ...btn, background: "#e0ebff", color: "#2563eb" }}>📤 Send</button>}
        {!voided && <button onClick={copyLink} style={btn}>{copied ? "✓ Copied" : "🔗 Link"}</button>}
        <button onClick={dup} disabled={pending} style={btn}>⧉ Duplicate</button>
        {kind === "estimate" && status !== "approved" && !voided && <button onClick={convert} disabled={pending} style={{ ...btn, background: "#e6f6ec", color: "#15803d" }}>🧾 Convert to invoice</button>}
        {kind === "invoice" && status !== "paid" && !voided && <button onClick={() => togglePaid(true)} disabled={pending} style={{ ...btn, background: "#e6f6ec", color: "#15803d" }}>✓ Mark paid</button>}
        {kind === "invoice" && status === "paid" && <button onClick={() => togglePaid(false)} disabled={pending} style={btn}>↩ Mark due</button>}
        {!locked && <button onClick={del} disabled={pending} style={{ ...btn, background: "#fdeaea", color: "#dc2626" }}>🗑️ Delete</button>}
      </div>

      {kind === "estimate" && !voided && (
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
