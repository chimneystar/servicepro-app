"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { savePlan, deletePlan, generateDuePlans, type ActionResult } from "@/app/(app)/recurring/actions";
import Modal from "@/components/Modal";

export type Plan = { id: string; customer_id: string; customer_name: string; service: string; interval_months: number; price_minor: number; next_due: string; assigned_to: string | null };
type Opt = { id: string; label: string };
const sym: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };

export default function RecurringClient({ plans, customers, techs, currency, today }: { plans: Plan[]; customers: Opt[]; techs: Opt[]; currency: string; today: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Plan | null | undefined>(undefined);
  const titleId = useId();
  const [pending, start] = useTransition();
  // The banner used to be hard-coded green, so a failure was reported in the
  // success colour. Tone is now tracked with the message.
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [state, formAction] = useFormState(savePlan, { ok: false } as ActionResult);
  const cur = sym[currency] ?? "$";
  if (state.ok && editing !== undefined) setTimeout(() => { setEditing(undefined); router.refresh(); }, 0);

  const dueCount = plans.filter((p) => p.next_due <= today).length;
  function genDue() { start(async () => { const r = await generateDuePlans(); setMsg(r.ok ? { text: `✓ Created ${r.created} job${r.created === 1 ? "" : "s"}`, ok: true } : { text: r.error ?? "Could not generate the due plans", ok: false }); router.refresh(); setTimeout(() => setMsg(null), 4000); }); }
  // A refused delete used to leave the plan on screen with no message at all.
  function del(id: string) { if (!confirm("Delete this plan?")) return; start(async () => { const r = await deletePlan(id); if (!r.ok) { setMsg({ text: r.error ?? "Could not delete this plan", ok: false }); setTimeout(() => setMsg(null), 4000); return; } router.refresh(); }); }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "#5c6675" }}>{plans.length} plans{dueCount ? ` · ${dueCount} due now` : ""}</div>
        <div style={{ display: "flex", gap: 8 }}>
          {dueCount > 0 && <button type="button" onClick={genDue} disabled={pending} style={{ ...btn, background: "#15803d" }}><span aria-hidden="true">⚡</span> Generate {dueCount} due</button>}
          <button type="button" onClick={() => setEditing(null)} style={btn}><span aria-hidden="true">➕</span> New plan</button>
        </div>
      </div>
      {msg && <div role={msg.ok ? "status" : "alert"} style={{ background: msg.ok ? "#e6f6ec" : "#fdeaea", color: msg.ok ? "#15803d" : "#dc2626", padding: "9px 12px", borderRadius: 10, fontWeight: 700, fontSize: 13, marginBottom: 12 }}>{msg.text}</div>}

      <div style={{ display: "grid", gap: 8 }}>
        {plans.map((p) => {
          const due = p.next_due <= today;
          return (
            <div key={p.id} style={{ background: "#fff", border: `1px solid ${due ? "#f5d99b" : "#e2e8f0"}`, borderRadius: 12, padding: 14, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{p.customer_name} · {p.service}</div>
                <div style={{ fontSize: 12.5, color: "#5c6675" }}>Every {p.interval_months} mo · {cur}{(p.price_minor / 100).toFixed(2)} · next {fmt(p.next_due)}</div>
              </div>
              {due && <span className="pill" style={{ background: "#fdf1dc", color: "#b45309" }}>due</span>}
              <button type="button" onClick={() => setEditing(p)} style={mini} aria-label={`Edit ${p.customer_name} · ${p.service}`}>✏️</button>
              <button type="button" onClick={() => del(p.id)} style={{ ...mini, background: "#fdeaea" }} aria-label={`Delete ${p.customer_name} · ${p.service}`}>🗑️</button>
            </div>
          );
        })}
        {plans.length === 0 && <div className="rempty">No maintenance plans yet. Add one to auto-repeat annual chimney/AC visits.</div>}
      </div>

      {editing !== undefined && (
        <Modal onClose={() => setEditing(undefined)} labelledBy={titleId} width={460}>
          <form action={formAction}>
            <h3 id={titleId} style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>{editing ? "Edit plan" : "New maintenance plan"}</h3>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <label style={{ display: "block" }}>
              <L>Customer</L>
              <select name="customer_id" defaultValue={editing?.customer_id ?? customers[0]?.id} style={inp} required>{customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
            </label>
            <label style={{ display: "block" }}><L>Service</L><input name="service" defaultValue={editing?.service ?? ""} style={inp} placeholder="e.g. Annual chimney cleaning" required /></label>
            <div style={two}>
              <div><label style={{ display: "block" }}><L>Repeat every (months)</L><input name="interval" type="number" defaultValue={editing?.interval_months ?? 12} style={inp} /></label></div>
              <div><label style={{ display: "block" }}><L>Price</L><input name="price" type="number" step="0.01" defaultValue={editing ? (editing.price_minor / 100).toFixed(2) : ""} style={inp} placeholder="0.00" /></label></div>
            </div>
            <div style={two}>
              <div><label style={{ display: "block" }}><L>Next due date</L><input name="next_due" type="date" defaultValue={editing?.next_due ?? today} style={inp} /></label></div>
              <div><label style={{ display: "block" }}><L>Technician</L><select name="assigned_to" defaultValue={editing?.assigned_to ?? ""} style={inp}><option value="">Unassigned</option>{techs.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label></div>
            </div>
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
function fmt(iso: string) { const d = new Date(iso + "T00:00:00"); return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "9px 15px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const mini: React.CSSProperties = { background: "#eef2f8", border: "none", borderRadius: 8, padding: "5px 8px", cursor: "pointer", fontSize: 13, flexShrink: 0 };
const two: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", margin: "10px 0 6px" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 16, outline: "none" };
const err: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "9px 12px", borderRadius: 10, fontSize: 13, marginTop: 10 };
