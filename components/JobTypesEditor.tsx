"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import {
  saveJobType,
  deleteJobType,
  type ActionResult,
} from "@/app/(app)/settings/jobtypes-actions";
import type { Locale } from "@/lib/i18n";
import Modal from "@/components/Modal";
import { Button, Grid, Label, Notice } from "@/components/ui";

export type JobType = {
  id: string;
  name: string;
  color: string;
  duration_min: number;
  default_price_minor: number;
};
const initial: ActionResult = { ok: false };
const sym: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };
const COLORS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#db2777",
  "#0891b2",
  "#dc2626",
  "#0b1524",
];

export default function JobTypesEditor({
  locale,
  types,
  currency,
}: {
  locale: Locale;
  types: JobType[];
  currency: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<JobType | null | undefined>(undefined);
  const titleId = useId();
  const [color, setColor] = useState("#2563eb");
  const [state, formAction] = useFormState(saveJobType, initial);
  const cur = sym[currency] ?? "$";
  const he = locale === "he";
  if (state.ok && editing !== undefined)
    setTimeout(() => {
      setEditing(undefined);
      router.refresh();
    }, 0);
  function open(tp: JobType | null) {
    setColor(tp?.color ?? "#2563eb");
    setEditing(tp);
  }
  async function del(id: string) {
    if (!confirm(he ? "למחוק את סוג העבודה?" : "Delete this job type?")) return;
    await deleteJobType(id);
    router.refresh();
  }

  return (
    <div className="settings-section">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h3 className="sp-heading">{he ? "סוגי עבודות" : "Job types"}</h3>
        <button type="button" onClick={() => open(null)} style={btn}>
          {he ? "הוספה" : "Add"}
        </button>
      </div>
      {types.map((tp) => (
        <div
          key={tp.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 0",
            borderTop: "1px solid #f1f4f9",
          }}
        >
          <span
            style={{ width: 14, height: 14, borderRadius: 4, background: tp.color, flexShrink: 0 }}
          />
          <div className="sp-flex-fill">
            <b>{tp.name}</b>
            <div className="sp-text-muted-xs">
              {tp.duration_min} {he ? "דק׳" : "min"}
              {tp.default_price_minor
                ? ` · ${cur}${(tp.default_price_minor / 100).toFixed(2)}`
                : ""}
            </div>
          </div>
          <Button
            onClick={() => open(tp)}
            aria-label={he ? "עריכה" : "Edit"}
            variant="secondary"
            size="sm"
          >
            ✎
          </Button>
          <button
            type="button"
            onClick={() => del(tp.id)}
            style={{ ...mini, background: "#fff0f0", color: "#b93545" }}
            aria-label={he ? "מחיקה" : "Delete"}
          >
            ×
          </button>
        </div>
      ))}
      {types.length === 0 && (
        <div style={{ color: "#5c6675", fontSize: "0.875rem", padding: 8 }}>
          {he ? "עוד לא הוגדרו סוגי עבודה." : "No job types yet."}
        </div>
      )}

      {editing !== undefined && (
        <Modal onClose={() => setEditing(undefined)} labelledBy={titleId} width={420}>
          <form action={formAction}>
            <h3 id={titleId} style={{ fontSize: "1.0625rem", fontWeight: 800, marginBottom: 12 }}>
              {editing
                ? he
                  ? "עריכת סוג עבודה"
                  : "Edit job type"
                : he
                  ? "סוג עבודה חדש"
                  : "New job type"}
            </h3>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <input type="hidden" name="color" value={color} />
            <label className="sp-field">
              <L>{he ? "שם" : "Name"}</L>
              <input name="name" defaultValue={editing?.name ?? ""} required className="sp-input" />
            </label>
            <L>{he ? "צבע" : "Color"}</L>
            <div
              role="group"
              aria-label={he ? "צבע" : "Color"}
              style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}
            >
              {COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  aria-pressed={color === c}
                  aria-label={`${he ? "צבע" : "Color"} ${c}`}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: c,
                    border: color === c ? "3px solid #94a3b8" : "none",
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
            <Grid cols={2}>
              <div>
                <label className="sp-field">
                  <L>{he ? "משך בדקות" : "Duration (min)"}</L>
                  <input
                    name="duration"
                    type="number"
                    defaultValue={editing?.duration_min ?? 60}
                    className="sp-input"
                  />
                </label>
              </div>
              <div>
                <label className="sp-field">
                  <L>{he ? "מחיר ברירת מחדל" : "Default price"}</L>
                  <input
                    name="price"
                    type="number"
                    step="0.01"
                    defaultValue={editing ? (editing.default_price_minor / 100).toFixed(2) : ""}
                    placeholder="0.00"
                    className="sp-input"
                  />
                </label>
              </div>
            </Grid>
            {state.error && <Notice>{state.error}</Notice>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <Save locale={locale} />
              <button
                type="button"
                onClick={() => setEditing(undefined)}
                style={{ ...btn, background: "#eaf0ff", color: "#2b66f6" }}
              >
                {he ? "ביטול" : "Cancel"}
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
      {pending ? (locale === "he" ? "שומרים…" : "Saving…") : locale === "he" ? "שמירה" : "Save"}
    </button>
  );
}
function L({ children }: { children: React.ReactNode }) {
  return <Label>{children}</Label>;
}
const btn: React.CSSProperties = {
  background: "#2b66f6",
  color: "#fff",
  border: "none",
  padding: "9px 15px",
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
  fontSize: "0.875rem",
};
