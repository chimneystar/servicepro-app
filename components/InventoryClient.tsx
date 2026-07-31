"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { saveInventoryItem, adjustQuantity, deleteInventoryItem, type ActionResult } from "@/app/(app)/inventory/actions";
// @ts-ignore — pure logic, unit-tested in tests/inventory.test.mjs
import { formatQtyMilli, isOversold } from "@/lib/core/inventory.mjs";
import Modal from "@/components/Modal";

export type Item = { id: string; name: string; sku: string | null; unit: string; quantity: number; quantity_milli: number; low_stock_threshold: number; cost_minor: number };
const sym: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };

export default function InventoryClient({ items, currency }: { items: Item[]; currency: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Item | null | undefined>(undefined);
  const titleId = useId();
  const [state, formAction] = useFormState(saveInventoryItem, { ok: false } as ActionResult);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const cur = sym[currency] ?? "$";
  if (state.ok && editing !== undefined) setTimeout(() => { setEditing(undefined); router.refresh(); }, 0);

  const low = items.filter((i) => i.low_stock_threshold > 0 && i.quantity <= i.low_stock_threshold);
  const oversold = items.filter((i) => isOversold(i));
  // Every +/- press is now a ledger row, and the result is no longer discarded:
  // a refusal (there is none left) used to vanish and leave the number unchanged
  // with no explanation.
  const adj = async (id: string, d: number) => {
    setAdjustError(null);
    const r = await adjustQuantity(id, d);
    if (!r.ok && r.code === "insufficient_stock") {
      if (confirm(`${r.error} Record it anyway and flag this item for a stock count?`)) {
        const forced = await adjustQuantity(id, d, "Counted out below zero — needs a stock count", true);
        if (!forced.ok) setAdjustError(forced.error ?? "Could not record that.");
      }
    } else if (!r.ok) {
      setAdjustError(r.error ?? "Could not record that.");
    }
    router.refresh();
  };
  const del = (id: string) => { if (confirm("Delete this item?")) deleteInventoryItem(id).then(() => router.refresh()); };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "#5c6675" }}>{items.length} items{low.length ? ` · ${low.length} low` : ""}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/inventory/movements" style={{ ...btn, background: "#eef2f8", color: "#2563eb", textDecoration: "none" }}>📜 Stock history</Link>
          <Link href="/inventory/receiving" style={{ ...btn, background: "#eef2f8", color: "#2563eb", textDecoration: "none" }}>📦 Receiving</Link>
          <button type="button" onClick={() => setEditing(null)} style={btn}><span aria-hidden="true">➕</span> Add item</button>
        </div>
      </div>

      {low.length > 0 && (
        <div style={{ background: "#fdeaea", border: "1px solid #f5b5b5", color: "#b91c1c", borderRadius: 12, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>
          ⚠️ Low stock: {low.map((i) => i.name).join(", ")}
        </div>
      )}

      {oversold.length > 0 && (
        <div role="alert" style={{ background: "#fff7ed", border: "1px solid #fdba74", color: "#9a3412", borderRadius: 12, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>
          🧮 Needs a stock count — more was used than the system held: {oversold.map((i) => `${i.name} (${formatQtyMilli(i.quantity_milli)})`).join(", ")}
        </div>
      )}

      {adjustError && <div role="alert" style={{ ...err, marginTop: 0, marginBottom: 12 }}>{adjustError}</div>}

      <div style={{ display: "grid", gap: 8 }}>
        {items.map((it) => {
          const isLow = it.low_stock_threshold > 0 && it.quantity <= it.low_stock_threshold;
          return (
            <div key={it.id} style={{ background: "#fff", border: `1px solid ${isLow ? "#f5b5b5" : "#e2e8f0"}`, borderRadius: 12, padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{it.name} {isLow && <span style={{ color: "#b91c1c", fontSize: 12 }}>· low</span>}</div>
                <div style={{ fontSize: 12.5, color: "#5c6675" }}>{[it.sku && `SKU ${it.sku}`, `${cur}${(it.cost_minor / 100).toFixed(2)}/${it.unit}`].filter(Boolean).join(" · ")}</div>
              </div>
              <button type="button" onClick={() => adj(it.id, -1)} style={qBtn} aria-label={`Decrease quantity of ${it.name}`}>−</button>
              <b style={{ minWidth: 40, textAlign: "center", color: isOversold(it) ? "#9a3412" : isLow ? "#b91c1c" : "#0b1524" }}>{formatQtyMilli(it.quantity_milli)}</b>
              <button type="button" onClick={() => adj(it.id, 1)} style={qBtn} aria-label={`Increase quantity of ${it.name}`}>+</button>
              <button type="button" onClick={() => setEditing(it)} style={mini} aria-label={`Edit ${it.name}`}>✏️</button>
              <button type="button" onClick={() => del(it.id)} style={{ ...mini, background: "#fdeaea" }} aria-label={`Delete ${it.name}`}>🗑️</button>
            </div>
          );
        })}
        {items.length === 0 && <div className="rempty">No inventory yet. Add your parts & materials.</div>}
      </div>

      {editing !== undefined && (
        <Modal onClose={() => setEditing(undefined)} labelledBy={titleId} width={440}>
          <form action={formAction}>
            <h3 id={titleId} style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>{editing ? "Edit item" : "New item"}</h3>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <label style={{ display: "block" }}><L>Name</L><input name="name" defaultValue={editing?.name ?? ""} style={inp} required /></label>
            <div style={two}>
              <div><label style={{ display: "block" }}><L>SKU</L><input name="sku" defaultValue={editing?.sku ?? ""} style={inp} /></label></div>
              <div><label style={{ display: "block" }}><L>Unit</L><input name="unit" defaultValue={editing?.unit ?? "unit"} style={inp} /></label></div>
            </div>
            <div style={two}>
              <div><label style={{ display: "block" }}><L>Quantity</L><input name="quantity" type="number" step="0.001" defaultValue={editing ? formatQtyMilli(editing.quantity_milli) : 0} style={inp} /></label></div>
              <div><label style={{ display: "block" }}><L>Low-stock alert at</L><input name="low" type="number" defaultValue={editing?.low_stock_threshold ?? 0} style={inp} /></label></div>
            </div>
            {editing && <label style={{ display: "block" }}><L>Why is the count changing?</L><input name="reason" style={inp} placeholder="Stocktake, breakage, returned to vendor…" /></label>}
            <label style={{ display: "block" }}><L>Cost per unit</L><input name="cost" type="number" step="0.01" defaultValue={editing ? (editing.cost_minor / 100).toFixed(2) : ""} style={inp} placeholder="0.00" /></label>
            {state.error && <div style={err}>{state.error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}><Save /><button type="button" onClick={() => setEditing(undefined)} style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}>Cancel</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Save() { const { pending } = useFormStatus(); return <button type="submit" disabled={pending} style={btn}>{pending ? "Saving…" : "💾 Save"}</button>; }
function L({ children }: { children: React.ReactNode }) { return <span style={lbl}>{children}</span>; }
const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "9px 15px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const qBtn: React.CSSProperties = { background: "#eef2f8", color: "#2563eb", border: "none", borderRadius: 8, width: 32, height: 32, fontSize: 18, fontWeight: 800, cursor: "pointer", flexShrink: 0 };
const mini: React.CSSProperties = { background: "#eef2f8", border: "none", borderRadius: 8, padding: "5px 8px", cursor: "pointer", fontSize: 13, flexShrink: 0 };
const two: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", margin: "10px 0 6px" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 16, outline: "none" };
const err: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "9px 12px", borderRadius: 10, fontSize: 13, marginTop: 10 };
