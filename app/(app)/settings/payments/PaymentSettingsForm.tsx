"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { updatePaymentSettings, type PaymentSettingsResult } from "./actions";
import type { Locale } from "@/lib/i18n";
import type { PaymentSettings } from "@/lib/payments/types";
import { money } from "@/lib/format";
// @ts-ignore — pure logic, proven both ways in tests/deposits.test.mjs
import { defaultDepositMinor } from "@/lib/core/deposits.mjs";
// @ts-ignore — money is integer minor units; never Math.round(Number(x) * 100)
import { parseAmountToMinor } from "@/lib/core/money.mjs";

const initial: PaymentSettingsResult = { ok: false };

/** The worked example under the deposit control. $1,000 is a legible job. */
const SAMPLE_TOTAL_MINOR = 100000;

export default function PaymentSettingsForm({ locale, settings, currency }: { locale: Locale; settings: PaymentSettings; currency: string }) {
  const he = locale === "he";
  const [state, action] = useActionState(updatePaymentSettings, initial);
  const [zelle, setZelle] = useState(settings.zelle_enabled);
  const [checks, setChecks] = useState(settings.check_enabled);
  const [deposit, setDeposit] = useState(settings.default_deposit_type);
  const [depositPercent, setDepositPercent] = useState(String(settings.default_deposit_bps / 100));
  const [depositFixed, setDepositFixed] = useState((settings.default_deposit_minor / 100).toFixed(2));

  // The same function the database rule mirrors, run on the owner's numbers, so
  // the setting stops being an act of faith. Until this branch, this deposit was
  // saved and read by nothing at all: every estimate was created with zero.
  let fixedMinor = 0;
  // parseAmountToMinor, never Math.round(Number(x) * 100): the latter mis-rounds
  // and turns a typo into NaN, and this preview must agree exactly with what the
  // server action stores.
  try { fixedMinor = Number(parseAmountToMinor(depositFixed || "0")); } catch { fixedMinor = 0; }
  const previewMinor = Number(defaultDepositMinor({
    default_deposit_type: deposit,
    default_deposit_bps: Math.round(Math.max(0, Math.min(100, Number(depositPercent) || 0)) * 100),
    default_deposit_minor: fixedMinor,
  }, SAMPLE_TOTAL_MINOR));

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
      {deposit === "percent" && <Field name="deposit_percent" label={he ? "אחוז מקדמה" : "Deposit percentage"} value={depositPercent} onChange={setDepositPercent} suffix="%" type="number" />}
      {deposit === "fixed" && <Field name="deposit_fixed" label={he ? `סכום מקדמה (${currency})` : `Deposit amount (${currency})`} value={depositFixed} onChange={setDepositFixed} type="number" />}
      <p className="settings-section-note">{deposit === "none"
        ? (he ? "הצעות מחיר חדשות ייווצרו ללא מקדמה." : "New estimates are created with no deposit.")
        : previewMinor > 0
          ? (he ? `לדוגמה: הצעת מחיר על ${money(SAMPLE_TOTAL_MINOR, currency)} תבקש מקדמה של ${money(previewMinor, currency)}.` : `For example: a ${money(SAMPLE_TOTAL_MINOR, currency)} estimate will ask for a ${money(previewMinor, currency)} deposit.`)
          : (he ? "הערך הנוכחי לא יבקש מקדמה." : "The current value asks for no deposit.")}</p>
    </section>

    <section className="settings-section">
      <h3>{he ? "כללי תשלום מאובטח" : "Secure payment rules"}</h3>
      <div className="payment-rule-list">
        <RuleToggle name="fee_saver_enabled" defaultChecked={settings.fee_saver_enabled} title={he ? "הלקוח משלם את עמלת כרטיס האשראי" : "Customer covers eligible credit-card fees"} text={he ? "Helcim Fee Saver יחול רק כשהעסקה זכאית. אין עמלה על דביט או ACH." : "Helcim Fee Saver applies only when eligible. Debit and ACH are never surcharged."} />
        <RuleToggle name="ach_hold_until_settled" defaultChecked={settings.ach_hold_until_settled} title={he ? "להמתין עד ש־ACH נסגר" : "Wait for ACH settlement"} text={he ? "העבודה תישאר בהמתנה עד שהבנק מאשר את התשלום." : "The job remains on hold until the bank confirms settlement."} />
        {/* Saved payment methods are NOT available. Storing a reusable card
            token needs Helcim vault credentials that do not exist in this
            environment, and a switch that claims to save cards while saving
            nothing is worse than no switch: the business tells customers their
            card is on file. The control is disabled and says so, and the stored
            preference is left untouched by the server action. See
            docs/REMEDIATION-PLAN.md item 5.3. */}
        <RuleToggle name="save_methods_enabled" defaultChecked={settings.save_methods_enabled} disabled title={he ? "שמירת אמצעי תשלום — עדיין לא זמין" : "Saved payment methods — not available yet"} text={he ? "דורש כספת כרטיסים של Helcim שאינה מחוברת. עד אז אין שמירה של כרטיס, וההגדרה הזו אינה עושה דבר." : "Requires Helcim card tokenisation, which is not connected. No card is stored today and this setting does nothing."} />
        <RuleToggle name="tips_enabled" defaultChecked={settings.tips_enabled} title={he ? "לאפשר טיפ" : "Allow tips"} text={he ? "הטיפ נוסף על החשבון, מוצג בנפרד ואינו מוריד מיתרת החשבונית." : "A tip is charged on top of the bill, recorded separately, and never reduces the invoice balance."} />
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
function RuleToggle({ name, title, text, defaultChecked, disabled }: { name: string; title: string; text: string; defaultChecked: boolean; disabled?: boolean }) { return <label className={`payment-rule${disabled ? " is-unavailable" : ""}`}><span><strong>{title}</strong><small>{text}</small></span><input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} /><span className="payment-switch" /></label>; }
function Field({ name, label, defaultValue, value, onChange, type = "text", placeholder, suffix, dir }: { name: string; label: string; defaultValue?: string; value?: string; onChange?: (next: string) => void; type?: string; placeholder?: string; suffix?: string; dir?: "ltr" | "rtl" }) { const controlled = value !== undefined; return <label className="payment-field"><span>{label}</span><span className="payment-input-wrap"><input name={name} defaultValue={controlled ? undefined : defaultValue} value={controlled ? value : undefined} onChange={controlled ? (event) => onChange?.(event.target.value) : undefined} type={type} step={type === "number" ? "0.01" : undefined} min={type === "number" ? "0" : undefined} placeholder={placeholder} dir={dir} />{suffix && <b>{suffix}</b>}</span></label>; }
function TextArea({ name, label, defaultValue, placeholder }: { name: string; label: string; defaultValue: string; placeholder: string }) { return <label className="payment-field"><span>{label}</span><textarea name={name} defaultValue={defaultValue} placeholder={placeholder} rows={3} /></label>; }
function SaveButton({ locale }: { locale: Locale }) { const { pending } = useFormStatus(); return <button type="submit" className="settings-save payment-save" disabled={pending}>{pending ? (locale === "he" ? "שומרים…" : "Saving…") : (locale === "he" ? "שמירת הגדרות תשלום" : "Save payment settings")}</button>; }
