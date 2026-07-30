"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { saveJobType, deleteJobType, type ActionResult } from "@/app/(app)/settings/jobtypes-actions";
import type { Locale } from "@/lib/i18n";

export type JobType = { id: string; name: string; color: string; duration_min: number; default_price_minor: number };
const initial: ActionResult = { ok: false };
const sym: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };
const COLORS = ["#2563eb", "#16a34a", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#dc2626", "#0b1524"];

export default function JobTypesEditor({ locale, types, currency }: { locale: Locale; types: JobType[]; currency: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<JobType | null | undefined>(undefined);
  const [color, setColor] = useState("#2563eb");
  const [state, formAction] = useFormState(saveJobType, initial);
  const cur = sym[currency] ?? "$";
  const he = locale === "he";
  if (state.ok && editing !== undefined) setTimeout(() => { setEditing(undefined); router.refresh(); }, 0);
  function open(tp: JobType | null) { setColor(tp?.color ?? "#2563eb"); setEditing(tp); }
  async function del(id: string) { if (!confirm(he ? "למחוק את סוג העבודה?" : "Delete this job type?")) return; await deleteJobType(id); router.refresh(); }

  return (
    <div className="settings-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800 }}>{he ? "סוגי עבודות" : "Job types"}</h3>
        <button onClick={() => open(null)} style={btn}>{he ? "הוספה" : "Add"}</button>
      </div>
      {types.map((tp) => (
        <div key={tp.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid #f1f4f9" }}>
          <span style={{ width: 14, height: 14, borderRadius: 4, background: tp.color, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{tp.name}</b>
            <div style={{ fontSize: 14, color: "#5c6675" }}>{tp.duration_min} {he ? "דק׳" : "min"}{tp.default_price_minor ? ` · ${cur}${(tp.default_price_minor / 100).toFixed(2)}` : ""}</div>
          </div>
          <button onClick={() => open(tp)} style={mini} aria-label={he ? "עריכה" : "Edit"}>✎</button>
          <button onClick={() => del(tp.id)} style={{ ...mini, background: "#fff0f0", color: "#b93545" }} aria-label={he ? "מחיקה" : "Delete"}>×</button>
        </div>
      ))}
      {types.length === 0 && <div style={{ color: "#5c6675", fontSize: 14, padding: 8 }}>{he ? "עוד לא הוגדרו סוגי עבודה." : "No job types yet."}</div>}

      {editing !== undefined && (
        <div style={overlay} onClick={(e) => e.target === e.currentTarget && setEditing(undefined)}>
          <form action={formAction} style={modal}>
            <h3 style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>{editing ? (he ? "עריכת סוג עבודה" : "Edit job type") : (he ? "סוג עבודה חדש" : "New job type")}</h3>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <input type="hidden" name="color" value={color} />
            <L>{he ? "שם" : "Name"}</L><input name="name" defaultValue={editing?.name ?? ""} style={inp} required />
            <L>{he ? "צבע" : "Color"}</L>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              {COLORS.map((c) => <button type="button" key={c} onClick={() => setColor(c)} style={{ width: 30, height: 30, borderRadius: 8, background: c, border: color === c ? "3px solid #94a3b8" : "none", cursor: "pointer" }} />)}
            </div>
            <div style={two}>
              <div><L>{he ? "משך בדקות" : "Duration (min)"}</L><input name="duration" type="number" defaultValue={editing?.duration_min ?? 60} style={inp} /></div>
              <div><L>{he ? "מחיר ברירת מחדל" : "Default price"}</L><input name="price" type="number" step="0.01" defaultValue={editing ? (editing.default_price_minor / 100).toFixed(2) : ""} style={inp} placeholder="0.00" /></div>
            </div>
            {state.error && <div style={err}>{state.error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <Save locale={locale} /><button type="button" onClick={() => setEditing(undefined)} style={{ ...btn, background: "#eaf0ff", color: "#2b66f6" }}>{he ? "ביטול" : "Cancel"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Save({ locale }: { locale: Locale }) { const { pending } = useFormStatus(); return <button type="submit" disabled={pending} style={btn}>{pending ? (locale === "he" ? "שומרים…" : "Saving…") : (locale === "he" ? "שמירה" : "Save")}</button>; }
function L({ children }: { children: React.ReactNode }) { return <label style={lbl}>{children}</label>; }
const btn: React.CSSProperties = { background: "#2b66f6", color: "#fff", border: "none", padding: "9px 15px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const mini: React.CSSProperties = { background: "#eef2f8", border: "none", borderRadius: 8, padding: "5px 8px", cursor: "pointer", fontSize: 14 };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15,30,61,.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, zIndex: 100, overflowY: "auto" };
const modal: React.CSSProperties = { background: "#fff", borderRadius: 18, width: "100%", maxWidth: 420, padding: 22 };
const two: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const lbl: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: "#334155", display: "block", margin: "10px 0 6px" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none" };
const err: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "9px 12px", borderRadius: 10, fontSize: 14, marginTop: 10 };
