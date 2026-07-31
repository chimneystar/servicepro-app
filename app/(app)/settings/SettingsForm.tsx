"use client";

import { useId, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { updateSettings, type ActionResult } from "./actions";
import type { Locale } from "@/lib/i18n";

const initial: ActionResult = { ok: false };
type Org = {
  name?: string; tagline?: string | null; phone?: string | null; email?: string | null;
  address?: string | null; city?: string | null; currency?: string; locale?: string;
  tax_label?: string; tax_rate_bps?: number; invoice_counter?: number; estimate_counter?: number;
  accent_color?: string | null; estimate_terms?: string | null; invoice_terms?: string | null;
  document_footer?: string | null; review_url?: string | null;
};
const ACCENTS = ["#2b66f6", "#101a2e", "#0891b2", "#15803d", "#7c3aed", "#db2777", "#d97706", "#dc2626"];

export default function SettingsForm({ locale, org }: { locale: Locale; org: Org }) {
  const [state, formAction] = useFormState(updateSettings, initial);
  const [accent, setAccent] = useState(org.accent_color ?? "#2b66f6");
  const he = locale === "he";
  const taxPct = ((org.tax_rate_bps ?? 0) / 100).toString();

  return (
    <form action={formAction} style={{ display: "grid", gap: 16 }}>
      <Section title={he ? "פרטי העסק" : "Business profile"} note={he ? "הפרטים שמופיעים אצלך במערכת ועל מסמכים שנשלחים ללקוחות." : "The details shown in your workspace and on customer documents."}>
        <Field name="name" label={he ? "שם העסק" : "Business name"} value={org.name ?? ""} />
        <Field name="tagline" label={he ? "שורת תיאור" : "Tagline"} value={org.tagline ?? ""} placeholder={he ? "למשל: שירות מקצועי שמגיע בזמן" : "For example: Professional service, on time"} />
        <Row><Field name="phone" label={he ? "טלפון" : "Phone"} value={org.phone ?? ""} /><Field name="email" label={he ? "אימייל" : "Email"} value={org.email ?? ""} type="email" /></Row>
        <Row><Field name="address" label={he ? "כתובת" : "Address"} value={org.address ?? ""} /><Field name="city" label={he ? "עיר" : "City"} value={org.city ?? ""} /></Row>
      </Section>

      <Section title={he ? "שפה, מטבע ומס" : "Language, currency & tax"} note={he ? "השפה משנה גם את כיוון הממשק. כל הסכומים והמסמכים יוצגו לפי ההגדרות כאן." : "Language also changes the interface direction. Amounts and documents follow these settings."}>
        <Row><Select name="locale" label={he ? "שפת המערכת" : "App language"} value={org.locale ?? "en"} options={[["he", "עברית"], ["en", "English"]]} /><Select name="currency" label={he ? "מטבע" : "Currency"} value={org.currency ?? "USD"} options={[["USD", "USD ($)"]]} /></Row>
        <Row><Field name="tax_label" label={he ? "שם המס" : "Tax label"} value={org.tax_label ?? (he ? "מע״מ" : "Sales Tax")} /><Field name="tax_rate" label={he ? "שיעור המס באחוזים" : "Tax rate (%)"} value={taxPct} type="number" /></Row>
      </Section>

      <Section title={he ? "עיצוב ותנאים במסמכים" : "Document design & terms"} note={he ? "אותם צבעים ותנאים יופיעו בהצעות המחיר ובחשבוניות שלך." : "These colors and terms appear on estimates and invoices."}>
        <input type="hidden" name="accent_color" value={accent} />
        <label style={labelStyle}>{he ? "צבע מוביל במסמכים" : "Document accent color"}</label>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginBottom: 14 }}>{ACCENTS.map((color) => <button type="button" key={color} onClick={() => setAccent(color)} aria-label={color} style={{ width: 34, height: 34, borderRadius: 10, background: color, border: accent === color ? "3px solid #aab7ca" : "3px solid transparent", boxShadow: accent === color ? "0 0 0 2px #fff, 0 0 0 4px #c9d4e6" : "none" }} />)}</div>
        <div style={{ overflow: "hidden", marginBottom: 16, border: "1px solid #dde5f0", borderRadius: 13 }}><div style={{ padding: "11px 14px", background: accent, color: "#fff", fontSize: "0.8125rem", fontWeight: 800 }}>{he ? "כך ייראה הצבע במסמכים שלך" : "This is how the color appears on your documents"}</div></div>
        <TextArea name="estimate_terms" label={he ? "תנאים להצעת מחיר" : "Estimate terms & conditions"} value={org.estimate_terms ?? ""} placeholder={he ? "למשל: ההצעה בתוקף ל־30 יום. לקביעת העבודה נדרשת מקדמה של 50%." : "For example: This estimate is valid for 30 days. A 50% deposit is required to schedule work."} />
        <TextArea name="invoice_terms" label={he ? "תנאים לחשבונית" : "Invoice terms & conditions"} value={org.invoice_terms ?? ""} placeholder={he ? "למשל: התשלום נדרש בתוך 14 יום." : "For example: Payment is due within 14 days."} />
        <Field name="document_footer" label={he ? "טקסט בתחתית כל מסמך" : "Footer on every document"} value={org.document_footer ?? ""} placeholder={he ? "תודה שבחרתם בנו" : "Thank you for your business"} />
      </Section>

      <Section title={he ? "בקשת ביקורת" : "Review requests"} note={he ? "בסיום עבודה אפשר לשלוח ללקוח קישור ישיר להשארת ביקורת." : "Send customers a direct review link after completing a job."}>
        <Field name="review_url" label={he ? "קישור לביקורת בגוגל" : "Google review link"} value={org.review_url ?? ""} placeholder="https://g.page/r/…/review" dir="ltr" />
      </Section>

      <Section title={he ? "מספור מסמכים" : "Document numbering"} note={he ? "המספר הבא שיינתן למסמך חדש. המערכת תמשיך משם אוטומטית." : "The next number assigned to a new document. Numbering continues automatically."}>
        <Row><Field name="invoice_next" label={he ? "מספר החשבונית הבאה" : "Next invoice number"} value={String((org.invoice_counter ?? 5000) + 1)} type="number" /><Field name="estimate_next" label={he ? "מספר הצעת המחיר הבאה" : "Next estimate number"} value={String((org.estimate_counter ?? 1000) + 1)} type="number" /></Row>
      </Section>

      {state.error && <div style={errorStyle}>{state.error}</div>}
      {state.ok && <div className="pop-in" style={successStyle}>{he ? "ההגדרות נשמרו" : "Settings saved"}</div>}
      <Save locale={locale} />
    </form>
  );
}

