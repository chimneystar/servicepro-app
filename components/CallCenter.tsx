"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";
import {
  logCall,
  markCallFollowedUp,
  saveTrackedNumber,
} from "@/app/(app)/service-records/actions";

export type CallRow = {
  id: string;
  direction: string;
  status: string;
  from_number: string;
  to_number: string;
  reason: string | null;
  outcome: string | null;
  notes: string | null;
  needs_follow_up: boolean;
  duration_seconds: number;
  started_at: string;
  customers: { name: string } | { name: string }[] | null;
  jobs: { service: string } | { service: string }[] | null;
  tracked_phone_numbers:
    | { label: string; lead_source: string | null }
    | { label: string; lead_source: string | null }[]
    | null;
};
export type TrackingNumberRow = {
  id: string;
  phone_number: string;
  label: string;
  lead_source: string | null;
  campaign: string | null;
  destination_number: string;
  active: boolean;
  recording_enabled: boolean;
};

export default function CallCenter({
  locale,
  calls,
  numbers,
  customers,
  jobs,
  businessPhone,
  providerReady,
}: {
  locale: Locale;
  calls: CallRow[];
  numbers: TrackingNumberRow[];
  customers: { id: string; name: string; phone: string }[];
  jobs: { id: string; customerId: string; label: string }[];
  businessPhone: string;
  providerReady: boolean;
}) {
  const he = locale === "he";
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "missed" | "inbound" | "outbound" | "follow_up">(
    "all",
  );
  const [direction, setDirection] = useState<"inbound" | "outbound">("inbound");
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const selectedPhone = customers.find((row) => row.id === selectedCustomer)?.phone ?? "";
  const shown = useMemo(
    () =>
      calls.filter((call) => {
        if (filter === "all") return true;
        if (filter === "follow_up") return call.needs_follow_up;
        if (filter === "missed") return ["missed", "voicemail", "failed"].includes(call.status);
        return call.direction === filter;
      }),
    [calls, filter],
  );
  const missed = calls.filter((call) =>
    ["missed", "voicemail", "failed"].includes(call.status),
  ).length;
  const followUps = calls.filter((call) => call.needs_follow_up).length;
  const answered = calls.filter((call) => call.status === "completed").length;
  const conversion = calls.length
    ? Math.round((calls.filter((call) => call.outcome === "booked").length / calls.length) * 100)
    : 0;
  const run = (task: () => Promise<{ ok: boolean; error?: string }>, form?: HTMLFormElement) =>
    start(async () => {
      const result = await task();
      setMessage(
        result.ok
          ? he
            ? "השינוי נשמר"
            : "Saved"
          : (result.error ?? (he ? "לא הצלחנו לשמור" : "Couldn't save")),
      );
      if (result.ok) {
        form?.reset();
        router.refresh();
      }
    });
  return (
    <div className="calls-page">
      <header className="calls-hero">
        <div>
          <span>{he ? "מרכז שיחות" : "Call center"}</span>
          <h1>{he ? "כל שיחה הופכת לפעולה" : "Turn every call into the next action"}</h1>
          <p>
            {he
              ? "רואים מי התקשר, למה, מה סוכם ומי עדיין מחכה למענה."
              : "See who called, why, what happened, and who still needs a response."}
          </p>
        </div>
        <div className={`provider-chip ${providerReady ? "ready" : "manual"}`}>
          <i />
          {providerReady
            ? he
              ? "חיבור טלפוני מוכן להגדרה"
              : "Phone provider ready to configure"
            : he
              ? "תיעוד ידני פעיל"
              : "Manual call tracking active"}
        </div>
      </header>
      <div className="calls-stats">
        <Stat
          label={he ? "שיחות" : "Calls"}
          value={calls.length}
          copy={he ? "ביומן" : "in the log"}
        />
        <Stat
          label={he ? "דורשות מענה" : "Need follow-up"}
          value={followUps}
          copy={he ? "לטיפול עכשיו" : "action needed"}
          tone="yellow"
        />
        <Stat
          label={he ? "לא נענו" : "Missed"}
          value={missed}
          copy={he ? "כולל תא קולי" : "including voicemail"}
          tone="coral"
        />
        <Stat
          label={he ? "הפכו להזמנה" : "Booked"}
          value={`${conversion}%`}
          copy={`${answered} ${he ? "שיחות נענו" : "answered"}`}
        />
      </div>

      <div className="calls-workspace">
        <section className="call-log-card">
          <header>
            <div>
              <span>{he ? "יומן שיחות" : "Call log"}</span>
              <h2>{he ? "מהחדש לישן" : "Newest first"}</h2>
            </div>
            <b>{shown.length}</b>
          </header>
          <div className="call-filters">
            {(["all", "missed", "inbound", "outbound", "follow_up"] as const).map((item) => (
              <button
                type="button"
                key={item}
                className={filter === item ? "on" : ""}
                onClick={() => setFilter(item)}
              >
                {filterLabel(item, he)}
              </button>
            ))}
          </div>
          <div className="call-list">
            {shown.length ? (
              shown.map((call) => {
                const customer = first(call.customers)?.name;
                const job = first(call.jobs)?.service;
                const tracking = first(call.tracked_phone_numbers);
                const other = call.direction === "inbound" ? call.from_number : call.to_number;
                return (
                  <article key={call.id} className={call.needs_follow_up ? "needs-action" : ""}>
                    <div
                      className={`call-direction ${call.direction} ${call.status}`}
                      aria-hidden="true"
                    >
                      {call.direction === "inbound" ? "↙" : "↗"}
                    </div>
                    <div className="call-main">
                      <div>
                        <strong>{customer || formatPhone(other)}</strong>
                        <span>{statusLabel(call.status, he)}</span>
                      </div>
                      <p>
                        {[call.reason, call.outcome ? outcomeLabel(call.outcome, he) : null, job]
                          .filter(Boolean)
                          .join(" · ") || (he ? "לא נוסף סיכום" : "No summary added")}
                      </p>
                      <small>
                        {tracking
                          ? `${tracking.label}${tracking.lead_source ? ` · ${tracking.lead_source}` : ""}`
                          : he
                            ? "מספר העסק"
                            : "Business line"}{" "}
                        · {formatDuration(call.duration_seconds)} ·{" "}
                        {new Intl.DateTimeFormat(he ? "he-IL" : "en-US", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(call.started_at))}
                      </small>
                      {call.notes && <blockquote>{call.notes}</blockquote>}
                    </div>
                    <div className="call-row-actions">
                      <a href={`tel:${other}`}>{he ? "חיוג" : "Call"}</a>
                      {call.needs_follow_up && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(() => markCallFollowedUp(call.id))}
                        >
                          {he ? "טופל" : "Done"}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="history-empty">
                <span>⌕</span>
                <strong>{he ? "אין שיחות במסנן הזה" : "No calls in this view"}</strong>
                <p>
                  {he ? "משנים מסנן או מתעדים שיחה חדשה." : "Try another filter or log a new call."}
                </p>
              </div>
            )}
          </div>
        </section>

        <aside className="calls-side">
          <details className="call-form-card" open>
            <summary>{he ? "תיעוד שיחה" : "Log a call"}</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                run(() => logCall(data), form);
              }}
            >
              <div>
                <label>
                  <span>{he ? "כיוון" : "Direction"}</span>
                  <select
                    name="direction"
                    value={direction}
                    onChange={(event) => setDirection(event.target.value as "inbound" | "outbound")}
                  >
                    <option value="inbound">{he ? "נכנסת" : "Inbound"}</option>
                    <option value="outbound">{he ? "יוצאת" : "Outbound"}</option>
                  </select>
                </label>
                <label>
                  <span>{he ? "תוצאה" : "Result"}</span>
                  <select name="status">
                    <option value="completed">{he ? "נענתה" : "Answered"}</option>
                    <option value="missed">{he ? "לא נענתה" : "Missed"}</option>
                    <option value="voicemail">{he ? "תא קולי" : "Voicemail"}</option>
                    <option value="failed">{he ? "נכשלה" : "Failed"}</option>
                  </select>
                </label>
              </div>
              <label>
                <span>{he ? "לקוח" : "Customer"}</span>
                <select
                  name="customerId"
                  value={selectedCustomer}
                  onChange={(event) => setSelectedCustomer(event.target.value)}
                >
                  <option value="">{he ? "מספר לא מוכר" : "Unknown caller"}</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name} · {customer.phone}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{he ? "עבודה קשורה" : "Related job"}</span>
                <select name="jobId">
                  <option value="">{he ? "ללא עבודה" : "No job"}</option>
                  {jobs
                    .filter((job) => !selectedCustomer || job.customerId === selectedCustomer)
                    .map((job) => (
                      <option value={job.id} key={job.id}>
                        {job.label}
                      </option>
                    ))}
                </select>
              </label>
              <div>
                <label>
                  <span>
                    {direction === "inbound"
                      ? he
                        ? "מאת"
                        : "From"
                      : he
                        ? "מספר העסק"
                        : "Business number"}
                  </span>
                  <input
                    name="fromNumber"
                    inputMode="tel"
                    required
                    defaultValue={direction === "inbound" ? selectedPhone : businessPhone}
                    key={`from-${direction}-${selectedCustomer}`}
                  />
                </label>
                <label>
                  <span>
                    {direction === "inbound" ? (he ? "למספר" : "To") : he ? "אל" : "To customer"}
                  </span>
                  <input
                    name="toNumber"
                    inputMode="tel"
                    required
                    defaultValue={direction === "inbound" ? businessPhone : selectedPhone}
                    key={`to-${direction}-${selectedCustomer}`}
                  />
                </label>
              </div>
              <label>
                <span>{he ? "סיבה" : "Reason"}</span>
                <input
                  name="reason"
                  placeholder={he ? "תיאום, הצעת מחיר, תשלום…" : "Scheduling, estimate, payment…"}
                />
              </label>
              <div>
                <label>
                  <span>{he ? "מה סוכם" : "Outcome"}</span>
                  <select name="outcome">
                    <option value="completed">{he ? "טופל" : "Handled"}</option>
                    <option value="booked">{he ? "נקבעה עבודה" : "Job booked"}</option>
                    <option value="callback">{he ? "צריך לחזור" : "Callback needed"}</option>
                    <option value="no_answer">{he ? "אין מענה" : "No answer"}</option>
                  </select>
                </label>
                <label>
                  <span>{he ? "משך בשניות" : "Seconds"}</span>
                  <input name="durationSeconds" type="number" min="0" defaultValue="0" />
                </label>
              </div>
              <label>
                <span>{he ? "סיכום" : "Notes"}</span>
                <textarea name="notes" rows={2} />
              </label>
              <label className="call-check">
                <input type="checkbox" name="needsFollowUp" />
                <span>{he ? "נדרש מעקב" : "Needs follow-up"}</span>
              </label>
              <button type="submit" disabled={pending}>
                {pending ? (he ? "שומרים…" : "Saving…") : he ? "שמירת השיחה" : "Save call"}
              </button>
            </form>
          </details>
          <details className="call-form-card">
            <summary>{he ? "מספר מעקב חדש" : "Add tracking number"}</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                run(() => saveTrackedNumber(new FormData(form)), form);
              }}
            >
              <label>
                <span>{he ? "שם המספר" : "Number label"}</span>
                <input
                  name="label"
                  required
                  placeholder={he ? "לדוגמה: Google Ads" : "e.g. Google Ads"}
                />
              </label>
              <div>
                <label>
                  <span>{he ? "מספר מעקב" : "Tracking number"}</span>
                  <input name="phoneNumber" required inputMode="tel" />
                </label>
                <label>
                  <span>{he ? "העברה אל" : "Forward to"}</span>
                  <input
                    name="destinationNumber"
                    required
                    defaultValue={businessPhone}
                    inputMode="tel"
                  />
                </label>
              </div>
              <div>
                <label>
                  <span>{he ? "מקור ליד" : "Lead source"}</span>
                  <input name="leadSource" placeholder="Google" />
                </label>
                <label>
                  <span>{he ? "קמפיין" : "Campaign"}</span>
                  <input name="campaign" />
                </label>
              </div>
              <label className="call-check recording">
                <input type="checkbox" name="recordingEnabled" />
                <span>
                  <strong>{he ? "הקלטת שיחות" : "Call recording"}</strong>
                  <small>
                    {he
                      ? "כבוי כברירת מחדל. בהפעלה תושמע הודעת הקלטה."
                      : "Off by default. Enabling it always plays a recording notice."}
                  </small>
                </span>
              </label>
              <button type="submit" disabled={pending}>
                {he ? "שמירת המספר" : "Save number"}
              </button>
            </form>
          </details>
          <section className="tracking-number-list">
            <header>
              <span>{he ? "מספרי מעקב" : "Tracking numbers"}</span>
              <b>{numbers.length}</b>
            </header>
            {numbers.map((number) => (
              <article key={number.id}>
                <div>
                  <strong>{number.label}</strong>
                  <small>
                    {formatPhone(number.phone_number)} → {formatPhone(number.destination_number)}
                  </small>
                </div>
                <span>{number.lead_source || (he ? "ללא מקור" : "No source")}</span>
              </article>
            ))}
            {!numbers.length && (
              <p>
                {he
                  ? "אפשר להתחיל בתיעוד ידני ולהוסיף מספר אחרי חיבור ספק הטלפוניה."
                  : "Manual tracking works now. Add a number after your phone provider is connected."}
              </p>
            )}
          </section>
        </aside>
      </div>
      {message && (
        <div className="history-form-message calls-message" role="status">
          {message}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  copy,
  tone = "blue",
}: {
  label: string;
  value: number | string;
  copy: string;
  tone?: string;
}) {
  return (
    <article className={`tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{copy}</small>
    </article>
  );
}
function first<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(-10);
  return digits.length === 10
    ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
    : value;
}
function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function filterLabel(value: string, he: boolean) {
  return (
    {
      all: he ? "הכול" : "All",
      missed: he ? "לא נענו" : "Missed",
      inbound: he ? "נכנסות" : "Inbound",
      outbound: he ? "יוצאות" : "Outbound",
      follow_up: he ? "דורשות מענה" : "Follow-up",
    } as Record<string, string>
  )[value];
}
function statusLabel(value: string, he: boolean) {
  return (
    (
      {
        completed: he ? "נענתה" : "Answered",
        missed: he ? "לא נענתה" : "Missed",
        voicemail: he ? "תא קולי" : "Voicemail",
        failed: he ? "נכשלה" : "Failed",
        ringing: he ? "מצלצלת" : "Ringing",
        in_progress: he ? "מתנהלת" : "In progress",
        initiated: he ? "התחילה" : "Started",
      } as Record<string, string>
    )[value] ?? value
  );
}
function outcomeLabel(value: string, he: boolean) {
  return (
    (
      {
        completed: he ? "טופל" : "Handled",
        booked: he ? "נקבעה עבודה" : "Job booked",
        callback: he ? "צריך לחזור" : "Callback needed",
        no_answer: he ? "אין מענה" : "No answer",
      } as Record<string, string>
    )[value] ?? value
  );
}
