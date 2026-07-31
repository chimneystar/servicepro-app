"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { saveMessageTemplate, type ActionResult } from "@/app/(app)/settings/messages-actions";
import type { Locale } from "@/lib/i18n";

export type Template = { trigger: string; enabled: boolean; body: string };

const META: Record<string, { en: [string, string]; he: [string, string]; icon: string }> = {
  booked: { en: ["When a job is booked", "Sent right after you create the appointment"], he: ["כשקובעים עבודה", "נשלחת מיד אחרי יצירת העבודה ביומן"], icon: "📅" },
  day_before: { en: ["Day before the job", "Sent the day before the scheduled date"], he: ["יום לפני העבודה", "נשלחת יום לפני המועד שקבעתם"], icon: "⏰" },
  on_the_way: { en: ["Technician on the way", "Sent when you mark the technician as on the way"], he: ["הטכנאי בדרך", "נשלחת כשמסמנים שהטכנאי יצא לדרך"], icon: "🚚" },
  completed: { en: ["After the job is done", "Sent when the job is marked complete"], he: ["אחרי שהעבודה הושלמה", "נשלחת כשמסמנים שהעבודה הסתיימה"], icon: "✓" },
};
const ORDER = ["booked", "day_before", "on_the_way", "completed"];

export default function MessageTemplatesEditor({ locale, templates }: { locale: Locale; templates: Template[] }) {
  const he = locale === "he";
  const byTrigger = new Map(templates.map((t) => [t.trigger, t]));
  return (
    <div>
      <div style={{ background: "#e0ebff", color: "#1d4ed8", padding: "11px 14px", borderRadius: 12, fontSize: "0.8125rem", marginBottom: 16 }}>
        {he ? "אפשר לערוך כל הודעה. השדות " : "Customize every message. The fields "}<b>{"{name}"}</b>, <b>{"{service}"}</b>, <b>{"{date}"}</b>, <b>{"{time}"}</b>, <b>{"{business}"}</b>{he ? " יתמלאו אוטומטית בפרטי הלקוח והעבודה." : " are filled automatically with the customer and job details."}
      </div>
      {ORDER.map((trig) => (
        <TemplateRow key={trig} locale={locale} trigger={trig} tpl={byTrigger.get(trig) ?? { trigger: trig, enabled: false, body: "" }} />
      ))}
    </div>
  );
}

function TemplateRow({ locale, trigger, tpl }: { locale: Locale; trigger: string; tpl: Template }) {
  const meta = META[trigger];
  const he = locale === "he";
  const [title, when] = he ? meta.he : meta.en;
  const [state, formAction] = useFormState(saveMessageTemplate, { ok: false } as ActionResult);
  const [enabled, setEnabled] = useState(tpl.enabled);
  const [saved, setSaved] = useState(false);
  if (state.ok && !saved) setTimeout(() => { setSaved(true); setTimeout(() => setSaved(false), 1600); }, 0);

  return (
    <form action={formAction} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 16, marginBottom: 12, boxShadow: "0 6px 18px rgba(15,42,94,.05)" }}>
      <input type="hidden" name="trigger" value={trigger} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: "1.25rem" }}>{meta.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: "0.9375rem" }}>{title}</div>
          <div style={{ fontSize: "0.75rem", color: "#5c6675" }}>{when}</div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", fontWeight: 700, color: enabled ? "#15803d" : "#94a3b8", cursor: "pointer" }}>
          <input type="checkbox" name="enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 20, height: 20 }} />
          {enabled ? (he ? "פעילה" : "On") : (he ? "כבויה" : "Off")}
        </label>
      </div>
      <textarea name="body" defaultValue={tpl.body} rows={3} style={inp} placeholder={he ? "כתבו כאן את ההודעה שהלקוח יקבל…" : "Write the message your customer will receive…"} />
      {state.error && <div style={err}>{state.error}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <Save locale={locale} />
        {saved && <span style={{ color: "#15803d", fontWeight: 700, fontSize: "0.8125rem" }}>{he ? "נשמר" : "Saved"}</span>}
      </div>
    </form>
  );
}

function Save({ locale }: { locale: Locale }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} style={btn}>{pending ? (locale === "he" ? "שומרים…" : "Saving…") : (locale === "he" ? "שמירה" : "Save")}</button>;
}

const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "9px 16px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: "0.875rem", outline: "none", resize: "vertical" };
const err: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "9px 12px", borderRadius: 10, fontSize: "0.8125rem", marginTop: 8 };
