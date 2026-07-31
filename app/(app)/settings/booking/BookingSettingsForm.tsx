"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addBookingQuestion, deleteBookingQuestion, saveBookingSettings } from "./actions";
import type { Locale } from "@/lib/i18n";

type Settings = {
  enabled?: boolean;
  approval_required?: boolean;
  enforce_service_area?: boolean;
  use_team_capacity?: boolean;
  min_notice_hours?: number;
  max_days_ahead?: number;
  slot_interval_min?: number;
  arrival_window_min?: number;
  hours_json?: Record<string, [string, string] | null>;
  payment_mode?: string;
  deposit_value?: number;
  success_message_en?: string | null;
  success_message_he?: string | null;
  timezone?: string | null;
};
type AreaEnforcement = { total: number; polygons: number; enforceable: number; unenforceable: boolean };

// Curated rather than Intl.supportedValuesOf(): this is a US deployment, and a
// fixed list renders identically on server and client (no hydration drift — see
// tests/hydration-guard.test.mjs). Any zone already saved is appended below, so
// an org that was set to something outside this list never loses its value.
const US_TIMEZONES = [
  ["America/New_York", "Eastern — New York"],
  ["America/Detroit", "Eastern — Detroit"],
  ["America/Chicago", "Central — Chicago"],
  ["America/Winnipeg", "Central — Winnipeg"],
  ["America/Denver", "Mountain — Denver"],
  ["America/Phoenix", "Mountain, no DST — Phoenix"],
  ["America/Los_Angeles", "Pacific — Los Angeles"],
  ["America/Anchorage", "Alaska — Anchorage"],
  ["Pacific/Honolulu", "Hawaii — Honolulu"],
  ["America/Puerto_Rico", "Atlantic — Puerto Rico"],
  ["America/Toronto", "Eastern — Toronto"],
  ["America/Vancouver", "Pacific — Vancouver"],
  ["UTC", "UTC"],
];
type Service = {
  job_type_id: string;
  name_en: string;
  name_he?: string | null;
  description_en?: string | null;
  description_he?: string | null;
  duration_min: number;
  price_minor: number;
  book_as: "job" | "estimate";
  active: boolean;
};
type JobType = { id: string; name: string; duration_min: number; default_price_minor: number; sort: number };
type Question = {
  id: string;
  label_en: string;
  label_he?: string | null;
  field_type: "text" | "textarea" | "choice" | "checkbox";
  options_json?: string[];
  required: boolean;
  active: boolean;
};

