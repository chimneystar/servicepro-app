"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";
import type { JobTimelineEntry } from "@/lib/job-history";
import { addJobAction, completeJobAction, logCall } from "@/app/(app)/service-records/actions";

type TeamMember = { id: string; name: string };

export default function JobHistoryPanel({
  jobId,
  locale,
  entries,
  team,
  customerPhone,
  businessPhone,
  canManage,
}: {
  jobId: string;
  locale: Locale;
  entries: JobTimelineEntry[];
  team: TeamMember[];
  customerPhone: string;
  businessPhone: string;
  canManage: boolean;
}) {
  const he = locale === "he";
  const router = useRouter();
  const [pending, start] = useTransition();
  const [composer, setComposer] = useState<"note" | "follow_up" | "call">("note");
  const [direction, setDirection] = useState<"inbound" | "outbound">("outbound");
  const [message, setMessage] = useState<string | null>(null);
  const run = (task: () => Promise<{ ok: boolean; error?: string }>, form?: HTMLFormElement) =>
    start(async () => {
      const result = await task();
      setMessage(
        result.ok
          ? he
            ? "נשמר בהיסטוריית העבודה"
            : "Added to job history"
          : (result.error ?? (he ? "לא הצלחנו לשמור" : "Couldn't save")),
      );
      if (result.ok) {
        form?.reset();
        router.refresh();
      }
    });
  return (
    <div className="job-history-panel">
      <section className="history-composer">
        <header>
          <div>
            <span>{he ? "פעולה מהירה" : "Quick action"}</span>
            <h3>{he ? "מתעדים בזמן שזה קורה" : "Capture it while it happens"}</h3>
          </div>
          <small>
            {he ? "כל פעולה נשמרת עם שם ושעה" : "Every entry keeps the person and time"}
          </small>
        </header>
        <div className="history-composer-tabs" role="tablist">
          <button
            type="button"
            className={composer === "note" ? "on" : ""}
            onClick={() => setComposer("note")}
          >
            {he ? "הערה" : "Note"}
          </button>
          {canManage && (
            <button
              type="button"
              className={composer === "follow_up" ? "on" : ""}
              onClick={() => setComposer("follow_up")}
            >
              {he ? "משימת המשך" : "Follow-up"}
            </button>
          )}
          {canManage && (
            <button
              type="button"
              className={composer === "call" ? "on" : ""}
              onClick={() => setComposer("call")}
            >
              {he ? "תיעוד שיחה" : "Log call"}
            </button>
          )}
        </div>
        {composer !== "call" ? (
          <form
            key={composer}
            className="history-action-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              data.set("actionType", composer);
              run(() => addJobAction(jobId, data), form);
            }}
          >
            <label className="wide">
              <span>
                {composer === "note"
                  ? he
                    ? "מה חשוב לדעת?"
                    : "What should the team know?"
                  : he
                    ? "מה צריך לעשות?"
                    : "What needs to happen?"}
              </span>
              <input
                name="title"
                required
                maxLength={180}
                placeholder={
                  composer === "note"
                    ? he
                      ? "לדוגמה: הלקוח ביקש להתקשר לפני ההגעה"
                      : "e.g. Customer asked for a call before arrival"
                    : he
                      ? "לדוגמה: לחזור ללקוח עם מחיר"
                      : "e.g. Call back with pricing"
                }
              />
            </label>
            <label className="wide">
              <span>{he ? "פרטים נוספים" : "Details"}</span>
              <textarea
                name="body"
                rows={2}
                placeholder={
                  he
                    ? "אפשר להוסיף הקשר, מספר דגם או סיכום קצר"
                    : "Add context, a model number, or a short summary"
                }
              />
            </label>
            {composer === "follow_up" && (
              <>
                <label>
                  <span>{he ? "עד מתי" : "Due"}</span>
                  <input name="dueAt" type="datetime-local" required />
                </label>
                <label>
                  <span>{he ? "באחריות" : "Assigned to"}</span>
                  <select name="assignedTo">
                    <option value="">{he ? "המשרד" : "Office"}</option>
                    {team.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <button type="submit" disabled={pending}>
              {pending
                ? he
                  ? "שומרים…"
                  : "Saving…"
                : composer === "note"
                  ? he
                    ? "הוספת הערה"
                    : "Add note"
                  : he
                    ? "יצירת משימת המשך"
                    : "Create follow-up"}
            </button>
          </form>
        ) : (
          <form
            className="history-action-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              data.set("jobId", jobId);
              run(() => logCall(data), form);
            }}
          >
            <label>
              <span>{he ? "כיוון" : "Direction"}</span>
              <select
                name="direction"
                value={direction}
                onChange={(event) => setDirection(event.target.value as "inbound" | "outbound")}
              >
                <option value="outbound">{he ? "יוצאת" : "Outbound"}</option>
                <option value="inbound">{he ? "נכנסת" : "Inbound"}</option>
              </select>
            </label>
            <label>
              <span>{he ? "תוצאה" : "Result"}</span>
              <select name="status">
                <option value="completed">{he ? "נענתה" : "Answered"}</option>
                <option value="missed">{he ? "לא נענתה" : "Missed"}</option>
                <option value="voicemail">{he ? "הודעה קולית" : "Voicemail"}</option>
                <option value="failed">{he ? "לא הושלמה" : "Failed"}</option>
              </select>
            </label>
            <label>
              <span>{he ? "מספר הלקוח" : "Customer number"}</span>
              <input
                name={direction === "inbound" ? "fromNumber" : "toNumber"}
                defaultValue={customerPhone}
                required
                inputMode="tel"
              />
            </label>
            <label>
              <span>{he ? "מספר העסק" : "Business number"}</span>
              <input
                name={direction === "inbound" ? "toNumber" : "fromNumber"}
                defaultValue={businessPhone}
                required
                inputMode="tel"
              />
            </label>
            <label>
              <span>{he ? "סיבת השיחה" : "Call reason"}</span>
              <input
                name="reason"
                placeholder={he ? "תיאום, מחיר, עדכון…" : "Scheduling, pricing, update…"}
              />
            </label>
            <label>
              <span>{he ? "מה סוכם" : "Outcome"}</span>
              <select name="outcome">
                <option value="completed">{he ? "טופל" : "Handled"}</option>
                <option value="callback">{he ? "צריך לחזור" : "Callback needed"}</option>
                <option value="booked">{he ? "נקבעה עבודה" : "Job booked"}</option>
                <option value="no_answer">{he ? "אין מענה" : "No answer"}</option>
              </select>
            </label>
            <label>
              <span>{he ? "משך בשניות" : "Duration (seconds)"}</span>
              <input name="durationSeconds" type="number" min="0" defaultValue="0" />
            </label>
            <label className="history-check">
              <input name="needsFollowUp" type="checkbox" />
              <span>{he ? "נדרש מעקב" : "Needs follow-up"}</span>
            </label>
            <label className="wide">
              <span>{he ? "סיכום קצר" : "Short summary"}</span>
              <textarea name="notes" rows={2} />
            </label>
            <button type="submit" disabled={pending}>
              {pending ? (he ? "שומרים…" : "Saving…") : he ? "שמירת השיחה" : "Save call"}
            </button>
          </form>
        )}
        {message && (
          <div className="history-form-message" role="status">
            {message}
          </div>
        )}
      </section>

      <section className="service-pulse">
        <header>
          <div>
            <span>{he ? "היסטוריית העבודה" : "Job history"}</span>
            <h3>{he ? "כל מה שקרה, לפי הסדר" : "Everything that happened, in order"}</h3>
          </div>
          <b>{entries.length}</b>
        </header>
        {entries.length ? (
          <ol>
            {entries.map((entry) => (
              <li key={entry.id} className={`tone-${entry.tone}`}>
                <i aria-hidden="true" />
                <article>
                  <div className="pulse-title">
                    <strong>{entry.title}</strong>
                    {entry.status && <span>{statusLabel(entry.status, he)}</span>}
                  </div>
                  {entry.detail && <p>{entry.detail}</p>}
                  <footer>
                    <span>{entry.actor || (he ? "המערכת" : "System")}</span>
                    <time dateTime={entry.at}>
                      {new Intl.DateTimeFormat(he ? "he-IL" : "en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(entry.at))}
                    </time>
                    {entry.actionId && entry.canComplete && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => completeJobAction(entry.actionId!, jobId))}
                      >
                        {he ? "סימון כהושלם" : "Mark done"}
                      </button>
                    )}
                  </footer>
                </article>
              </li>
            ))}
          </ol>
        ) : (
          <div className="history-empty">
            <span>↻</span>
            <strong>{he ? "ההיסטוריה מתחילה כאן" : "History starts here"}</strong>
            <p>
              {he
                ? "מוסיפים הערה, שיחה או משימת המשך והכול נשמר במקום אחד."
                : "Add a note, call, or follow-up and it stays with the job."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function statusLabel(status: string, he: boolean) {
  const labels: Record<string, [string, string]> = {
    open: ["Open", "פתוח"],
    done: ["Done", "הושלם"],
    follow_up: ["Follow-up", "דורש מעקב"],
    missed: ["Missed", "לא נענתה"],
    voicemail: ["Voicemail", "הודעה קולית"],
    scheduled: ["Scheduled", "נקבע"],
    reported: ["Reported", "דווח"],
    resolved: ["Resolved", "נסגר"],
    denied: ["Denied", "נדחה"],
    active: ["Active", "בתוקף"],
  };
  return labels[status]?.[he ? 1 : 0] ?? status.replaceAll("_", " ");
}
