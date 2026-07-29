"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { updatePaymentSettings, type PaymentSettingsResult } from "./actions";
import type { Locale } from "@/lib/i18n";
import type { PaymentSettings } from "@/lib/payments/types";

const initial: PaymentSettingsResult = { ok: false };

export default function PaymentSettingsForm({ locale, settings, currency }: { locale: Locale; settings: PaymentSettings; currency: string }) {
  const he = locale === "he";
  const [state, action] = useActionState(updatePaymentSettings, initial);
  const [zelle, setZelle] = useState(settings.zelle_enabled);
  const [checks, setChecks] = useState(settings.check_enabled);
  const [deposit, setDeposit] = useState(settings.default_deposit_type);

  return <form action={action} className="payment-settings-form">
    <section className="settings-section payment-method-section">
      <div className="payment-section-heading">
        <div><span className="payment-eyebrow">{he ? "איך הלקוח משלם" : "How customers pay"}</span><h3>{he ? "אמצעי תשלום" : "Payment methods"}</h3></div>
        <span className="payment-secure-mark">{he ? "מידע מאובטח" : "Secure by design"}</span>
      </div>
      <p className="settings-section-note">{he ? "אפשר להפעיל רק את האפשרויות שמתאימות לעסק. כרטיס ו־ACH יעבדו אחרי חיבור Helcim." : "Turn on only what fits the business. Card and ACH become available after Helcim is connected."}</p>
      <div className="payment-method-grid">
        <MethodToggle name="card_enabled" defaultChecked={settings.card_enabled} icon="▰" title={he ? "כרטיס אשראי" : "Credit card"} text={he ? "תשלום מאובטח דרך Helcim" : "Secure checkout through Helcim"} />
        <MethodToggle name="ach_enabled" defaultChecked={settings.ach_enabled} icon="⌁" title="ACH" text={he ? "חיוב חשבון בנק בארה״ב" : "US bank-account payment"} />
        <MethodToggle name="zelle_enabled" checked={zelle} onChange={setZelle} icon="Z" title="Zelle" text={he ? "הצגת פרטי העסק ואישור ידני" : "Show business details; verify manually"} />
        <MethodToggle name="check_enabled" checked={checks} onChange={setChecks} icon="✓" title={he ? "צ׳ק בדואר" : "Mail a check"} text={he ? "כתובת למשלוח ואישור לאחר קליטה" : "Mailing details and receipt verification"} />
      </div>
    </section>

    <section className="settings-section">
      <h3>{he ? "מקדמה ותשלומים לפי שלבים" : "Deposit and payment schedule"}</h3>
      <p className="settings-section-note">{he ? "ברירת המחדל היא מקדמה ואז יתרה סופית. בכל הצעה אפשר לשנות את הסכום או להוסיף שלבים." : "The standard flow is a deposit followed by the final balance. Each estimate can override it or add milestones."}</p>
      <div className="deposit-choice-row">
        {[{ value: "none", en: "No deposit", he: "ללא מקדמה" }, { value: "percent", en: "Percentage", he: "אחוז" }, { value: "fixed", en: "Fixed amount", he: "סכום קבוע" }].map((choice) =>
          <label key={choice.value} className={`deposit-choice ${deposit === choice.value ? "selected" : ""}`}><input type="radio" name="default_deposit_type" value={choice.value} checked={deposit === choice.value} onChange={() => setDeposit(choice.value as PaymentSettings["default_deposit_type"])} /><span>{he ? choice.he : choice.en}</span></label>
        )}
      </div>
      {deposit === "percent" && <Field name="deposit_percent" label={he ? "אחוז מקדמה" : "Deposit percentage"} defaultValue={String(settings.default_deposit_bps / 100)} suffix="%" type="number" />}
      {deposit === "fixed" && <Field name="deposit_fixed" label={he ? `סכום מקדמה (${currency})` : `Deposit amount (${currency})`} defaultValue={(settings.default_deposit_minor / 100).toFixed(2)} type="number" />}
    </section>

    <section className="settings-section">
      <h3>{he ? "כללי תשלום מאובטח" : "Secure payment rules"}</h3>
      <div className="payment-rule-list">
        <RuleToggle name="fee_saver_enabled" defaultChecked={settings.fee_saver_enabled} title={he ? "הלקוח משלם את עמלת כרטיס האשראי" : "Customer covers eligible credit-card fees"} text={he ? "Helcim Fee Saver יחול רק כשהעסקה זכאית. אין עמלה על דביט או ACH." : "Helcim Fee Saver applies only when eligible. Debit and ACH are never surcharged."} />
        <RuleToggle name="ach_hold_until_settled" defaultChecked={settings.ach_hold_until_settled} title={he ? "להמתין עד ש־ACH נסגר" : "Wait for ACH settlement"} text={he ? "העבודה תישאר בהמתנה עד שהבנק מאשר את התשלום." : "The job remains on hold until the bank confirms settlement."} />
        <RuleToggle name="save_methods_enabled" defaultChecked={settings.save_methods_enabled} title={he ? "לאפשר שמירת אמצעי תשלום" : "Allow saved payment methods"} text={he ? "רק לאחר אישור ברור מהלקוח." : "Only after clear customer consent."} />
        <RuleToggle name="tips_enabled" defaultChecked={settings.tips_enabled} title={he ? "לאפשר טיפ" : "Allow tips"} text={he ? "הטיפ מוצג בנפרד ואינו מוריד מיתרת החשבונית." : "Tips stay separate and never reduce the invoice balance."} />
      </div>
      <Field name="tip_options" label={he ? "אפשרויות טיפ באחוזים" : "Suggested tip percentages"} defaultValue={settings.suggested_tip_percents.join(", ")} placeholder="15, 20, 25" />
    </section>

    {!zelle && <><input type="hidden" name="zelle_recipient_name" value={settings.zelle_recipient_name ?? ""} /><input type="hidden" name="zelle_email" value={settings.zelle_email ?? ""} /><input type="hidden" name="zelle_phone" value={settings.zelle_phone ?? ""} /><input type="hidden" name="zelle_qr_url" value={settings.zelle_qr_url ?? ""} /><input type="hidden" name="zelle_instructions" value={settings.zelle_instructions ?? ""} /></>}
    {zelle && <section className="settings-section method-details pop-in">
      <span className="method-detail-badge">Zelle</span><h3>{he ? "פרטים שהלקוח יראה" : "Details shown to the customer"}</h3>
      <Field name="zelle_recipient_name" label={he ? "שם מקבל התשלום" : "Recipient name"} defaultValue={settings.zelle_recipient_name ?? ""} />
      <div className="payment-two-cols"><Field name="zelle_email" label={he ? "אימייל שמחובר ל־Zelle" : "Zelle-enrolled email"} defaultValue={settings.zelle_email ?? ""} type="email" /><Field name="zelle_phone" label={he ? "או מספר נייד שמחובר ל־Zelle" : "Or Zelle-enrolled mobile"} defaultValue={settings.zelle_phone ?? ""} /></div>
      <Field name="zelle_qr_url" label={he ? "קישור לתמונת QR, אם יש" : "QR image URL, if available"} defaultValue={settings.zelle_qr_url ?? ""} dir="ltr" />
      <TextArea name="zelle_instructions" label={he ? "הוראה קצרה ללקוח" : "Short customer instruction"} defaultValue={settings.zelle_instructions ?? ""} placeholder={he ? "נא לציין את מספר ההצעה או החשבונית בהערה." : "Include the estimate or invoice number in the memo."} />
    </section>}

    {!checks && <><input type="hidden" name="check_payee" value={settings.check_payee ?? ""} /><input type="hidden" name="check_address" value={settings.check_address ?? ""} /><input type="hidden" name="check_city_state_zip" value={settings.check_city_state_zip ?? ""} /><input type="hidden" name="check_memo_instructions" value={settings.check_memo_instructions ?? ""} /></>}
    {checks && <section className="settings-section method-details pop-in">
      <span className="method-detail-badge gold">{he ? "צ׳ק" : "CHECK"}</span><h3>{he ? "כתובת למשלוח צ׳קים" : "Check mailing details"}</h3>
      <Field name="check_payee" label={he ? "לפקודת" : "Payable to"} defaultValue={settings.check_payee ?? ""} />
      <Field name="check_address" label={he ? "כתובת למשלוח" : "Mailing address"} defaultValue={settings.check_address ?? ""} />
      <Field name="check_city_state_zip" label={he ? "עיר, מדינה ומיקוד" : "City, state and ZIP"} defaultValue={settings.check_city_state_zip ?? ""} />
      <TextArea name="check_memo_instructions" label={he ? "מה לרשום בשורת ההערה" : "Memo instructions"} defaultValue={settings.check_memo_instructions ?? ""} placeholder={he ? "נא לרשום את מספר החשבונית." : "Include the invoice number in the memo."} />
    </section>}

    <section className="settings-section">
      <h3>{he ? "קבלות ועדכונים" : "Receipts and updates"}</h3>
      <div className="payment-two-cols">
        <MethodToggle name="receipt_email_enabled" defaultChecked={settings.receipt_email_enabled} icon="@" title={he ? "אימייל" : "Email"} text={he ? "קבלה ועדכון סטטוס" : "Receipt and status updates"} />
        <MethodToggle name="receipt_sms_enabled" defaultChecked={settings.receipt_sms_enabled} icon="◌" title="SMS" text={he ? "הודעה קצרה לטלפון" : "Short phone notification"} />
      </div>
    </section>

    {state.error && <div className="payment-form-message error">{state.error}</div>}
    {state.ok && <div className="payment-form-message success pop-in">{he ? "הגדרות התשלום נשמרו" : "Payment settings saved"}</div>}
    <SaveButton locale={locale} />
  </form>;
}

