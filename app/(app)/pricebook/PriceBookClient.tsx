"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { savePriceItem, deletePriceItem, type ActionResult } from "./actions";
import { t, type Locale } from "@/lib/i18n";
import Modal from "@/components/Modal";

type Item = {
  id: string;
  name: string;
  category: string | null;
  unit: string | null;
  price_minor: number;
  cost_minor: number;
};
const initial: ActionResult = { ok: false };
const sym: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };

export default function PriceBookClient({
  locale,
  items,
  currency,
}: {
  locale: Locale;
  items: Item[];
  currency: string;
}) {
  const router = useRouter();
  const he = locale === "he";
  const [editing, setEditing] = useState<Item | null | undefined>(undefined); // undefined = closed
  const titleId = useId();
  const [state, formAction] = useFormState(savePriceItem, initial);
  const cur = sym[currency] ?? "$";
  const m = (v: number) =>
    cur + (v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (state.ok && editing !== undefined)
    setTimeout(() => {
      setEditing(undefined);
      router.refresh();
    }, 0);

  async function del(id: string) {
    if (!confirm("Delete this item?")) return;
    await deletePriceItem(id);
    router.refresh();
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800 }}>{t(locale, "pb.title")}</h1>
        <button type="button" onClick={() => setEditing(null)} style={btn}>
          <span aria-hidden="true">➕</span> {t(locale, "pb.new")}
        </button>
      </div>

      <div className="rlist">
        {items.map((it) => (
          <div className="ritem" key={it.id}>
            <div className="rmain">
              <div className="rtitle">{it.name}</div>
              <div className="rsub">
                {it.category || ""}
                {it.category ? " · " : ""}
                {m(it.cost_minor)} cost · {it.unit}
              </div>
            </div>
            <div className="rend">
              <b style={{ fontSize: "0.9375rem" }}>{m(it.price_minor)}</b>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setEditing(it)}
                  style={mini}
                  aria-label={he ? "עריכה" : "Edit"}
                >
                  ✏️
                </button>
                <button
                  type="button"
                  onClick={() => del(it.id)}
                  style={{ ...mini, background: "#fdeaea" }}
                  aria-label={t(locale, "common.delete")}
                >
                  🗑️
                </button>
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="rempty">{t(locale, "pb.empty")}</div>}
      </div>

      {editing !== undefined && (
        <Modal onClose={() => setEditing(undefined)} labelledBy={titleId} width={460}>
          <form action={formAction}>
            <h3 id={titleId} style={{ fontSize: "1.125rem", fontWeight: 800, marginBottom: 14 }}>
              {editing ? editing.name : t(locale, "pb.new")}
            </h3>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <label style={{ display: "block" }}>
              <L>{t(locale, "pb.name")}</L>
              <input name="name" defaultValue={editing?.name ?? ""} style={inp} required />
            </label>
            <div style={two}>
              <div>
                <label style={{ display: "block" }}>
                  <L>{t(locale, "pb.category")}</L>
                  <input name="category" defaultValue={editing?.category ?? ""} style={inp} />
                </label>
              </div>
              <div>
                <label style={{ display: "block" }}>
                  <L>{t(locale, "pb.unit")}</L>
                  <input name="unit" defaultValue={editing?.unit ?? "unit"} style={inp} />
                </label>
              </div>
            </div>
            <div style={two}>
              <div>
                <label style={{ display: "block" }}>
                  <L>{t(locale, "pb.price")}</L>
                  <input
                    name="price"
                    type="number"
                    step="0.01"
                    defaultValue={editing ? (editing.price_minor / 100).toFixed(2) : ""}
                    style={inp}
                    placeholder="0.00"
                  />
                </label>
              </div>
              <div>
                <label style={{ display: "block" }}>
                  <L>{t(locale, "pb.cost")}</L>
                  <input
                    name="cost"
                    type="number"
                    step="0.01"
                    defaultValue={editing ? (editing.cost_minor / 100).toFixed(2) : ""}
                    style={inp}
                    placeholder="0.00"
                  />
                </label>
              </div>
            </div>
            {state.error && <div style={err}>{state.error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <Save locale={locale} />
              <button
                type="button"
                onClick={() => setEditing(undefined)}
                style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}
              >
                {t(locale, "common.cancel")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Save({ locale }: { locale: Locale }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} style={btn}>
      {pending ? t(locale, "common.saving") : `💾 ${t(locale, "common.save")}`}
    </button>
  );
}
function L({ children }: { children: React.ReactNode }) {
  return <span style={lbl}>{children}</span>;
}

const btn: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  padding: "10px 16px",
  borderRadius: 10,
  fontWeight: 700,
  cursor: "pointer",
};
const mini: React.CSSProperties = {
  background: "#eef2f8",
  border: "none",
  borderRadius: 8,
  padding: "5px 8px",
  cursor: "pointer",
  fontSize: "0.8125rem",
};
const two: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const lbl: React.CSSProperties = {
  fontSize: "0.8125rem",
  fontWeight: 700,
  color: "#334155",
  display: "block",
  margin: "10px 0 6px",
};
const inp: React.CSSProperties = {
  width: "100%",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: "0.875rem",
  outline: "none",
};
const err: React.CSSProperties = {
  background: "#fdeaea",
  color: "#dc2626",
  padding: "9px 12px",
  borderRadius: 10,
  fontSize: "0.8125rem",
  marginTop: 10,
};