export default function BookingSettingsForm({ locale, orgId, settings, services, jobTypes, questions, hasServiceAreas, areaEnforcement }: {
  locale: Locale;
  orgId: string;
  settings: Settings;
  services: Service[];
  jobTypes: JobType[];
  questions: Question[];
  hasServiceAreas: boolean;
  areaEnforcement: AreaEnforcement;
}) {
  const he = locale === "he";
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const rows: Service[] = jobTypes.map((jobType) => services.find((service) => service.job_type_id === jobType.id) ?? {
    job_type_id: jobType.id,
    name_en: jobType.name,
    name_he: jobType.name,
    duration_min: jobType.duration_min,
    price_minor: jobType.default_price_minor,
    book_as: "job",
    active: true,
  });
  const hours = settings.hours_json ?? {};
  const weekday = hours["1"] ?? ["08:00", "17:00"];
  const saturday = hours["6"];
  const timezone = settings.timezone || "America/New_York";
  const timezoneOptions = US_TIMEZONES.some(([value]) => value === timezone)
    ? US_TIMEZONES
    : [...US_TIMEZONES, [timezone, timezone] as [string, string]];

  return <div className="booking-settings">
    <header className="ops-hero">
      <span>{he ? "הזמנה מקוונת" : "Online booking"}</span>
      <h1>{he ? "לקוחות קובעים. היומן נשאר בשליטה." : "Let customers book without losing control."}</h1>
      <p>{he ? "בוחרים אילו שירותים מוצגים, מתי אפשר להזמין ואם כל בקשה צריכה אישור." : "Choose the services customers see, when they can book, and whether every request needs approval."}</p>
      <div className="booking-settings-actions">
        <Link href={`/book/${orgId}`} target="_blank">{he ? "תצוגה מקדימה" : "Preview booking page"}</Link>
        <button type="button" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/book/${orgId}`).then(() => setMessage(he ? "הקישור הועתק" : "Link copied"))}>{he ? "העתקת קישור" : "Copy link"}</button>
      </div>
    </header>

    <form action={(data) => start(async () => {
      const result = await saveBookingSettings(data);
      setMessage(result.ok ? (he ? "ההגדרות נשמרו" : "Booking settings saved") : (result.error ?? "Error"));
      if (result.ok) router.refresh();
    })}>
      <section className="settings-section booking-setting-card">
        <h2>{he ? "איך מקבלים הזמנות" : "How bookings come in"}</h2>
        <div className="booking-toggle-grid">
          <Toggle name="enabled" defaultChecked={settings.enabled ?? true} title={he ? "הדף פעיל" : "Booking page is live"} copy={he ? "לקוחות יכולים לפתוח את הקישור ולשלוח בקשה." : "Customers can open the link and start booking."} />
          <Toggle name="approvalRequired" defaultChecked={settings.approval_required ?? true} title={he ? "אישור של המשרד" : "Office approval required"} copy={he ? "הבקשה נכנסת ללידים ורק אחר כך הופכת לעבודה." : "The request enters Leads before becoming a job."} />
          <Toggle name="useTeamCapacity" defaultChecked={settings.use_team_capacity ?? true} title={he ? "שימוש בזמינות הצוות" : "Use team availability"} copy={he ? "שעות שכבר תפוסות לא מוצגות ללקוח." : "Busy arrival windows are hidden from customers."} />
          <Toggle name="enforceServiceArea" defaultChecked={settings.enforce_service_area ?? false} title={he ? "בדיקת אזור השירות" : "Enforce service area"} copy={hasServiceAreas ? (he ? "המיקודים והערים מתפעול ישמשו לאישור הכתובת." : "ZIPs and cities from Operations will gate booking.") : (he ? "צריך להוסיף קודם אזור שירות במסך תפעול." : "Add a service area in Operations first.")} />
        </div>
        {/* The toggle used to claim enforcement that never ran for polygon areas.
            Say plainly which areas are actually checked. */}
        {areaEnforcement.polygons > 0 && <p className="booking-provider-note booking-area-warning" role="status">
          <strong>{areaEnforcement.unenforceable
            ? (he ? "אזור השירות אינו נאכף." : "Service area is NOT being enforced.")
            : (he ? "חלק מאזורי השירות אינם נבדקים." : "Some service areas are not checked.")}</strong>{" "}
          {he
            ? `${areaEnforcement.polygons} מתוך ${areaEnforcement.total} אזורי השירות מוגדרים כפוליגון. בדיקת פוליגון מחייבת מיקום גאוגרפי מדויק של הכתובת, שהמערכת אינה מפיקה, ולכן הם אינם נבדקים.`
            : `${areaEnforcement.polygons} of your ${areaEnforcement.total} service areas are polygons. A polygon can only be tested against map coordinates for the address, which this system does not produce, so polygons are never checked.`}{" "}
          {areaEnforcement.unenforceable
            ? (he ? "עד שיתווסף אזור מיקוד או עיר, כל הזמנה תיכנס ללידים לאישור ידני במקום להתאשר אוטומטית." : "Until you add a ZIP or city area, every booking is held in Leads for manual approval instead of being auto-confirmed.")
            : (he ? "רק אזורי המיקוד והערים נאכפים." : "Only your ZIP and city areas are enforced.")}{" "}
          <Link href="/operations">{he ? "ניהול אזורי שירות" : "Manage service areas"}</Link>
        </p>}
      </section>

      <section className="settings-section booking-setting-card">
        <h2>{he ? "שעות וזמינות" : "Hours & availability"}</h2>
        <p className="settings-section-note">{he ? "כל השעות כאן הן לפי אזור הזמן של העסק — לא לפי השרת ולא לפי הדפדפן של הלקוח." : "Every time here is your business's local clock — not the server's and not the customer's browser."}</p>
        <div className="booking-admin-grid">
          <Field label={he ? "אזור זמן העסק" : "Business timezone"}><select name="timezone" defaultValue={timezone}>{timezoneOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
          <Field label={he ? "פתיחה א׳–ה׳" : "Weekday opening"}><input type="time" name="weekdayOpen" defaultValue={weekday[0]} /></Field>
          <Field label={he ? "סגירה א׳–ה׳" : "Weekday closing"}><input type="time" name="weekdayClose" defaultValue={weekday[1]} /></Field>
          <Field label={he ? "התראה מראש בשעות" : "Minimum notice (hours)"}><input type="number" name="minNoticeHours" min="0" max="720" defaultValue={settings.min_notice_hours ?? 4} /></Field>
          <Field label={he ? "כמה ימים קדימה" : "Days available ahead"}><input type="number" name="maxDaysAhead" min="1" max="365" defaultValue={settings.max_days_ahead ?? 60} /></Field>
          <Field label={he ? "מרווח בין שעות" : "Slot interval"}><select name="slotIntervalMin" defaultValue={settings.slot_interval_min ?? 60}>{[30, 60, 90, 120].map((value) => <option value={value} key={value}>{value} {he ? "דק׳" : "min"}</option>)}</select></Field>
          <Field label={he ? "חלון הגעה" : "Arrival window"}><select name="arrivalWindowMin" defaultValue={settings.arrival_window_min ?? 120}>{[30, 60, 90, 120, 180, 240].map((value) => <option value={value} key={value}>{value} {he ? "דק׳" : "min"}</option>)}</select></Field>
        </div>
        <label className="booking-saturday"><input type="checkbox" name="saturday" defaultChecked={Boolean(saturday)} /><span>{he ? "פתוח גם בשבת" : "Also open Saturday"}</span><input type="time" name="saturdayOpen" defaultValue={saturday?.[0] ?? "09:00"} /><input type="time" name="saturdayClose" defaultValue={saturday?.[1] ?? "14:00"} /></label>
      </section>

      <section className="settings-section booking-setting-card">
        <h2>{he ? "שירותים שאפשר להזמין" : "Bookable services"}</h2>
        <p className="settings-section-note">{he ? "כל שירות מגיע מסוגי העבודות. אפשר להציג שם ותיאור שונים ללקוחות." : "Services come from Job types. Customer-facing names and descriptions can be different."}</p>
        <div className="booking-service-admin">{rows.length ? rows.map((row) => {
          const id = String(row.job_type_id); const key = id.replaceAll("-", "");
          return <article key={id}>
            <input type="hidden" name="jobTypeId" value={id} />
            <label className="booking-service-enabled"><input type="checkbox" name={`enabled_${key}`} defaultChecked={row.active ?? true} /><strong>{he ? "מוצג בדף" : "Shown online"}</strong></label>
            <div className="booking-admin-grid">
              <Field label="English"><input name={`nameEn_${key}`} defaultValue={row.name_en} /></Field>
              <Field label="עברית"><input name={`nameHe_${key}`} defaultValue={row.name_he ?? row.name_en} /></Field>
              <Field label={he ? "משך בדקות" : "Duration (min)"}><input type="number" name={`duration_${key}`} min="15" defaultValue={row.duration_min} /></Field>
              <Field label={he ? "מחיר (אפשר להשאיר 0)" : "Price (0 hides price)"}><input type="number" step="0.01" min="0" name={`price_${key}`} defaultValue={(Number(row.price_minor ?? 0) / 100).toFixed(2)} /></Field>
              <Field label={he ? "נוצר כ" : "Book as"}><select name={`bookAs_${key}`} defaultValue={row.book_as ?? "job"}><option value="job">{he ? "עבודה" : "Job"}</option><option value="estimate">{he ? "בקשת הצעת מחיר" : "Estimate request"}</option></select></Field>
              <Field label={he ? "תיאור באנגלית" : "English description"}><input name={`descriptionEn_${key}`} defaultValue={row.description_en ?? ""} /></Field>
              <Field label={he ? "תיאור בעברית" : "Hebrew description"}><input name={`descriptionHe_${key}`} defaultValue={row.description_he ?? ""} /></Field>
            </div>
          </article>;
        }) : <div className="booking-admin-empty"><strong>{he ? "עדיין אין סוגי עבודות" : "No job types yet"}</strong><p>{he ? "הוסיפו סוגי עבודות בהגדרות, והם יופיעו כאן אוטומטית." : "Add Job types in Settings and they will appear here automatically."}</p><Link href="/settings">{he ? "להגדרות" : "Open Settings"}</Link></div>}</div>
      </section>

      <section className="settings-section booking-setting-card">
        <h2>{he ? "תשלום והודעת סיום" : "Payment & confirmation"}</h2>
        <div className="booking-admin-grid">
          <Field label={he ? "מה גובים בזמן ההזמנה" : "Booking payment rule"}><select name="paymentMode" defaultValue={settings.payment_mode ?? "none"}><option value="none">{he ? "בלי תשלום" : "No payment"}</option><option value="fixed">{he ? "מקדמה קבועה" : "Fixed deposit"}</option><option value="percentage">{he ? "מקדמה באחוזים" : "Percentage deposit"}</option><option value="full">{he ? "תשלום מלא" : "Full payment"}</option></select></Field>
          <Field label={he ? "סכום או אחוז" : "Amount or percentage"}><input type="number" name="depositValue" min="0" defaultValue={settings.deposit_value ?? 0} /></Field>
        </div>
        <p className="booking-provider-note">{he ? "Helcim תחייב בפועל רק אחרי שחיבור הסליקה יאושר. עד אז הלקוח יקבל קישור לתשלום לאחר אישור הבקשה." : "Helcim will charge only after production processing is connected. Until then, customers receive a payment link after approval."}</p>
        <div className="booking-admin-grid">
          <Field label={he ? "הודעת הצלחה באנגלית" : "English success message"}><textarea name="successMessageEn" defaultValue={settings.success_message_en ?? ""} /></Field>
          <Field label={he ? "הודעת הצלחה בעברית" : "Hebrew success message"}><textarea name="successMessageHe" defaultValue={settings.success_message_he ?? ""} /></Field>
        </div>
      </section>
      {message && <div className="booking-admin-message" role="status">{message}</div>}
      <button className="settings-save booking-admin-save" disabled={pending}>{pending ? (he ? "שומרים…" : "Saving…") : (he ? "שמירת הגדרות ההזמנה" : "Save booking settings")}</button>
    </form>

    <QuestionManager locale={locale} questions={questions} onChanged={() => router.refresh()} />
  </div>;
}

function QuestionManager({ locale, questions, onChanged }: { locale: Locale; questions: Question[]; onChanged: () => void }) {
  const he = locale === "he";
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return <section className="settings-section booking-setting-card booking-questions-admin">
    <div className="booking-question-heading"><div><h2>{he ? "שאלות לפני ההזמנה" : "Booking questions"}</h2><p>{he ? "אוספים מראש את הפרטים שהצוות צריך כדי להגיע מוכן." : "Collect the details your team needs before arriving."}</p></div><b>{questions.length}</b></div>
    <form action={(data) => start(async () => {
      const result = await addBookingQuestion(data);
      setMessage(result.ok ? (he ? "השאלה נוספה" : "Question added") : (result.error ?? "Error"));
      if (result.ok) onChanged();
    })} className="booking-question-form">
      <Field label="English"><input name="labelEn" required placeholder="How many units need service?" /></Field>
      <Field label="עברית"><input name="labelHe" placeholder="בכמה יחידות צריך לטפל?" /></Field>
      <Field label={he ? "סוג תשובה" : "Answer type"}><select name="fieldType"><option value="text">{he ? "שורה קצרה" : "Short answer"}</option><option value="textarea">{he ? "תשובה ארוכה" : "Long answer"}</option><option value="choice">{he ? "בחירה מרשימה" : "Multiple choice"}</option><option value="checkbox">{he ? "תיבת סימון" : "Checkbox"}</option></select></Field>
      <Field label={he ? "אפשרויות, מופרדות בפסיק" : "Choices, separated by commas"}><input name="options" placeholder={he ? "אחת, שתיים, שלוש" : "One, two, three"} /></Field>
      <label className="booking-question-required"><input type="checkbox" name="required" /><span>{he ? "שאלת חובה" : "Required question"}</span></label>
      <button type="submit" disabled={pending}>{pending ? (he ? "מוסיפים…" : "Adding…") : (he ? "הוספת שאלה" : "Add question")}</button>
    </form>
    <div className="booking-question-list">{questions.map((question) => <article key={question.id}><div><strong>{he ? (question.label_he || question.label_en) : question.label_en}</strong><small>{question.field_type}{question.required ? ` · ${he ? "חובה" : "required"}` : ""}</small></div><button type="button" disabled={pending} onClick={() => start(async () => { const data = new FormData(); data.set("id", question.id); const result = await deleteBookingQuestion(data); setMessage(result.ok ? (he ? "השאלה הוסרה" : "Question removed") : (result.error ?? "Error")); if (result.ok) onChanged(); })}>{he ? "הסרה" : "Remove"}</button></article>)}</div>
    {message && <div className="booking-question-message" role="status">{message}</div>}
  </section>;
}

function Toggle({ name, defaultChecked, title, copy }: { name: string; defaultChecked: boolean; title: string; copy: string }) { return <label><input type="checkbox" name={name} defaultChecked={defaultChecked} /><span><strong>{title}</strong><small>{copy}</small></span></label>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="booking-admin-field"><span>{label}</span>{children}</label>; }
