"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { saveJobStatus, deleteJobStatus, type ActionResult } from "@/app/(app)/settings/jobstatuses-actions";
import type { Locale } from "@/lib/i18n";
import Modal from "@/components/Modal";

export type JobStatus = { id: string; name: string; color: string; sort: number; is_done: boolean; is_cancelled: boolean };
const initial: ActionResult = { ok: false };
const COLORS = ["#2563eb", "#0891b2", "#d97706", "#7c3aed", "#db2777", "#0ea5e9", "#15803d", "#dc2626", "#0b1524"];

export default function JobStatusesEditor({ locale, statuses }: { locale: Locale; statuses: JobStatus[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<JobStatus | null | undefined>(undefined);
  const titleId = useId();
  const [color, setColor] = useState("#2563eb");
  const [state, formAction] = useFormState(saveJobStatus, initial);
  const he = locale === "he";
  if (state.ok && editing !== undefined) setTimeout(() => { setEditing(undefined); router.refresh(); }, 0);
  function open(s: JobStatus | null) { setColor(s?.color ?? "#2563eb"); setEditing(s); }
  async function del(id: string) { if (!confirm(he ? "למחוק את הסטטוס?" : "Delete this status?")) return; await deleteJobStatus(id); router.refresh(); }
  const kindOf = (s: JobStatus) => s.is_done ? "done" : s.is_cancelled ? "cancelled" : "open";

  return (
    <div className="settings-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800 }}>{he ? "סטטוסים לעבודות" : "Job statuses"}</h3>
        <button type="button" onClick={() => open(null)} style={btn}>{he ? "הוספה" : "Add"}</button>
      </div>
      {statuses.map((s) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid #f1f4f9" }}>
          <span style={{ width: 14, height: 14, borderRadius: 4, background: s.color, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{s.name}</b>
            {s.is_done && <span style={{ fontSize: 11, color: "#15803d", marginInlineStart: 6 }}>· {he ? "נחשב כהושלם" : "counts as done"}</span>}
            {s.is_cancelled && <span style={{ fontSize: 11, color: "#dc2626", marginInlineStart: 6 }}>· {he ? "בוטל" : "cancelled"}</span>}
          </div>
          <button type="button" onClick={() => open(s)} style={mini} aria-label={he ? "עריכה" : "Edit"}>✎</button>
          <button type="button" onClick={() => del(s.id)} style={{ ...mini, background: "#fff0f0", color: "#b93545" }} aria-label={he ? "מחיקה" : "Delete"}>×</button>
        </div>
      ))}
      {statuses.length === 0 && <div style={{ color: "#5c6675", fontSize: 13, padding: 8 }}>{he ? "עוד לא הוגדרו סטטוסים." : "No statuses yet."}</div>}

      {editing !== undefined && (
        <Modal onClose={() => setEditing(undefined)} labelledBy={titleId} width={420}>
          <form action={formAction}>
            <h3 id={titleId} style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>{editing ? (he ? "עריכת סטטוס" : "Edit status") : (he ? "סטטוס חדש" : "New status")}</h3>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <input type="hidden" name="color" value={color} />
            <label style={{ display: "block" }}>
              <L>{he ? "שם" : "Name"}</L>
              <input name="name" defaultValue={editing?.name ?? ""} style={inp} required placeholder={he ? "למשל: ממתינים לחלק" : "For example: Waiting on parts"} />
            </label>
            <L>{he ? "צבע" : "Color"}</L>
            <div role="group" aria-label={he ? "צבע" : "Color"} style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              {COLORS.map((c) => <button type="button" key={c} onClick={() => setColor(c)} aria-pressed={color === c} aria-label={`${he ? "צבע" : "Color"} ${c}`} style={{ width: 30, height: 30, borderRadius: 8, background: c, border: color === c ? "3px solid #94a3b8" : "none", cursor: "pointer" }} />)}
            </div>
            <div style={two}>
              <div><label style={{ display: "block" }}><L>{he ? "סדר תצוגה" : "Display order"}</L><input name="sort" type="number" defaultValue={editing?.sort ?? 50} style={inp} /></label></div>
              <div><label style={{ display: "block" }}><L>{he ? "סוג" : "Type"}</L><select name="kind" defaultValue={editing ? kindOf(editing) : "open"} style={inp}><option value="open">{he ? "פתוח / בתהליך" : "Open / in progress"}</option><option value="done">{he ? "הושלם" : "Done"}</option><option value="cancelled">{he ? "בוטל" : "Cancelled"}</option></select></label></div>
            </div>
            {state.error && <div style={err}>{state.error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}><Save locale={locale} /><button type="button" onClick={() => setEditing(undefined)} style={{ ...btn, background: "#eaf0ff", color: "#2b66f6" }}>{he ? "ביטול" : "Cancel"}</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Save({ locale }: { locale: Locale }) { const { pending } = useFormStatus(); return <button type="submit" disabled={pending} style={btn}>{pending ? (locale === "he" ? "שומרים…" : "Saving…") : (locale === "he" ? "שמירה" : "Save")}</button>; }
function L({ children }: { children: React.ReactNode }) { return <span style={lbl}>{children}</span>; }
const btn: React.CSSProperties = { background: "#2b66f6", color: "#fff", border: "none", padding: "9px 15px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const mini: React.CSSProperties = { background: "#eef2f8", border: "none", borderRadius: 8, padding: "5px 8px", cursor: "pointer", fontSize: 13 };
const two: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", margin: "10px 0 6px" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none" };
const err: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "9px 12px", borderRadius: 10, fontSize: 13, marginTop: 10 };
