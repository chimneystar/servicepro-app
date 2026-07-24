"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { saveMessageTemplate, type ActionResult } from "@/app/(app)/settings/messages-actions";

export type Template = { trigger: string; enabled: boolean; body: string };

const META: Record<string, { title: string; when: string; icon: string }> = {
  booked: { title: "When a job is booked", when: "Sent right after you create the appointment", icon: "📅" },
  day_before: { title: "Day before the job", when: "Sent the day before the scheduled date", icon: "⏰" },
  on_the_way: { title: "Technician on the way", when: "Sent when you mark the tech en route", icon: "🚚" },
  completed: { title: "After the job is done", when: "Sent when the job is completed", icon: "✅" },
};
const ORDER = ["booked", "day_before", "on_the_way", "completed"];

export default function MessageTemplatesEditor({ templates }: { templates: Template[] }) {
  const byTrigger = new Map(templates.map((t) => [t.trigger, t]));
  return (
    <div>
      <div style={{ background: "#e0ebff", color: "#1d4ed8", padding: "11px 14px", borderRadius: 12, fontSize: 13, marginBottom: 16 }}>
        ℹ️ Customize each automatic message to your client. Use <b>{"{name}"}</b>, <b>{"{service}"}</b>, <b>{"{date}"}</b>, <b>{"{time}"}</b>, <b>{"{business}"}</b> and they’ll be filled in automatically. Turn any message on or off with the switch.
      </div>
      {ORDER.map((trig) => (
        <TemplateRow key={trig} trigger={trig} tpl={byTrigger.get(trig) ?? { trigger: trig, enabled: false, body: "" }} />
      ))}
    </div>
  );
}

function TemplateRow({ trigger, tpl }: { trigger: string; tpl: Template }) {
  const meta = META[trigger];
  const [state, formAction] = useFormState(saveMessageTemplate, { ok: false } as ActionResult);
  const [enabled, setEnabled] = useState(tpl.enabled);
  const [saved, setSaved] = useState(false);
  if (state.ok && !saved) setTimeout(() => { setSaved(true); setTimeout(() => setSaved(false), 1600); }, 0);

  return (
    <form action={formAction} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 16, marginBottom: 12, boxShadow: "0 6px 18px rgba(15,42,94,.05)" }}>
      <input type="hidden" name="trigger" value={trigger} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 20 }}>{meta.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{meta.title}</div>
          <div style={{ fontSize: 12, color: "#5c6675" }}>{meta.when}</div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: enabled ? "#15803d" : "#94a3b8", cursor: "pointer" }}>
          <input type="checkbox" name="enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 20, height: 20 }} />
          {enabled ? "On" : "Off"}
        </label>
      </div>
      <textarea name="body" defaultValue={tpl.body} rows={3} style={inp} placeholder="Write the message your client will receive…" />
      {state.error && <div style={err}>{state.error}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <Save />
        {saved && <span style={{ color: "#15803d", fontWeight: 700, fontSize: 13 }}>✓ Saved</span>}
      </div>
    </form>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} style={btn}>{pending ? "Saving…" : "💾 Save"}</button>;
}

const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "9px 16px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none", resize: "vertical" };
const err: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "9px 12px", borderRadius: 10, fontSize: 13, marginTop: 8 };