function Save({ locale }: { locale: Locale }) { const { pending } = useFormStatus(); return <button type="submit" disabled={pending} className="settings-save">{pending ? (locale === "he" ? "שומרים…" : "Saving…") : (locale === "he" ? "שמירת השינויים" : "Save changes")}</button>; }
function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) { return <section className="settings-section"><h3>{title}</h3>{note && <p className="settings-section-note">{note}</p>}{children}</section>; }
function Row({ children }: { children: React.ReactNode }) { return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>{children}</div>; }
function Field({ name, label, value, type = "text", placeholder, dir }: { name: string; label: string; value: string; type?: string; placeholder?: string; dir?: "ltr" | "rtl" }) { const id = useId(); return <div style={{ marginBottom: 13 }}><label htmlFor={id} style={labelStyle}>{label}</label><input id={id} name={name} defaultValue={value} type={type} step={type === "number" ? "0.001" : undefined} placeholder={placeholder} dir={dir} style={inputStyle} /></div>; }
function Select({ name, label, value, options }: { name: string; label: string; value: string; options: [string, string][] }) { const id = useId(); return <div style={{ marginBottom: 13 }}><label htmlFor={id} style={labelStyle}>{label}</label><select id={id} name={name} defaultValue={value} style={inputStyle}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></div>; }
function TextArea({ name, label, value, placeholder }: { name: string; label: string; value: string; placeholder: string }) { const id = useId(); return <div style={{ marginBottom: 13 }}><label htmlFor={id} style={labelStyle}>{label}</label><textarea id={id} name={name} defaultValue={value} rows={3} placeholder={placeholder} style={{ ...inputStyle, resize: "vertical" }} /></div>; }
const labelStyle: React.CSSProperties = { display: "block", marginBottom: 6, color: "#33415c", fontSize: "0.8125rem", fontWeight: 750 };
const inputStyle: React.CSSProperties = { width: "100%", minHeight: 43, padding: "9px 12px", border: "1px solid #dde5f0", borderRadius: 12, outline: "none" };
const errorStyle: React.CSSProperties = { padding: "11px 13px", borderRadius: 12, background: "#fff0f0", color: "#b93545", fontSize: "0.8125rem" };
const successStyle: React.CSSProperties = { padding: "11px 13px", borderRadius: 12, background: "#e3faf4", color: "#087d65", fontSize: "0.8125rem", fontWeight: 750 };
