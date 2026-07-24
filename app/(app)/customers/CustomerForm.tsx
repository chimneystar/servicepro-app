"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createCustomer, type ActionResult } from "./actions";
import { t, sourceOptions, type Locale } from "@/lib/i18n";

const initial: ActionResult = { ok: false };

export default function CustomerForm({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(createCustomer, initial);
  const sources = sourceOptions(locale);

  if (state.ok && open) setTimeout(() => setOpen(false), 0);

  return (
    <>
      <button onClick={() => setOpen(true)} style={btn}>➕ {t(locale, "cust.new")}</button>
      {open && (
        <div style={overlay} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form action={formAction} style={modal}>
            <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 14 }}>{t(locale, "cust.form.new")}</h3>
            <Field name="name" label={t(locale, "form.name")} />
            <Field name="phone" label={t(locale, "form.phone")} />
            <Field name="email" label={t(locale, "form.email")} type="email" />
            <Field name="address" label={`${t(locale, "form.address")} (service)`} />
            <Field name="city" label={t(locale, "form.city")} />
            <div style={{ fontSize: 12, fontWeight: 700, color: "#5c6675", margin: "12px 0 -2px" }}>Billing address (leave blank if same)</div>
            <Field name="billing_address" label="Billing address" />
            <Field name="billing_city" label="Billing city" />
            <label style={lbl}>{t(locale, "form.source")}</label>
            <select name="source" style={inp} defaultValue="">
              <option value="">{t(locale, "form.source_choose")}</option>
              {sources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <label style={lbl}>{t(locale, "form.notes")}</label>
            <textarea name="notes" rows={2} style={inp} />
            {state.error && <div style={err}>{state.error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <SubmitButton locale={locale} />
              <button type="button" onClick={() => setOpen(false)} style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}>{t(locale, "common.cancel")}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function SubmitButton({ locale }: { locale: Locale }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} style={btn}>{pending ? t(locale, "common.saving") : `💾 ${t(locale, "common.save")}`}</button>;
}

function Field({ name, label, type = "text" }: { name: string; label: string; type?: string }) {
  return (
    <>
      <label style={lbl}>{label}</label>
      <input name={name} type={type} style={inp} />
    </>
  );
}

const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "10px 16px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15,30,61,.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 30, zIndex: 100, overflowY: "auto" };
const modal: React.CSSProperties = { background: "#fff", borderRadius: 18, width: "100%", maxWidth: 480, padding: 22 };
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", margin: "10px 0 6px" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none" };
const err: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "9px 12px", borderRadius: 10, fontSize: 13, marginTop: 12 };
