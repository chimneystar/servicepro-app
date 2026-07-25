"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { saveJobStatus, deleteJobStatus, type ActionResult } from "@/app/(app)/settings/jobstatuses-actions";

export type JobStatus = { id: string; name: string; color: string; sort: number; is_done: boolean; is_cancelled: boolean };
const initial: ActionResult = { ok: false };
const COLORS = ["#2563eb", "#0891b2", "#d97706", "#7c3aed", "#db2777", "#0ea5e9", "#15803d", "#dc2626", "#0b1524"];

export default function JobStatusesEditor({ statuses }: { statuses: JobStatus[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<JobStatus | null | undefined>(undefined);
  const [color, setColor] = useState("#2563eb");
  const [state, formAction] = useFormState(saveJobStatus, initial);
  if (state.ok && editing !== undefined) setTimeout(() => { setEditing(undefined); router.refresh(); }, 0);
  function open(s: JobStatus | null) { setColor(s?.color ?? "#2563eb"); setEditing(s); }
  async function del(id: string) { if (!confirm("Delete this status?")) return; await deleteJobStatus(id); router.refresh(); }
  const kindOf = (s: JobStatus) => s.is_done ? "done" : s.is_cancelled ? "cancelled" : "open";

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18, marginBottom: 16, boxShadow: "0 6px 18px rgba(15,42,94,.06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800 }}>Job statuses</h3>
        <button onClick={() => open(null)} style={btn}>➕ Add</button>
      </div>
      {statuses.map((s) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid #f1f4f9" }}>
          <span style={{ width: 14, height: 14, borderRadius: 4, background: s.color, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{s.name}</b>
            {s.is_done && <span style={{ fontSize: 11, color: "#15803d", marginInlineStart: 6 }}>· counts as done</span>}
            {s.is_cancelled && <span style={{ fontSize: 11, color: "#dc2626", marginInlineStart: 6 }}>· cancelled</span>}
          </div>
          <button onClick={() => open(s)} style={mini}>✏️</button>
          <button onClick={() => del(s.id)} style={{ ...mini, background: "#fdeaea" }}>🗑️</button>
        </div>
      ))}
      {statuses.length === 0 && <div style={{ color: "#5c6675", fontSize: 13, padding: 8 }}>No statuses yet.</div>}

      {editing !== undefined && (
        <div style={overlay} onClick={(e) => e.target === e.currentTarget && setEditing(undefined)}>
          <form action={formAction} style={modal}>
            <h3 style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>{editing ? "Edit status" : "New status"}</h3>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <input type="hidden" name="color" value={color} />
            <L>Name</L><input name="name" defaultValue={editing?.name ?? ""} style={inp} required placeholder="e.g. Waiting on parts" />
            <L>Color</L>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              {COLORS.map((c) => <button type="button" key={c} onClick={() => setColor(c)} style={{ width: 30, height: 30, borderRadius: 8, background: c, border: color === c ? "3px solid #94a3b8" : "none", cursor: "pointer" }} />)}
            </div>
            <div style={two}>
              <div><L>Order</L><input name="sort" type="number" defaultValue={editing?.sort ?? 50} style={inp} /></div>
              <div><L>Type</L><select name="kind" defaultValue={editing ? kindOf(editing) : "open"} style={inp}><option value="open">Open (in progress)</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></div>
            </div>
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
const mini: React.CSSProperties = { background: "#eef2f8", border: "none", borderRadius: 8, padding: "5px 8px", cursor: "pointer", fontSize: 13 };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15,30,61,.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, zIndex: 100, overflowY: "auto" };
const modal: React.CSSProperties = { background: "#fff", borderRadius: 18, width: "100%", maxWidth: 420, padding: 22 };
const two: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", margin: "10px 0 6px" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none" };
const err: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "9px 12px", borderRadius: 10, fontSize: 13, marginTop: 10 };
