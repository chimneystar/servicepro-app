"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Locale } from "@/lib/i18n";
import { reportWarrantyCallback, resolveWarrantyCallback, saveJobWarranty, scheduleWarrantyCallback } from "@/app/(app)/service-records/actions";

export type JobWarranty = { id: string; coverage_type: string; starts_on: string; expires_on: string | null; terms: string | null; status: string };
export type WarrantyCallback = { id: string; issue: string; priority: string; responsibility: string; status: string; scheduled_for: string | null; resolution: string | null; internal_cost_minor: number; callback_job_id: string | null; reported_at: string };
type TeamMember = { id: string; name: string };

export default function JobWarrantyPanel({ jobId, locale, warranty, callbacks, team, completedOn, scheduledOn, canManage, currency }: {
  jobId: string; locale: Locale; warranty: JobWarranty | null; callbacks: WarrantyCallback[]; team: TeamMember[];
  completedOn: string | null; scheduledOn: string; canManage: boolean; currency: string;
}) {
  const he = locale === "he"; const router = useRouter(); const [pending, start] = useTransition(); const [message, setMessage] = useState<string | null>(null);
  const run = (task: () => Promise<{ ok: boolean; error?: string; href?: string }>, form?: HTMLFormElement) => start(async () => {
    const result = await task(); setMessage(result.ok ? (he ? "השינוי נשמר" : "Warranty updated") : result.error ?? (he ? "לא הצלחנו לשמור" : "Couldn't save"));
    if (result.ok) { form?.reset(); router.refresh(); }
  });
  const startDate = completedOn?.slice(0, 10) || scheduledOn;
  const expiresDefault = new Date(`${startDate}T12:00:00`); expiresDefault.setFullYear(expiresDefault.getFullYear() + 1);
  return <div className="warranty-job-panel">
    <section className={`warranty-status-card ${warranty ? "covered" : "not-covered"}`}>
      <div className="warranty-shield" aria-hidden="true">{warranty ? "✓" : "+"}</div>
      <div><span>{he ? "אחריות לעבודה" : "Job warranty"}</span><h3>{warranty ? (he ? "העבודה מכוסה" : "Coverage is active") : (he ? "עדיין לא הוגדרה אחריות" : "No warranty added yet")}</h3><p>{warranty ? `${coverageLabel(warranty.coverage_type, he)} · ${warranty.starts_on}${warranty.expires_on ? ` – ${warranty.expires_on}` : ""}` : (he ? "מגדירים פעם אחת כדי שכל חזרה תהיה ברורה ומתועדת." : "Add coverage once so every return visit is clear and traceable.")}</p></div>
      {warranty && <b>{warranty.status === "active" ? (he ? "בתוקף" : "Active") : warranty.status}</b>}
    </section>
    {warranty?.terms && <section className="warranty-terms"><span>{he ? "מה מכוסה" : "Coverage terms"}</span><p>{warranty.terms}</p></section>}

    {canManage && <div className="warranty-admin-grid">
      <details className="warranty-form-card" open={!warranty}><summary>{warranty ? (he ? "עדכון אחריות" : "Update coverage") : (he ? "הוספת אחריות" : "Add warranty")}</summary><form onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; run(() => saveJobWarranty(jobId, new FormData(form))); }}>
        <label><span>{he ? "סוג הכיסוי" : "Coverage type"}</span><select name="coverageType" defaultValue={warranty?.coverage_type ?? "workmanship"}><option value="workmanship">{he ? "אחריות על העבודה" : "Workmanship"}</option><option value="manufacturer">{he ? "אחריות יצרן" : "Manufacturer"}</option><option value="custom">{he ? "כיסוי מותאם" : "Custom"}</option></select></label>
        <div><label><span>{he ? "מתחילה" : "Starts"}</span><input type="date" name="startsOn" required defaultValue={warranty?.starts_on ?? startDate} /></label><label><span>{he ? "מסתיימת" : "Expires"}</span><input type="date" name="expiresOn" defaultValue={warranty?.expires_on ?? expiresDefault.toISOString().slice(0, 10)} /></label></div>
        <label><span>{he ? "תנאי הכיסוי" : "Coverage terms"}</span><textarea name="terms" rows={3} defaultValue={warranty?.terms ?? ""} placeholder={he ? "למשל: תיקון ללא חיוב במקרה של ליקוי בעבודה" : "e.g. No-charge repair for defects in workmanship"} /></label>
        <button type="submit" disabled={pending}>{pending ? (he ? "שומרים…" : "Saving…") : (he ? "שמירת האחריות" : "Save warranty")}</button>
      </form></details>
      <details className="warranty-form-card"><summary>{he ? "פתיחת חזרה באחריות" : "Report a warranty callback"}</summary><form onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; run(() => reportWarrantyCallback(jobId, new FormData(form)), form); }}>
        <label><span>{he ? "מה הלקוח דיווח?" : "What did the customer report?"}</span><textarea name="issue" rows={3} required placeholder={he ? "כותבים עובדות קצרות וברורות" : "Keep it factual and specific"} /></label>
        <div><label><span>{he ? "דחיפות" : "Priority"}</span><select name="priority"><option value="normal">{he ? "רגילה" : "Normal"}</option><option value="urgent">{he ? "דחופה" : "Urgent"}</option><option value="low">{he ? "נמוכה" : "Low"}</option></select></label><label><span>{he ? "אחריות" : "Responsibility"}</span><select name="responsibility"><option value="review">{he ? "לבדיקה" : "Needs review"}</option><option value="covered">{he ? "מכוסה" : "Covered"}</option><option value="customer">{he ? "באחריות הלקוח" : "Customer responsibility"}</option><option value="manufacturer">{he ? "אחריות יצרן" : "Manufacturer"}</option><option value="third_party">{he ? "צד שלישי" : "Third party"}</option></select></label></div>
        <button type="submit" disabled={pending}>{pending ? (he ? "פותחים…" : "Reporting…") : (he ? "פתיחת חזרה" : "Report callback")}</button>
      </form></details>
    </div>}

    <section className="callback-list"><header><div><span>{he ? "חזרות ותיקונים" : "Callbacks & return visits"}</span><h3>{he ? "לא מאבדים אף פנייה" : "Nothing falls through the cracks"}</h3></div><b>{callbacks.length}</b></header>
      {callbacks.length ? callbacks.map((callback) => <article key={callback.id} className={`priority-${callback.priority}`}>
        <div className="callback-copy"><div><span>{priorityLabel(callback.priority, he)}</span><b>{statusLabel(callback.status, he)}</b></div><h4>{callback.issue}</h4><p>{responsibilityLabel(callback.responsibility, he)} · {new Intl.DateTimeFormat(he ? "he-IL" : "en-US", { dateStyle: "medium" }).format(new Date(callback.reported_at))}</p>{callback.resolution && <blockquote>{callback.resolution}</blockquote>}</div>
        <div className="callback-actions">{callback.callback_job_id ? <Link href={`/jobs/${callback.callback_job_id}`}>{he ? "פתיחת הביקור החוזר" : "Open return visit"}</Link> : canManage && callback.status === "reported" ? <details><summary>{he ? "קביעת ביקור חוזר" : "Schedule return visit"}</summary><form onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; run(() => scheduleWarrantyCallback(callback.id, jobId, new FormData(form))); }}><input type="date" name="date" required aria-label={he ? "תאריך הביקור החוזר" : "Return visit date"} /><div><input type="time" name="start" aria-label={he ? "שעת התחלה" : "Start time"} /><input type="time" name="end" aria-label={he ? "שעת סיום" : "End time"} /></div><select name="assignedTo" aria-label={he ? "שיוך לטכנאי" : "Assign to"}><option value="">{he ? "ללא שיבוץ" : "Unassigned"}</option>{team.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select><button type="submit" disabled={pending}>{he ? "יצירת עבודה מקושרת" : "Create linked job"}</button></form></details> : null}
          {canManage && !["resolved", "denied"].includes(callback.status) && <details><summary>{he ? "סגירת הטיפול" : "Resolve"}</summary><form onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; run(() => resolveWarrantyCallback(callback.id, jobId, new FormData(form))); }}><select name="decision" aria-label={he ? "החלטה" : "Decision"}><option value="resolved">{he ? "טופל" : "Resolved"}</option><option value="denied">{he ? "לא במסגרת האחריות" : "Not covered"}</option></select><textarea name="resolution" required placeholder={he ? "מה נעשה ומה סוכם" : "What was done and agreed"} aria-label={he ? "מה נעשה ומה סוכם" : "What was done and agreed"} /><label><span>{he ? "עלות פנימית" : "Internal cost"}</span><input type="number" name="cost" min="0" step="0.01" defaultValue="0" /></label><button type="submit" disabled={pending}>{he ? "שמירה וסגירה" : "Save & close"}</button></form></details>}
        </div>
        {callback.internal_cost_minor > 0 && <small>{he ? "עלות פנימית" : "Internal cost"}: {new Intl.NumberFormat(he ? "he-IL" : "en-US", { style: "currency", currency }).format(callback.internal_cost_minor / 100)}</small>}
      </article>) : <div className="history-empty"><span>✓</span><strong>{he ? "אין חזרות פתוחות" : "No callbacks reported"}</strong><p>{he ? "אם לקוח חוזר עם בעיה, פותחים כאן פנייה ומקשרים ביקור חדש." : "If a customer reports an issue, open it here and link the return visit."}</p></div>}
    </section>
    {message && <div className="history-form-message" role="status">{message}</div>}
  </div>;
}

