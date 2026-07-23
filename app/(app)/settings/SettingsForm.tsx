"use client";

import { useFormState, useFormStatus } from "react-dom";
import { updateSettings, type ActionResult } from "./actions";
import { t, type Locale } from "@/lib/i18n";

const initial: ActionResult = { ok: false };

type Org = {
  name?: string; tagline?: string | null; phone?: string | null; email?: string | null;
  address?: string | null; city?: string | null; currency?: string; locale?: string;
  tax_label?: string; tax_rate_bps?: number;
};

export default function SettingsForm({ locale, org }: { locale: Locale; org: Org }) {
  const [state, formAction] = useFormState(updateSettings, initial);
  const taxPct = ((org.tax_rate_bps ?? 0) / 100).toString();

  return (
    <form action={formAction}>
      <Section title={t(locale, "set.section_biz")}>
        <Field name="name" label={t(locale, "set.business")} value={org.name ?? ""} />
        <Field name="tagline" label={t(locale, "set.tagline")} value={org.tagline ?? ""} />
        <Row>
          <Field name="phone" label={t(locale, "set.phone")} value={org.phone ?? ""} />
          <Field name="email" label={t(locale, "set.email")} value={org.email ?? ""} />
        </Row>
        <Row>
          <Field name="address" label={t(locale, "set.address")} value={org.address ?? ""} />
          <Field name="city" label={t(locale, "set.city")} value={org.city ?? ""} />
        </Row>
      </Section>

      <Section title={t(locale, "set.section_loc")}>
        <Row>
          <Select name="locale" label={t(locale, "set.locale")} value={org.locale ?? "en"}
            options={[["en", "English"], ["he", "עברית"]]} />
          <Select name="currency" label={t(locale, "set.currency")} value={org.currency ?? "USD"}
            options={[["USD", "USD ($)"], ["ILS", "ILS (₪)"], ["EUR", "EUR (€)"]]} />
        </Row>
        <Row>
          <Field name="tax_label" label={t(locale, "set.tax_label")} value={org.tax_label ?? "Sales Tax"} />
          <Field name="tax_rate" label={t(locale, "set.tax_rate")} value={taxPct} type="number" />
        </Row>
      </Section>

      {state.error && <div style={err}>{state.error}</div>}
      {state.ok && <div style={ok}>✓ {t(locale, "set.saved")}</div>}
      <Save locale={locale} />
    </form>
  );
}

function Save({ locale }: { locale: Locale }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} style={btn}>{pending ? t(locale, "common.saving") : `💾 ${t(locale, "common.save")}`}</button>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18, marginBottom: 16, boxShadow: "0 6px 18px rgba(15,42,94,.06)" }}>
      <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>{title}</h3>
      {children}
    </div>
  );
}
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>{children}</div>;
}
function Field({ name, label, value, type = "text" }: { name: string; label: string; value: string; type?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={lbl}>{label}</label>
      <input name={name} defaultValue={value} type={type} step="0.001" style={inp} />
    </div>
  );
}
function Select({ name, label, value, options }: { name: string; label: string; value: string; options: [string, string][] }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={lbl}>{label}</label>
      <select name={name} defaultValue={value} style={inp}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", marginBottom: 6 };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none" };
const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "12px 20px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const err: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "10px 12px", borderRadius: 10, fontSize: 13, marginBottom: 12 };
const ok: React.CSSProperties = { background: "#e6f6ec", color: "#15803d", padding: "10px 12px", borderRadius: 10, fontSize: 13, marginBottom: 12 };
