"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordStockMovement } from "../actions";
// @ts-ignore — pure logic, unit-tested in tests/inventory.test.mjs
import { formatQtyMilli } from "@/lib/core/inventory.mjs";

type ItemRow = { id: string; name: string; unit: string; quantity_milli: number };

/**
 * Record a receipt, a consumption or a correction against the ledger.
 *
 * When the database refuses because there is not enough stock, the refusal is
 * NOT the end of the conversation: the part may genuinely have been used. The
 * form offers to record it anyway, which requires a reason and flags the item
 * for a stock count. See db/033_inventory_movements.sql for why that choice was
 * made rather than a hard refusal.
 */
export default function MovementForm({ items }: { items: ItemRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [needsOverride, setNeedsOverride] = useState(false);
  const [kind, setKind] = useState("receipt");

  function submit(formData: FormData) {
    setError(null);
    start(async () => {
      if (needsOverride) formData.set("allowNegative", "true");
      const r = await recordStockMovement({ ok: false }, formData);
      if (r.ok) {
        setOpen(false); setNeedsOverride(false); router.refresh();
        return;
      }
      setError(r.error ?? "Could not record that.");
      setNeedsOverride(r.code === "insufficient_stock");
    });
  }

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} style={btn}>➕ Record a stock movement</button>;
  }

  return (
    <form action={submit} style={{ background: "#f8fbff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
        <select name="itemId" style={inp} required aria-label="Choose an item">
          <option value="">Choose an item</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>{i.name} ({formatQtyMilli(i.quantity_milli)} {i.unit})</option>
          ))}
        </select>
        <select name="kind" style={inp} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Movement type">
          <option value="receipt">Received in</option>
          <option value="consumption">Used</option>
          <option value="adjustment">Correction</option>
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: kind === "adjustment" ? "1fr 1fr 1fr" : "1fr 1fr", gap: 8, marginTop: 8 }}>
        <input name="qty" type="number" step="0.001" min="0.001" placeholder="Quantity" aria-label="Quantity" style={inp} required />
        {kind === "adjustment" && (
          <select name="direction" style={inp} aria-label="Direction">
            <option value="in">Add</option>
            <option value="out">Remove</option>
          </select>
        )}
        <input name="unitCost" type="number" step="0.01" min="0" placeholder="Unit cost (optional)" aria-label="Unit cost (optional)" style={inp} />
      </div>
      <input name="reason" placeholder="Why? (delivery note, stocktake, breakage…)" aria-label="Why? (delivery note, stocktake, breakage…)" style={{ ...inp, marginTop: 8 }} required />
      {error && <div role="alert" style={errBox}>{error}</div>}
      {needsOverride && (
        <label style={{ display: "block", fontSize: "0.8125rem", color: "#9a3412", marginTop: 8 }}>
          <input type="checkbox" name="allowNegative" value="true" defaultChecked /> Record it anyway — the stock was really used. The item is flagged for a count.
        </label>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="submit" disabled={pending} style={btn}>{pending ? "Saving…" : "Save movement"}</button>
        <button type="button" onClick={() => { setOpen(false); setError(null); setNeedsOverride(false); }} style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}>Cancel</button>
      </div>
    </form>
  );
}

const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "9px 15px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: "1rem", outline: "none" };
const errBox: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "8px 12px", borderRadius: 10, fontSize: "0.8125rem", marginTop: 8 };
