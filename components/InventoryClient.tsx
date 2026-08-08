"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import {
  saveInventoryItem,
  adjustQuantity,
  deleteInventoryItem,
  type ActionResult,
} from "@/app/(app)/inventory/actions";
// @ts-ignore — pure logic, unit-tested in tests/inventory.test.mjs
import { formatQtyMilli, isOversold } from "@/lib/core/inventory.mjs";
import Modal from "@/components/Modal";
import { Button, Grid, Label, Notice } from "@/components/ui";

export type Item = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  quantity_milli: number;
  low_stock_threshold: number;
  cost_minor: number;
};
const sym: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };

export default function InventoryClient({ items, currency }: { items: Item[]; currency: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Item | null | undefined>(undefined);
  const titleId = useId();
  const [state, formAction] = useFormState(saveInventoryItem, { ok: false } as ActionResult);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const cur = sym[currency] ?? "$";
  if (state.ok && editing !== undefined)
    setTimeout(() => {
      setEditing(undefined);
      router.refresh();
    }, 0);

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
        const forced = await adjustQuantity(
          id,
          d,
          "Counted out below zero — needs a stock count",
          true,
        );
        if (!forced.ok) setAdjustError(forced.error ?? "Could not record that.");
      }
    } else if (!r.ok) {
      setAdjustError(r.error ?? "Could not record that.");
    }
    router.refresh();
  };
  const del = (id: string) => {
    if (confirm("Delete this item?")) deleteInventoryItem(id).then(() => router.refresh());
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div className="sp-text-muted">
          {items.length} items{low.length ? ` · ${low.length} low` : ""}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link
            href="/inventory/movements"
            style={{ ...btn, background: "#eef2f8", color: "#2563eb", textDecoration: "none" }}
          >
            📜 Stock history
          </Link>
          <Link
            href="/inventory/receiving"
            style={{ ...btn, background: "#eef2f8", color: "#2563eb", textDecoration: "none" }}
          >
            📦 Receiving
          </Link>
          <Button onClick={() => setEditing(null)} size="md">
            <span aria-hidden="true">➕</span> Add item
          </Button>
        </div>
      </div>

      {low.length > 0 && (
        <div
          style={{
            background: "#fdeaea",
            border: "1px solid #f5b5b5",
            color: "#b91c1c",
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: "0.875rem",
            marginBottom: 12,
          }}
        >
          ⚠️ Low stock: {low.map((i) => i.name).join(", ")}
        </div>
      )}

      {oversold.length > 0 && (
        <div
          role="alert"
          style={{
            background: "#fff7ed",
            border: "1px solid #fdba74",
            color: "#9a3412",
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: "0.875rem",
            marginBottom: 12,
          }}
        >
          🧮 Needs a stock count — more was used than the system held:{" "}
          {oversold.map((i) => `${i.name} (${formatQtyMilli(i.quantity_milli)})`).join(", ")}
        </div>
      )}

      {adjustError && (
        <div role="alert" style={{ ...err, marginTop: 0, marginBottom: 12 }}>
          {adjustError}
        </div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        {items.map((it) => {
          const isLow = it.low_stock_threshold > 0 && it.quantity <= it.low_stock_threshold;
          return (
            <div
              key={it.id}
              style={{
                background: "#fff",
                border: `1px solid ${isLow ? "#f5b5b5" : "#e2e8f0"}`,
                borderRadius: 12,
                padding: 12,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div className="sp-flex-fill">
                <div style={{ fontWeight: 700 }}>
                  {it.name}{" "}
                  {isLow && <span style={{ color: "#b91c1c", fontSize: "0.875rem" }}>· low</span>}
                </div>
                <div className="sp-text-muted">
                  {[
                    it.sku && `SKU ${it.sku}`,
                    `${cur}${(it.cost_minor / 100).toFixed(2)}/${it.unit}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => adj(it.id, -1)}
                style={qBtn}
                aria-label={`Decrease quantity of ${it.name}`}
              >
                −
              </button>
              <b
                style={{
                  minWidth: 40,
                  textAlign: "center",
                  color: isOversold(it) ? "#9a3412" : isLow ? "#b91c1c" : "#0b1524",
                }}
              >
                {formatQtyMilli(it.quantity_milli)}
              </b>
              <button
                type="button"
                onClick={() => adj(it.id, 1)}
                style={qBtn}
                aria-label={`Increase quantity of ${it.name}`}
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setEditing(it)}
                style={mini}
                aria-label={`Edit ${it.name}`}
              >
                ✏️
              </button>
              <button
                type="button"
                onClick={() => del(it.id)}
                style={{ ...mini, background: "#fdeaea" }}
                aria-label={`Delete ${it.name}`}
              >
                🗑️
              </button>
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="rempty">No inventory yet. Add your parts & materials.</div>
        )}
      </div>

      {editing !== undefined && (
        <Modal onClose={() => setEditing(undefined)} labelledBy={titleId} width={440}>
          <form action={formAction}>
            <h3 id={titleId} style={{ fontSize: "1.0625rem", fontWeight: 800, marginBottom: 12 }}>
              {editing ? "Edit item" : "New item"}
            </h3>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <label className="sp-field">
              <L>Name</L>
              <input
                name="name"
                defaultValue={editing?.name ?? ""}
                required
                className="sp-input sp-control--lg"
              />
            </label>
            <Grid cols={2}>
              <div>
                <label className="sp-field">
                  <L>SKU</L>
                  <input
                    name="sku"
                    defaultValue={editing?.sku ?? ""}
                    className="sp-input sp-control--lg"
                  />
                </label>
              </div>
              <div>
                <label className="sp-field">
                  <L>Unit</L>
                  <input
                    name="unit"
                    defaultValue={editing?.unit ?? "unit"}
                    className="sp-input sp-control--lg"
                  />
                </label>
              </div>
            </Grid>
            <Grid cols={2}>
              <div>
                <label className="sp-field">
                  <L>Quantity</L>
                  <input
                    name="quantity"
                    type="number"
                    step="0.001"
                    defaultValue={editing ? formatQtyMilli(editing.quantity_milli) : 0}
                    className="sp-input sp-control--lg"
                  />
                </label>
              </div>
              <div>
                <label className="sp-field">
                  <L>Low-stock alert at</L>
                  <input
                    name="low"
                    type="number"
                    defaultValue={editing?.low_stock_threshold ?? 0}
                    className="sp-input sp-control--lg"
                  />
                </label>
              </div>
            </Grid>
            {editing && (
              <label className="sp-field">
                <L>Why is the count changing?</L>
                <input
                  name="reason"
                  placeholder="Stocktake, breakage, returned to vendor…"
                  className="sp-input sp-control--lg"
                />
              </label>
            )}
            <label className="sp-field">
              <L>Cost per unit</L>
              <input
                name="cost"
                type="number"
                step="0.01"
                defaultValue={editing ? (editing.cost_minor / 100).toFixed(2) : ""}
                placeholder="0.00"
                className="sp-input sp-control--lg"
              />
            </label>
            {state.error && <Notice>{state.error}</Notice>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <Save />
              <button
                type="button"
                onClick={() => setEditing(undefined)}
                style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="md">
      {pending ? "Saving…" : "💾 Save"}
    </Button>
  );
}
function L({ children }: { children: React.ReactNode }) {
  return <Label>{children}</Label>;
}
const btn: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  padding: "9px 15px",
  borderRadius: 10,
  fontWeight: 700,
  cursor: "pointer",
};
const qBtn: React.CSSProperties = {
  background: "#eef2f8",
  color: "#2563eb",
  border: "none",
  borderRadius: 8,
  width: 32,
  height: 32,
  fontSize: "1.125rem",
  fontWeight: 800,
  cursor: "pointer",
  flexShrink: 0,
};
const mini: React.CSSProperties = {
  background: "#eef2f8",
  border: "none",
  borderRadius: 8,
  padding: "5px 8px",
  cursor: "pointer",
  fontSize: "0.875rem",
  flexShrink: 0,
};
const err: React.CSSProperties = {
  background: "#fdeaea",
  color: "#dc2626",
  padding: "9px 12px",
  borderRadius: 10,
  fontSize: "0.875rem",
  marginTop: 10,
};
