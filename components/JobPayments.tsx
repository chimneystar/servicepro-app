"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";
import { recordJobPayment } from "@/app/(app)/jobs/[id]/actions";

export type PayRow = { amount_minor: number; method: string | null; reference: string | null; paid_at: string | null };
export type InvPay = { id: string; number: number; total_minor: number; status: string; paid_minor: number; payments?: PayRow[] };

const METHODS = ["Cash", "Credit card", "Check", "Zelle", "Bank transfer", "Other"];
const NEEDS_REF = ["Check", "Zelle", "Bank transfer"];
const REF_LABEL: Record<string, string> = { Check: "Check number", Zelle: "Zelle confirmation #", "Bank transfer": "Transfer / wire reference" };

export default function JobPayments({ jobId, invoices, currency, canRecord }: { jobId: string; invoices: InvPay[]; currency: string; canRecord: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [method, setMethod] = useState("Cash");
  const [err, setErr] = useState<string | null>(null);

  const totalDue = invoices.reduce((s, i) => s + Math.max(0, i.total_minor - i.paid_minor), 0);
  const totalPaid = invoices.reduce((s, i) => s + i.paid_minor, 0);

  function submit(invoiceId: string, formData: FormData) {
    setErr(null);
    const amount = String(formData.get("amount") ?? "");
    const m = String(formData.get("method") ?? "Cash");
    const reference = String(formData.get("reference") ?? "");
    start(async () => {
      const r = await recordJobPayment(invoiceId, jobId, amount, m, reference);
      if (!r.ok) setErr(r.error ?? "Error"); else { setOpenId(null); setMethod("Cash"); router.refresh(); }
    });
  }

  if (invoices.length === 0)
    return <div className="rempty">No invoices for this job yet. Create one in the Items or Invoices tab, then record payments here.</div>;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div style={{ background: "#fdf1dc", borderRadius: 12, padding: "12px 14px" }}><div style={{ fontSize: "0.75rem", color: "#b45309", fontWeight: 700 }}>Balance due</div><div style={{ fontSize: "1.25rem", fontWeight: 800, color: "#b45309" }}>{money(totalDue, currency)}</div></div>
        <div style={{ background: "#e6f6ec", borderRadius: 12, padding: "12px 14px" }}><div style={{ fontSize: "0.75rem", color: "#15803d", fontWeight: 700 }}>Paid</div><div style={{ fontSize: "1.25rem", fontWeight: 800, color: "#15803d" }}>{money(totalPaid, currency)}</div></div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {invoices.map((inv) => {
          const bal = Math.max(0, inv.total_minor - inv.paid_minor);
          return (
            <div key={inv.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <b>Invoice #{inv.number}</b>
                  <div style={{ fontSize: "0.8125rem", color: "#5c6675" }}>{money(inv.paid_minor, currency)} paid of {money(inv.total_minor, currency)}</div>
                </div>
                <span className="pill" style={bal <= 0 ? { background: "#e6f6ec", color: "#15803d" } : { background: "#fdf1dc", color: "#b45309" }}>{bal <= 0 ? "Paid" : `${money(bal, currency)} due`}</span>
              </div>
              {(inv.payments ?? []).length > 0 && (
                <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                  {(inv.payments ?? []).map((p, k) => (
                    <div key={k} style={{ fontSize: "0.8125rem", color: "#5c6675", display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span>{p.method || "Payment"}{p.reference ? ` · ${p.reference}` : ""}{p.paid_at ? ` · ${new Date(p.paid_at).toLocaleDateString("en-US")}` : ""}</span>
                      <b style={{ color: "#15803d" }}>{money(p.amount_minor, currency)}</b>
                    </div>
                  ))}
                </div>
              )}
              {canRecord && bal > 0 && openId !== inv.id && <button type="button" onClick={() => { setOpenId(inv.id); setMethod("Cash"); setErr(null); }} style={{ ...btn, marginTop: 10 }}><span aria-hidden="true">➕</span> Record payment</button>}
              {openId === inv.id && (
                <form action={(fd) => submit(inv.id, fd)} style={{ marginTop: 10, borderTop: "1px solid #eef1f6", paddingTop: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <label style={{ display: "block" }}><span style={lbl}>Amount</span><input name="amount" type="number" step="0.01" defaultValue={(bal / 100).toFixed(2)} style={inp} /></label>
                    <label style={{ display: "block" }}><span style={lbl}>Method</span><select name="method" value={method} onChange={(e) => setMethod(e.target.value)} style={inp}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
                  </div>
                  {NEEDS_REF.includes(method) && (
                    <div style={{ marginTop: 8 }}>
                      <label style={{ display: "block" }}>
                        <span style={lbl}>{REF_LABEL[method]}</span>
                        <input name="reference" style={inp} placeholder={`Enter ${method.toLowerCase()} reference`} />
                      </label>
                    </div>
                  )}
                  {err && <div style={errBox}>{err}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button type="submit" disabled={pending} style={btn}>{pending ? "Saving…" : <><span aria-hidden="true">💾</span> Save payment</>}</button>
                    <button type="button" onClick={() => setOpenId(null)} style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}>Cancel</button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "9px 15px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const lbl: React.CSSProperties = { fontSize: "0.75rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 5 };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: "1rem", outline: "none" };
const errBox: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "8px 12px", borderRadius: 10, fontSize: "0.8125rem", marginTop: 8 };
