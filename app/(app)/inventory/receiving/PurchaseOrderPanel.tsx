"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";
import { addPurchaseOrderLine, advancePurchaseOrderStatus, receivePurchaseOrderLine } from "@/app/(app)/operations/actions";
// @ts-ignore — pure logic, unit-tested in tests/inventory.test.mjs
import { formatQtyMilli, outstandingMilli, purchaseOrderStatusFromLines } from "@/lib/core/inventory.mjs";

export type PoLine = {
  id: string;
  purchase_order_id: string;
  description: string;
  qty_milli: number;
  received_qty_milli: number;
  unit_cost_minor: number;
  inventory_item_id: string | null;
};

export type PoRow = {
  id: string;
  po_number: string;
  status: string;
  total_minor: number;
  expected_date: string | null;
  vendor: string | null;
  lines: PoLine[];
};

export default function PurchaseOrderPanel({
  orders, inventory, currency,
}: { orders: PoRow[]; inventory: { id: string; name: string; unit: string }[]; currency: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Could not save that.");
      else { setAddingTo(null); router.refresh(); }
    });
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {error && <div role="alert" style={errBox}>{error}</div>}
      {orders.map((po) => {
        // What the status WOULD be given the lines — shown so an operator can
        // see a PO is fully received before pressing anything.
        const settled = purchaseOrderStatusFromLines(po.lines, po.status);
        return (
          <div key={po.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <div>
                <b>{po.po_number}</b>{po.vendor ? ` · ${po.vendor}` : ""}
                <div style={{ fontSize: 12.5, color: "#5c6675" }}>
                  {po.status.replaceAll("_", " ")}{po.expected_date ? ` · expected ${po.expected_date}` : ""}
                  {settled === "received" && po.status !== "received" ? " · all lines are in" : ""}
                </div>
              </div>
              <b>{money(po.total_minor, currency)}</b>
            </div>

            <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
              {po.lines.map((line) => {
                const outstanding = outstandingMilli(line);
                return (
                  <div key={line.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", borderTop: "1px solid #eef2f8", paddingTop: 8 }}>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontWeight: 600 }}>{line.description}</div>
                      <div style={{ fontSize: 12.5, color: "#5c6675" }}>
                        {formatQtyMilli(line.received_qty_milli)} / {formatQtyMilli(line.qty_milli)} received · {money(line.unit_cost_minor, currency)} each
                        {!line.inventory_item_id && <span style={{ color: "#9a3412" }}> · not linked to stock</span>}
                      </div>
                    </div>
                    {outstanding > 0 && po.status !== "cancelled" && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => receivePurchaseOrderLine(line.id, formatQtyMilli(outstanding)))}
                        style={smallBtn}
                      >
                        Receive {formatQtyMilli(outstanding)}
                      </button>
                    )}
                  </div>
                );
              })}
              {po.lines.length === 0 && <div style={{ fontSize: 13, color: "#5c6675" }}>No lines yet.</div>}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {po.status === "draft" && (
                <button type="button" disabled={pending} onClick={() => run(() => advancePurchaseOrderStatus(po.id, "ordered"))} style={smallBtn}>Mark ordered</button>
              )}
              <button type="button" disabled={pending} onClick={() => setAddingTo(addingTo === po.id ? null : po.id)} style={{ ...smallBtn, background: "#eef2f8", color: "#2563eb" }}>Add line</button>
              <button
                type="button"
                disabled={pending}
                onClick={() => { if (confirm(`Cancel ${po.po_number}?`)) run(() => advancePurchaseOrderStatus(po.id, "cancelled")); }}
                style={{ ...smallBtn, background: "#fdeaea", color: "#b91c1c" }}
              >Cancel PO</button>
            </div>

            {addingTo === po.id && (
              <form
                action={(formData) => run(() => addPurchaseOrderLine({ ok: false }, formData))}
                style={{ background: "#f8fbff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, marginTop: 10 }}
              >
                <input type="hidden" name="purchaseOrderId" value={po.id} />
                <input name="description" placeholder="Item or material" aria-label="Item or material" style={inp} required />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr", gap: 8, marginTop: 8 }}>
                  <input name="quantity" type="number" step="0.001" min="0.001" defaultValue="1" aria-label="Quantity" style={inp} />
                  <input name="unitCost" type="number" step="0.01" min="0" placeholder="Unit cost" aria-label="Unit cost" style={inp} />
                  <select name="inventoryItemId" style={inp} aria-label="Linked inventory item">
                    <option value="">Not stocked</option>
                    {inventory.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </div>
                <button type="submit" disabled={pending} style={{ ...smallBtn, marginTop: 10 }}>{pending ? "Saving…" : "Add line"}</button>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}

const smallBtn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "7px 12px", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontSize: 13 };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 11px", fontSize: 15, outline: "none" };
const errBox: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "8px 12px", borderRadius: 10, fontSize: 13 };
