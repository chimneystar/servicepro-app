"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { t, type Locale } from "@/lib/i18n";
import type { ActionResult } from "@/lib/documents";
import Modal from "@/components/Modal";

type Opt = { id: string; label: string };
type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
export type CatalogItem = { id: string; name: string; description?: string | null; price_minor: number; cost_minor: number; taxable?: boolean; image_path?: string | null };

type Row = { title: string; desc: string; qty: string; price: string; cost: string; taxable: boolean; image_path: string; uploading?: boolean };
const blankRow = (): Row => ({ title: "", desc: "", qty: "1", price: "", cost: "", taxable: true, image_path: "" });
const initial: ActionResult = { ok: false };

export default function DocForm({ locale, customers, action, newKey, catalog = [], orgId, initialOpen = false }: {
  locale: Locale; customers: Opt[]; action: Action; newKey: string; catalog?: CatalogItem[]; orgId: string; initialOpen?: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();
  const he = locale === "he";
  const [open, setOpen] = useState(initialOpen);
  const titleId = useId();
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [state, formAction] = useFormState(action, initial);
  if (state.ok && open) setTimeout(() => { setOpen(false); setRows([blankRow()]); router.refresh(); }, 0);

  function update(i: number, patch: Partial<Row>) { setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r))); }
  function addFromCatalog(id: string) {
    const it = catalog.find((c) => c.id === id); if (!it) return;
    setRows((rs) => [...rs, { title: it.name, desc: it.description ?? "", qty: "1", price: (it.price_minor / 100).toFixed(2), cost: (it.cost_minor / 100).toFixed(2), taxable: it.taxable !== false, image_path: it.image_path ?? "" }]);
  }
  async function uploadPhoto(i: number, file: File) {
    update(i, { uploading: true });
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${orgId}/items/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("item-photos").upload(path, file, { upsert: false });
      if (error) throw error;
      update(i, { image_path: path, uploading: false });
    } catch { update(i, { uploading: false }); }
  }

  const previewSubtotal = rows.reduce((s, r) => {
    const q = parseFloat(r.qty || "0") || 0; const p = parseFloat(r.price || "0") || 0;
    return s + Math.round(q * p * 100);
  }, 0);
  const sym = SYM[/* currency unknown here */ "USD"];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={btn}><span aria-hidden="true">➕</span> {t(locale, newKey)}</button>
      {open && (
        <Modal onClose={() => setOpen(false)} labelledBy={titleId} width={580}>
          <form action={formAction}>
            <h3 id={titleId} style={{ fontSize: 18, fontWeight: 800, marginBottom: 14 }}>{t(locale, newKey)}</h3>
            <label style={{ display: "block" }}>
              <span style={lbl}>{t(locale, "doc.customer")}</span>
              <select name="customer_id" style={inp} required>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>

            <label style={{ ...lbl, marginTop: 14 }}>{t(locale, "doc.items")}</label>
            {catalog.length > 0 && (
              <select style={{ ...inp, marginBottom: 10 }} defaultValue="" onChange={(e) => { addFromCatalog(e.target.value); e.currentTarget.value = ""; }} aria-label={he ? "שימוש חוזר בפריט שמור" : "Reuse a saved item"}>
                <option value="">📚 Reuse a saved item…</option>
                {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}

            {rows.map((r, i) => (
              <div key={i} style={itemCard}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input name="title" value={r.title} onChange={(e) => update(i, { title: e.target.value })} style={{ ...cell, fontWeight: 700 }} placeholder="Item title" aria-label="Item title" />
                  <button type="button" onClick={() => setRows(rows.filter((_, k) => k !== i))} style={xBtn} aria-label={he ? "הסרת שורה" : "Remove row"}>✕</button>
                </div>
                <textarea name="desc" value={r.desc} onChange={(e) => update(i, { desc: e.target.value })} rows={2} style={{ ...cell, marginTop: 6 }} placeholder="Description (optional)" aria-label="Description (optional)" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 6 }}>
                  <div><label style={{ display: "block" }}><span style={miniLbl}>Qty</span><input name="qty" value={r.qty} onChange={(e) => update(i, { qty: e.target.value })} type="number" step="0.001" style={cell} /></label></div>
                  <div><label style={{ display: "block" }}><span style={miniLbl}>Unit price</span><input name="price" value={r.price} onChange={(e) => update(i, { price: e.target.value })} type="number" step="0.01" style={cell} placeholder="0.00" /></label></div>
                  <div><label style={{ display: "block" }}><span style={miniLbl}>Cost</span><input name="cost" value={r.cost} onChange={(e) => update(i, { cost: e.target.value })} type="number" step="0.01" style={cell} placeholder="0.00" /></label></div>
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                  <input type="hidden" name="taxable" value={r.taxable ? "1" : "0"} />
                  <input type="hidden" name="image_path" value={r.image_path} />
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    <input type="checkbox" checked={r.taxable} onChange={(e) => update(i, { taxable: e.target.checked })} style={{ width: 18, height: 18 }} /> Taxable
                  </label>
                  <label style={photoBtn}>
                    <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadPhoto(i, e.target.files[0])} style={{ display: "none" }} />
                    {r.uploading ? "Uploading…" : r.image_path ? "✓ Photo added" : "📷 Add photo"}
                  </label>
                  {r.image_path && <button type="button" onClick={() => update(i, { image_path: "" })} style={{ ...xBtn, background: "#eef2f8", color: "#5c6675" }}>remove photo</button>}
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setRows([...rows, blankRow()])} style={{ ...btn, background: "#e2e9f4", color: "#2563eb", padding: "8px 12px", fontSize: 13, marginTop: 4 }}><span aria-hidden="true">➕</span> {t(locale, "doc.add_item")}</button>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
              <div><label style={{ display: "block" }}><span style={lbl}>{t(locale, "doc.discount")}</span><input name="discount" type="number" step="0.01" defaultValue="0" style={inp} /></label></div>
              <div style={{ alignSelf: "end", textAlign: "end", fontSize: 13, color: "#5c6675", paddingBottom: 10 }}>Items subtotal ≈ {sym}{(previewSubtotal / 100).toFixed(2)}</div>
            </div>
            <label style={{ display: "block" }}>
              <span style={lbl}>{t(locale, "form.notes")}</span>
              <textarea name="notes" rows={2} style={inp} />
            </label>
            <div style={{ fontSize: 12, color: "#5c6675", marginTop: 8 }}>ℹ️ Tax & total are calculated on save (only taxable items are taxed). New items are saved to your library for reuse.</div>
            {state.error && <div style={err}>{state.error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <Save locale={locale} />
              <button type="button" onClick={() => setOpen(false)} style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}>{t(locale, "common.cancel")}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

const SYM: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };

function Save({ locale }: { locale: Locale }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} style={btn}>{pending ? t(locale, "common.saving") : `💾 ${t(locale, "common.save")}`}</button>;
}

const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "10px 16px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const itemCard: React.CSSProperties = { background: "#f8fbff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, marginBottom: 10 };
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", margin: "6px 0 6px" };
const miniLbl: React.CSSProperties = { fontSize: 10.5, color: "#5c6675", fontWeight: 700, display: "block", marginBottom: 3 };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 16, outline: "none" };
const cell: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px", fontSize: 14, outline: "none", width: "100%" };
const photoBtn: React.CSSProperties = { background: "#e0ebff", color: "#2563eb", borderRadius: 8, padding: "7px 12px", fontWeight: 700, fontSize: 13, cursor: "pointer" };
const xBtn: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", border: "none", borderRadius: 8, padding: "6px 9px", cursor: "pointer", flexShrink: 0 };
const err: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "9px 12px", borderRadius: 10, fontSize: 13, marginTop: 12 };