function coverageLabel(value: string, he: boolean) { return ({ workmanship: he ? "אחריות על העבודה" : "Workmanship", manufacturer: he ? "אחריות יצרן" : "Manufacturer", custom: he ? "כיסוי מותאם" : "Custom" } as Record<string, string>)[value] ?? value; }
function priorityLabel(value: string, he: boolean) { return ({ urgent: he ? "דחוף" : "Urgent", normal: he ? "רגיל" : "Normal", low: he ? "נמוך" : "Low" } as Record<string, string>)[value] ?? value; }
function responsibilityLabel(value: string, he: boolean) { return ({ review: he ? "ממתין לבדיקת אחריות" : "Coverage review", covered: he ? "מכוסה באחריות" : "Covered", customer: he ? "באחריות הלקוח" : "Customer responsibility", manufacturer: he ? "אחריות יצרן" : "Manufacturer warranty", third_party: he ? "באחריות צד שלישי" : "Third-party responsibility" } as Record<string, string>)[value] ?? value; }
function statusLabel(value: string, he: boolean) { return ({ reported: he ? "דווח" : "Reported", scheduled: he ? "נקבע ביקור" : "Scheduled", in_progress: he ? "בטיפול" : "In progress", resolved: he ? "נסגר" : "Resolved", denied: he ? "לא מכוסה" : "Not covered" } as Record<string, string>)[value] ?? value; }
