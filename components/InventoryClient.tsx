"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { saveInventoryItem, adjustQuantity, deleteInventoryItem, type ActionResult } from "@/app/(app)/inventory/actions";

export type Item = { id: string; name: string; sku: string | null; unit: string; quantity: number; low_stock_threshold: number; cost_minor: number };
const sym: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };

export default function InventoryClient({ items, currency }: { items: Item[]; currency: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Item | null | undefined>(undefined);
  const [state, formAction] = useFormState(saveInventoryItem, { ok: false } as ActionResult);
  const cur = sym[currency] ?? "$";
  if (state.ok && editing !== undefined) setTimeout(() => { setEditing(undefined); router.refresh(); }, 0);

  const low = items.filter((i) => i.low_stock_threshold > 0 && i.quantity <= i.low_stock_threshold);
  const adj = (id: string, d: number) => { adjustQuantity(id, d).then(() => router.refresh()); };
  const del = (id: string) => { if (confirm("Delete this item?")) deleteInventoryItem(id).then(() => router.refresh()); };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 14, color: "#5c6675" }}>{items.length} items{low.length ? ` · ${low.length} low` : ""}</div>
        <button onClick={() => setEditing(null)} style={btn}>➕ Add item</button>
      </div>

      {low.length > 0 && (
        <div style={{ background: "#fdeaea", border: "1px solid #f5b5b5", color: "#b91c1c", borderRadius: 12, padding: "10px 14px", fontSize: 14, marginBottom: 12 }}>
          ⚠️ Low stock: {low.map((i) => i.name).join(", ")}
        </div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        {items.map((it) => {
          const isLow = it.low_stock_threshold > 0 && it.quantity <= it.low_stock_threshold;
          return (
            <div key={it.id} style={{ background: "#fff", border: `1px solid ${isLow ? "#f5b5b5" : "#e2e8f0"}`, borderRadius: 12, padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{it.name} {isLow && <span style={{ color: "#b91c1c", fontSize: 14 }}>· low</span>}</div>
                <div style={{ fontSize: 14, color: "#5c6675" }}>{[it.sku && `SKU ${it.sku}`, `${cur}${(it.cost_minor / 100).toFixed(2)}/${it.unit}`].filter(Boolean).join(" · ")}</div>
              </div>
              <button onClick={() => adj(it.id, -1)} style={qBtn}>−</button>
              <b style={{ minWidth: 40, textAlign: "center", color: isLow ? "#b91c1c" : "#0b1524" }}>{it.quantity}</b>
              <button onClick={() => adj(it.id, 1)} style={qBtn}>+</button>
              <button onClick={() => setEditing(it)} style={mini}>✏️</button>
              <button onClick={() => del(it.id)} style={{ ...mini, background: "#fdeaea" }}>🗑️</button>
            </div>
          );
        })}
        {items.length === 0 && <div className="rempty">No inventory yet. Add your parts & materials.</div>}
      </div>

      {editing !== undefined && (
        <div style={overlay} onClick={(e) => e.target === e.currentTarget && setEditing(undefined)}>
          <form action={formAction} style={modal}>
            <h3 style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>{editing ? "Edit item" : "New item"}</h3>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <L>Name</L><input name="name" defaultValue={editing?.name ?? ""} style={inp} required />
            <div style={two}>
              <div><L>SKU</L><input name="sku" defaultValue={editing?.sku ?? ""} style={inp} /></div>
              <div><L>Unit</L><input name="unit" defaultValue={editing?.unit ?? "unit"} style={inp} /></div>
            </div>
            <div style={two}>
              <div><L>Quantity</L><input name="quantity" type="number" defaultValue={editing?.quantity ?? 0} style={inp} /></div>
              <div><L>Low-stock alert at</L><input name="low" type="number" defaultValue={editing?.low_stock_threshold ?? 0} style={inp} /></div>
            </div>
            <L>Cost per unit</L><input name="cost" type="number" step="0.01" defaultValue={editing ? (editing.cost_minor / 100).toFixed(2) : ""} style={inp} placeholder="0.00" />
            {state.error && <div style={err}>{state.error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}><Save /><button type="button" onClick={() => setEditing(undefined)} style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}>Cancel</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

function Save() { const { pending } = useFormStatus(); return <button type="submit" disabled={pending} style={btn}>{pending ? "Saving…" : "💾 Save"}</button>; }
function L({ children }: { children: React.ReactNode }) { return <label style={lbl}>{children}</label>; }
const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "9px 15px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const qBtn: React.CSSProperties = { background: "#eef2f8", color: "#2563eb", border: "none", borderRadius: 8, width: 32, height: 32, fontSize: 18, fontWeight: 800, cursor: "pointer", flexShrink: 0 };
const mini: React.CSSProperties = { background: "#eef2f8", border: "none", borderRadius: 8, padding: "5px 8px", cursor: "pointer", fontSize: 14, flexShrink: 0 };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15,30,61,.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, zIndex: 100, overflowY: "auto" };
const modal: React.CSSProperties = { background: "#fff", borderRadius: 18, width: "100%", maxWidth: 440, padding: 22 };
const two: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const lbl: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: "#334155", display: "block", margin: "10px 0 6px" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 16, outline: "none" };
const err: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "9px 12px", borderRadius: 10, fontSize: 14, marginTop: 10 };
