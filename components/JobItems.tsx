"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";
import { addJobItem, deleteJobItem, createInvoiceFromJob } from "@/app/(app)/jobs/[id]/actions";
import { useAppLocale } from "@/components/LocaleProvider";

export type Item = { id: string; description: string; qty_milli: number; unit_price_minor: number; cost_minor: number };

export default function JobItems({ jobId, items, currency, canEdit }: { jobId: string; items: Item[]; currency: string; canEdit: boolean }) {
  const router = useRouter();
  const he = useAppLocale() === "he";
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lineTotal = (it: Item) => Math.round((it.qty_milli * it.unit_price_minor) / 1000);
  const subtotal = items.reduce((s, it) => s + lineTotal(it), 0);

  function submit(formData: FormData) {
    setErr(null);
    start(async () => {
      const r = await addJobItem(jobId, formData);
      if (!r.ok) setErr(r.error ?? (he ? "לא הצלחנו לשמור" : "Could not save")); else { setAdding(false); router.refresh(); }
    });
  }
  function del(id: string) {
    setErr(null);
    start(async () => { const r = await deleteJobItem(id, jobId); if (!r.ok) setErr(r.error ?? (he ? "לא הצלחנו למחוק" : "Could not delete")); else router.refresh(); });
  }
  function makeInvoice() {
    if (!confirm(he ? "ליצור חשבונית מהפריטים האלה?" : "Create an invoice from these items?")) return;
    setErr(null);
    // A refused conversion used to do nothing at all: no redirect, no message.
    start(async () => { const r = await createInvoiceFromJob(jobId); if (!r.ok) setErr(r.error ?? (he ? "לא הצלחנו ליצור חשבונית" : "Could not create invoice")); else router.push("/invoices"); });
  }

  return (
    <div>
      <div className="rlist">
        {items.map((it) => (
          <div className="ritem" key={it.id}>
            <div className="rmain">
              <div className="rtitle">{it.description}</div>
              <div className="rsub">{(it.qty_milli / 1000).toLocaleString("en-US")} × {money(it.unit_price_minor, currency)}</div>
            </div>
            <div className="rend"><b>{money(lineTotal(it), currency)}</b></div>
            {canEdit && <button type="button" onClick={() => del(it.id)} disabled={pending} style={xBtn} aria-label={he ? `מחיקת "${it.description}"` : `Delete "${it.description}"`}>🗑️</button>}
          </div>
        ))}
        {items.length === 0 && <div className="rempty">{he ? "עוד אין פריטים." : "No items yet."}</div>}
      </div>
      {err && !adding && <div role="alert" style={errBox}>{err}</div>}

      {items.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 4px", fontWeight: 800, fontSize: "1rem" }}>
          <span>{he ? "סכום ביניים" : "Subtotal"}</span><span>{money(subtotal, currency)}</span>
        </div>
      )}

      {canEdit && !adding && <button type="button" onClick={() => setAdding(true)} style={btn}>{he ? "הוספת פריט" : "Add item"}</button>}
      {canEdit && items.length > 0 && <button type="button" onClick={makeInvoice} disabled={pending} style={{ ...btn, background: "#e6f6ec", color: "#15803d", marginInlineStart: 8 }}>{he ? "יצירת חשבונית מהפריטים" : "Create invoice from items"}</button>}

      {adding && (
        <form action={submit} style={{ background: "#f8fbff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, marginTop: 10 }}>
          <input name="description" placeholder={he ? "תיאור" : "Description"} aria-label={he ? "תיאור" : "Description"} style={inp} autoFocus />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
            <input name="qty" type="number" step="0.001" defaultValue="1" placeholder={he ? "כמות" : "Qty"} aria-label={he ? "כמות" : "Qty"} style={inp} />
            <input name="price" type="number" step="0.01" placeholder={he ? "מחיר ליחידה" : "Unit price"} aria-label={he ? "מחיר ליחידה" : "Unit price"} style={inp} />
            <input name="cost" type="number" step="0.01" placeholder={he ? "עלות" : "Cost"} aria-label={he ? "עלות" : "Cost"} style={inp} />
          </div>
          {err && <div style={errBox}>{err}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="submit" disabled={pending} style={btn}>{pending ? (he ? "שומרים…" : "Saving…") : (he ? "שמירה" : "Save")}</button>
            <button type="button" onClick={() => setAdding(false)} style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}>{he ? "ביטול" : "Cancel"}</button>
          </div>
        </form>
      )}
    </div>
  );
}

const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "9px 15px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const xBtn: React.CSSProperties = { background: "#fdeaea", border: "none", borderRadius: 8, padding: "5px 8px", cursor: "pointer", marginInlineStart: 8 };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: "1rem", outline: "none" };
const errBox: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "8px 12px", borderRadius: 10, fontSize: "0.8125rem", marginTop: 8 };