function MethodToggle({ name, icon, title, text, defaultChecked, checked, onChange }: { name: string; icon: string; title: string; text: string; defaultChecked?: boolean; checked?: boolean; onChange?: (value: boolean) => void }) {
  const controlled = checked !== undefined;
  return <label className={`payment-method-card ${(controlled ? checked : defaultChecked) ? "on" : ""}`}><input type="checkbox" name={name} defaultChecked={controlled ? undefined : defaultChecked} checked={controlled ? checked : undefined} onChange={controlled ? (event) => onChange?.(event.target.checked) : undefined} /><span className="payment-method-icon">{icon}</span><span className="payment-method-copy"><strong>{title}</strong><small>{text}</small></span><span className="payment-switch" /></label>;
}
function RuleToggle({ name, title, text, defaultChecked }: { name: string; title: string; text: string; defaultChecked: boolean }) { return <label className="payment-rule"><span><strong>{title}</strong><small>{text}</small></span><input type="checkbox" name={name} defaultChecked={defaultChecked} /><span className="payment-switch" /></label>; }
function Field({ name, label, defaultValue, type = "text", placeholder, suffix, dir }: { name: string; label: string; defaultValue: string; type?: string; placeholder?: string; suffix?: string; dir?: "ltr" | "rtl" }) { return <label className="payment-field"><span>{label}</span><span className="payment-input-wrap"><input name={name} defaultValue={defaultValue} type={type} step={type === "number" ? "0.01" : undefined} min={type === "number" ? "0" : undefined} placeholder={placeholder} dir={dir} />{suffix && <b>{suffix}</b>}</span></label>; }
function TextArea({ name, label, defaultValue, placeholder }: { name: string; label: string; defaultValue: string; placeholder: string }) { return <label className="payment-field"><span>{label}</span><textarea name={name} defaultValue={defaultValue} placeholder={placeholder} rows={3} /></label>; }
function SaveButton({ locale }: { locale: Locale }) { const { pending } = useFormStatus(); return <button className="settings-save payment-save" disabled={pending}>{pending ? (locale === "he" ? "שומרים…" : "Saving…") : (locale === "he" ? "שמירת הגדרות תשלום" : "Save payment settings")}</button>; }
