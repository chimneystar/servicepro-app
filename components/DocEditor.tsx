"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import type { ActionResult } from "@/lib/documents";
import type { CatalogItem } from "@/components/DocForm";

type Opt = { id: string; label: string };
type Row = { title: string; desc: string; qty: string; price: string; cost: string; taxable: boolean; image_path: string; uploading?: boolean };
export type EditInitial = {
  customer_id: string; discount: string; notes: string; issue_date: string; deposit?: string; items: Row[];
  /** The row version this form was loaded from (ledger 6a.6). */
  version?: number;
};

export default function DocEditor({ kind, docId, action, customers, catalog = [], orgId, initial, returnHref }: {
  kind: "estimate" | "invoice"; docId: string;
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  customers: Opt[]; catalog?: CatalogItem[]; orgId: string; initial: EditInitial; returnHref: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const he = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const [rows, setRows] = useState<Row[]>(initial.items.length ? initial.items : [{ title: "", desc: "", qty: "1", price: "", cost: "", taxable: true, image_path: "" }]);
  const [state, formAction] = useFormState(action, { ok: false } as ActionResult);
  if (state.ok) setTimeout(() => router.push(returnHref), 0);

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
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
  const subtotal = rows.reduce((s, r) => s + Math.round((parseFloat(r.qty || "0") || 0) * (parseFloat(r.price || "0") || 0) * 100), 0);

  return (
    <form action={formAction} style={{ maxWidth: 640 }}>
      {/*
        Optimistic concurrency (ledger 6a.6). The version this form was loaded
        from travels with the save; the server refuses the write if the row has
        moved on, instead of the second person's save silently erasing the
        first's — which is what happened in a three-person office every time two
        people opened the same estimate.
      */}
      <input type="hidden" name="version" value={String(initial.version ?? "")} />
      <label style={{ display: "block" }}>
        <span style={lbl}>Customer</span>
        <select name="customer_id" defaultValue={initial.customer_id} style={inp} required>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>

      <div style={{ ...lbl, marginTop: 14 }}>Line items</div>
      {catalog.length > 0 && (
        <select aria-label={he ? "שימוש חוזר בפריט שמור" : "Reuse a saved item"} style={{ ...inp, marginBottom: 10 }} defaultValue="" onChange={(e) => { addFromCatalog(e.target.value); e.currentTarget.value = ""; }}>
          <option value="">📚 Reuse a saved item…</option>
          {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      {rows.map((r, i) => (
        <div key={i} style={itemCard}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input name="title" value={r.title} onChange={(e) => update(i, { title: e.target.value })} style={{ ...cell, fontWeight: 700 }} placeholder="Item title" aria-label="Item title" />
            <button type="button" onClick={() => setRows(rows.filter((_, k) => k !== i))} style={xBtn} aria-label={he ? "הסרת פריט זה" : "Remove this item"}>✕</button>
          </div>
          <textarea name="desc" value={r.desc} onChange={(e) => update(i, { desc: e.target.value })} rows={2} style={{ ...cell, marginTop: 6 }} placeholder="Description (optional)" aria-label="Description (optional)" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 6 }}>
            <label style={{ display: "block" }}><span style={miniLbl}>Qty</span><input name="qty" value={r.qty} onChange={(e) => update(i, { qty: e.target.value })} type="number" step="0.001" style={cell} /></label>
            <label style={{ display: "block" }}><span style={miniLbl}>Unit price</span><input name="price" value={r.price} onChange={(e) => update(i, { price: e.target.value })} type="number" step="0.01" style={cell} /></label>
            <label style={{ display: "block" }}><span style={miniLbl}>Cost</span><input name="cost" value={r.cost} onChange={(e) => update(i, { cost: e.target.value })} type="number" step="0.01" style={cell} /></label>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <input type="hidden" name="taxable" value={r.taxable ? "1" : "0"} />
            <input type="hidden" name="image_path" value={r.image_path} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer" }}>
              <input type="checkbox" checked={r.taxable} onChange={(e) => update(i, { taxable: e.target.checked })} style={{ width: 18, height: 18 }} /> Taxable
            </label>
            <label style={photoBtn}>
              <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadPhoto(i, e.target.files[0])} style={{ display: "none" }} />
              {r.uploading ? "Uploading…" : r.image_path ? "✓ Photo" : "📷 Add photo"}
            </label>
            {r.image_path && <button type="button" onClick={() => update(i, { image_path: "" })} style={{ ...xBtn, background: "#eef2f8", color: "#5c6675" }}>remove</button>}
          </div>
        </div>
      ))}
      <button type="button" onClick={() => setRows([...rows, { title: "", desc: "", qty: "1", price: "", cost: "", taxable: true, image_path: "" }])} style={{ ...btn, background: "#e2e9f4", color: "#2563eb", padding: "8px 12px", fontSize: "0.8125rem", marginTop: 4 }}><span aria-hidden="true">➕</span> Add item</button>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
        <label style={{ display: "block" }}><span style={lbl}>Discount</span><input name="discount" type="number" step="0.01" defaultValue={initial.discount} style={inp} /></label>
        <label style={{ display: "block" }}><span style={lbl}>Date</span><input name="issue_date" type="date" defaultValue={initial.issue_date} style={inp} /></label>
      </div>
      {kind === "estimate" && (
        <div style={{ marginTop: 10 }}>
          <label style={{ display: "block" }}>
            <span style={lbl}>Deposit to request (optional)</span>
            <input name="deposit" type="number" step="0.01" defaultValue={initial.deposit ?? "0"} style={inp} placeholder="0.00" />
          </label>
          <div style={{ fontSize: "0.75rem", color: "#5c6675", marginTop: 4 }}>Shown on the estimate as the amount due to schedule the work.</div>
        </div>
      )}
      <div style={{ textAlign: "end", fontSize: "0.8125rem", color: "#5c6675", margin: "6px 2px" }}>Items subtotal ≈ ${(subtotal / 100).toFixed(2)} · tax &amp; total recalculated on save</div>
      <label style={{ display: "block" }}>
        <span style={lbl}>Notes</span>
        <textarea name="notes" rows={3} defaultValue={initial.notes} style={inp} />
      </label>

      {state.error && <div style={err}>{state.error}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <Save />
        <button type="button" onClick={() => router.push(returnHref)} style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}>Cancel</button>
      </div>
    </form>
  );
}

function Save() { const { pending } = useFormStatus(); return <button type="submit" disabled={pending} style={btn}>{pending ? "Saving…" : <><span aria-hidden="true">💾</span> Save changes</>}</button>; }

const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "11px 18px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const itemCard: React.CSSProperties = { background: "#f8fbff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, marginBottom: 10 };
const lbl: React.CSSProperties = { fontSize: "0.8125rem", fontWeight: 700, color: "#334155", display: "block", margin: "6px 0 6px" };
const miniLbl: React.CSSProperties = { fontSize: "0.8125rem", color: "#5c6675", fontWeight: 700, display: "block", marginBottom: 3 };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: "1rem", outline: "none" };
const cell: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px", fontSize: "0.875rem", outline: "none", width: "100%" };
const photoBtn: React.CSSProperties = { background: "#e0ebff", color: "#2563eb", borderRadius: 8, padding: "7px 12px", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer" };
const xBtn: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", border: "none", borderRadius: 8, padding: "6px 9px", cursor: "pointer", flexShrink: 0 };
const err: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "9px 12px", borderRadius: 10, fontSize: "0.8125rem", marginTop: 12 };
