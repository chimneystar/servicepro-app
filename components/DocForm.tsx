"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { t, type Locale } from "@/lib/i18n";
import type { ActionResult } from "@/lib/documents";

type Opt = { id: string; label: string };
type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

const initial: ActionResult = { ok: false };

export default function DocForm({ locale, customers, action, newKey, catalog = [] }: {
  locale: Locale; customers: Opt[]; action: Action; newKey: string;
  catalog?: { id: string; name: string; price_minor: number; cost_minor: number }[];
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([{ desc: "", qty: "1", price: "", cost: "" }]);
  const [state, formAction] = useFormState(action, initial);
  if (state.ok && open) setTimeout(() => { setOpen(false); setRows([{ desc: "", qty: "1", price: "", cost: "" }]); }, 0);

  return (
    <>
      <button onClick={() => setOpen(true)} style={btn}>➕ {t(locale, newKey)}</button>
      {open && (
        <div style={overlay} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form action={formAction} style={modal}>
            <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 14 }}>{t(locale, newKey)}</h3>
            <label style={lbl}>{t(locale, "doc.customer")}</label>
            <select name="customer_id" style={inp} required>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>

            <label style={{ ...lbl, marginTop: 14 }}>{t(locale, "doc.items")}</label>
            {catalog.length > 0 && (
              <select style={{ ...inp, marginBottom: 8 }} defaultValue="" onChange={(e) => { const it = catalog.find((c) => c.id === e.target.value); if (it) setRows([...rows, { desc: it.name, qty: "1", price: (it.price_minor / 100).toFixed(2), cost: (it.cost_minor / 100).toFixed(2) }]); e.currentTarget.value = ""; }}>
                <option value="">{t(locale, "pb.from_catalog")}</option>
                {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <div className="li-head" style={{ fontSize: 11, color: "#5c6675", fontWeight: 700, marginBottom: 4 }}>
              <span>{t(locale, "doc.desc")}</span><span>{t(locale, "doc.qty")}</span><span>{t(locale, "doc.unit")}</span><span>{t(locale, "doc.cost")}</span><span></span>
            </div>
            {rows.map((r, i) => (
              <div key={i} className="li-row">
                <input name="desc" className="li-desc" defaultValue={r.desc} style={cell} placeholder={t(locale, "doc.desc")} />
                <input name="qty" defaultValue={r.qty} type="number" step="0.001" style={cell} placeholder={t(locale, "doc.qty")} />
                <input name="price" defaultValue={r.price} type="number" step="0.01" style={cell} placeholder={t(locale, "doc.unit")} />
                <input name="cost" defaultValue={r.cost} type="number" step="0.01" style={cell} placeholder={t(locale, "doc.cost")} />
                <button type="button" onClick={() => setRows(rows.filter((_, k) => k !== i))} style={xBtn}>✕</button>
              </div>
            ))}
            <button type="button" onClick={() => setRows([...rows, { desc: "", qty: "1", price: "", cost: "" }])} style={{ ...btn, background: "#e2e9f4", color: "#2563eb", padding: "7px 12px", fontSize: 13, marginTop: 4 }}>➕ {t(locale, "doc.add_item")}</button>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
              <div><label style={lbl}>{t(locale, "doc.discount")}</label><input name="discount" type="number" step="0.01" defaultValue="0" style={inp} /></div>
            </div>
            <label style={lbl}>{t(locale, "form.notes")}</label>
            <textarea name="notes" rows={2} style={inp} />
            <div style={{ fontSize: 12, color: "#5c6675", marginTop: 8 }}>ℹ️ {t(locale, "doc.tax")} & {t(locale, "doc.grand").toLowerCase()} — {t(locale, "common.saving").replace("…", "")} on save.</div>
            {state.error && <div style={err}>{state.error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <Save locale={locale} />
              <button type="button" onClick={() => setOpen(false)} style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}>{t(locale, "common.cancel")}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function Save({ locale }: { locale: Locale }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} style={btn}>{pending ? t(locale, "common.saving") : `💾 ${t(locale, "common.save")}`}</button>;
}

const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "10px 16px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15,30,61,.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 30, zIndex: 100, overflowY: "auto" };
const modal: React.CSSProperties = { background: "#fff", borderRadius: 18, width: "100%", maxWidth: 560, padding: 22 };
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", margin: "6px 0 6px" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none" };
const cell: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px", fontSize: 13, outline: "none", width: "100%" };
const xBtn: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", border: "none", borderRadius: 8, cursor: "pointer" };
const err: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "9px 12px", borderRadius: 10, fontSize: 13, marginTop: 12 };
