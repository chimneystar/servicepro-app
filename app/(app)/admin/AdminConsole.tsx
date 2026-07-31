"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useEffect } from "react";
import {
  createRelease,
  createSupportCase,
  createSupportSession,
  getKeyStatus,
  openBusinessSnapshot,
  revokeSupportSession,
  rotatePaymentSecretsKey,
  saveFeatureFlag,
  updateReleaseStatus,
  updateSupportCase,
  type AdminResult,
  type BusinessSnapshot,
  type KeyStatus,
} from "./actions";
import type { Locale } from "@/lib/i18n";

type Org = {
  id: string;
  name: string;
  locale: string;
  created_at: string;
  members: number;
  privacyReady: boolean;
  merchantStatus: string;
};
type Case = {
  id: string;
  case_number: number;
  organization_id: string | null;
  subject: string;
  status: string;
  severity: string;
  created_at: string;
  organizations?: { name: string } | null;
};
type Session = {
  id: string;
  case_id: string;
  organization_id: string;
  reason: string;
  access_level: string;
  expires_at: string;
  revoked_at: string | null;
  organizations?: { name: string } | null;
};
type Flag = {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
  rollout_percent: number;
};
type Release = {
  id: string;
  version: string;
  title: string;
  status: string;
  risk_level: string;
  git_sha: string | null;
  deployment_url: string | null;
  regression_checklist: Record<string, boolean>;
  created_at: string;
};
const initial: AdminResult = { ok: false };

export default function AdminConsole({
  locale,
  role,
  organizations,
  cases,
  sessions,
  flags,
  releases,
}: {
  locale: Locale;
  role: string;
  organizations: Org[];
  cases: Case[];
  sessions: Session[];
  flags: Flag[];
  releases: Release[];
}) {
  const he = locale === "he",
    [tab, setTab] = useState<"support" | "releases" | "health" | "keys">("support");
  const activeSessions = sessions.filter(
    (s) => !s.revoked_at && new Date(s.expires_at) > new Date(),
  );
  return (
    <>
      <section className="ops-summary">
        <article className="ops-stat">
          <small>{he ? "עסקים פעילים" : "Businesses"}</small>
          <strong>{organizations.length}</strong>
          <span>{he ? "סביבות עבודה במערכת" : "Workspaces on the platform"}</span>
        </article>
        <article className="ops-stat">
          <small>{he ? "פניות פתוחות" : "Open cases"}</small>
          <strong>{cases.filter((c) => !["resolved", "closed"].includes(c.status)).length}</strong>
          <span>{he ? "דורשות טיפול של התמיכה" : "Need support attention"}</span>
        </article>
        <article className={`ops-stat ${activeSessions.length ? "attention" : ""}`}>
          <small>{he ? "גישות תמיכה פעילות" : "Active support access"}</small>
          <strong>{activeSessions.length}</strong>
          <span>{he ? "גישה מוגבלת בזמן ומתועדת" : "Time-limited and audited"}</span>
        </article>
        <article className="ops-stat">
          <small>{he ? "גרסה חיה" : "Live release"}</small>
          <strong>{releases.find((r) => r.status === "live")?.version || "—"}</strong>
          <span>{he ? `הרשאת מערכת: ${role}` : `Platform role: ${role}`}</span>
        </article>
      </section>
      <nav className="ops-tabs">
        <button
          type="button"
          className={tab === "support" ? "active" : ""}
          onClick={() => setTab("support")}
        >
          {he ? "תמיכה וגישה" : "Support & access"}
        </button>
        <button
          type="button"
          className={tab === "releases" ? "active" : ""}
          onClick={() => setTab("releases")}
        >
          {he ? "גרסאות ותכונות" : "Releases & flags"}
        </button>
        <button
          type="button"
          className={tab === "health" ? "active" : ""}
          onClick={() => setTab("health")}
        >
          {he ? "מצב עסקים" : "Business health"}
        </button>
        <button
          type="button"
          className={tab === "keys" ? "active" : ""}
          onClick={() => setTab("keys")}
        >
          {he ? "מפתחות הצפנה" : "Encryption keys"}
        </button>
      </nav>
      {tab === "support" && (
        <Support he={he} organizations={organizations} cases={cases} sessions={sessions} />
      )}{" "}
      {tab === "releases" && <Releases he={he} role={role} flags={flags} releases={releases} />}{" "}
      {tab === "health" && <Health he={he} rows={organizations} />}{" "}
      {tab === "keys" && <Keys he={he} role={role} />}
    </>
  );
}

/**
 * Encryption-key rotation (ledger 6b.9).
 *
 * The status is fetched on open rather than passed down from the page, because
 * it is derived from server-side environment variables and belongs nowhere
 * near a serialised prop. Nothing here ever handles a decrypted token: the
 * rotation happens entirely inside the server action.
 */
function Keys({ he, role }: { he: boolean; role: string }) {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      const result = await getKeyStatus();
      if (result.ok && result.status) {
        setStatus(result.status);
        setError(null);
      } else {
        setStatus(null);
        setError(result.error ?? null);
      }
    });
  useEffect(load, []);

  return (
    <div className="ops-card">
      <header>
        <div>
          <h2>{he ? "מפתח ההצפנה של אסימוני הסולק" : "Provider token encryption key"}</h2>
          <p>
            {he
              ? "PAYMENT_SECRETS_KEY לא ניתן היה להחלפה: כל אסימון שמור היה הופך לבלתי קריא."
              : "PAYMENT_SECRETS_KEY could not be changed: every stored token would have become unreadable."}
          </p>
        </div>
      </header>
      <div className="ops-card-body" style={{ display: "grid", gap: 10 }}>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {status && (
          <>
            <div>
              <strong>
                {he ? "מפתח פעיל" : "Active key"}: v{status.activeVersion}
              </strong>
              <small style={{ display: "block", color: "var(--muted)" }}>
                {he ? "מפתחות זמינים" : "Keys held"}:{" "}
                {status.heldVersions.length
                  ? status.heldVersions.map((v) => `v${v}`).join(", ")
                  : he
                    ? "אין"
                    : "none"}
              </small>
            </div>
            {status.problems.map((problem) => (
              <p className="form-error" key={problem}>
                {problem}
              </p>
            ))}
            <ul className="ops-list">
              {status.rows.length === 0 && (
                <li className="ops-empty">{he ? "אין אסימונים שמורים." : "No stored tokens."}</li>
              )}
              {status.rows.map((row) => (
                <li key={row.keyVersion}>
                  <div>
                    <strong>v{row.keyVersion}</strong>
                    <small>
                      {row.count} {he ? "רשומות" : "record(s)"}
                    </small>
                  </div>
                  {row.keyVersion === status.activeVersion ? (
                    <span className="ops-pill">{he ? "מעודכן" : "current"}</span>
                  ) : (
                    <span className="ops-pill warn">{he ? "ממתין" : "pending"}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="ops-message">{status.plan}</p>
            {status.lastRun && (
              <small style={{ color: "var(--muted)" }}>
                {he ? "ריצה אחרונה" : "Last run"}: {status.lastRun.status} → v
                {status.lastRun.toVersion} · {status.lastRun.rotated}{" "}
                {he ? "הוצפנו מחדש" : "re-encrypted"} ·{" "}
                {new Date(status.lastRun.at).toLocaleString(he ? "he-IL" : "en-US")}
                {status.lastRun.error ? ` · ${status.lastRun.error}` : ""}
              </small>
            )}
            <div className="ops-actions">
              <button
                type="button"
                className="ops-primary"
                disabled={pending || !status.canRotate || role !== "super_admin"}
                onClick={() =>
                  start(async () => {
                    const result = await rotatePaymentSecretsKey({ ok: false });
                    setMessage(result.error ?? result.summary ?? null);
                    load();
                  })
                }
              >
                {he ? "הרצת רוטציה" : "Run rotation"}
              </button>
              <button type="button" className="ops-secondary" disabled={pending} onClick={load}>
                {he ? "רענון" : "Refresh"}
              </button>
            </div>
            {role !== "super_admin" && (
              <small style={{ color: "var(--muted)" }}>
                {he
                  ? "רק super_admin יכול להריץ רוטציה."
                  : "Only a super_admin can run a rotation."}
              </small>
            )}
            {message && (
              <p className="ops-message" role="status">
                {message}
              </p>
            )}
            <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)" }}>
              {he
                ? "בין הפריסה לסיום הרוטציה, שורה שטרם הוצפנה מחדש אינה קריאה למסלול התשלומים — הוא אינו קורא key_version. זו הסיבה ש-6b.9 מסומן PARTIAL."
                : "Between deploying a new key and finishing the rotation, a not-yet-rotated row cannot be read by the payment path, which does not consult key_version. That window is why ledger 6b.9 is PARTIAL."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Support({
  he,
  organizations,
  cases,
  sessions,
}: {
  he: boolean;
  organizations: Org[];
  cases: Case[];
  sessions: Session[];
}) {
  const [caseState, caseAction] = useActionState(createSupportCase, initial),
    [sessionState, sessionAction] = useActionState(createSupportSession, initial),
    [pending, start] = useTransition(),
    [message, setMessage] = useState("");
  const [snapshot, setSnapshot] = useState<BusinessSnapshot | null>(null);
  // Opening a business is the call the session actually governs. It is refused,
  // with the reason, when the session is revoked, expired or belongs to someone
  // else — which is why the button stays visible on a revoked session: pressing
  // it must demonstrably fail rather than quietly disappear.
  const openBusiness = (row: Session) =>
    start(async () => {
      const result = await openBusinessSnapshot(row.organization_id);
      if (result.ok && result.snapshot) {
        setSnapshot(result.snapshot);
        setMessage(he ? "נפתחה גישה מתועדת לעסק" : "Business opened under an audited session");
      } else {
        setSnapshot(null);
        setMessage(result.error || (he ? "הגישה נדחתה" : "Access refused"));
      }
    });
  return (
    <div className="ops-grid">
      <div>
        <div className="ops-card">
          <header>
            <div>
              <h2>{he ? "פניות תמיכה" : "Support cases"}</h2>
              <p>
                {he
                  ? "כל גישה לעסק חייבת להתחיל מפנייה עם סיבה"
                  : "Every business access starts with a reason-bound case"}
              </p>
            </div>
          </header>
          {cases.length ? (
            <ul className="ops-list">
              {cases.map((row) => (
                <li key={row.id}>
                  <div>
                    <strong>
                      #{row.case_number} · {row.subject}
                    </strong>
                    <small>
                      {row.organizations?.name || (he ? "ללא עסק" : "No business")} ·{" "}
                      {new Date(row.created_at).toLocaleString(he ? "he-IL" : "en-US")} ·{" "}
                      {row.severity}
                    </small>
                  </div>
                  <select
                    value={row.status}
                    disabled={pending}
                    aria-label={he ? "מצב הפנייה" : "Case status"}
                    onChange={(e) =>
                      start(async () => {
                        const result = await updateSupportCase(row.id, e.target.value);
                        setMessage(
                          result.ok
                            ? he
                              ? "הפנייה עודכנה"
                              : "Case updated"
                            : result.error || "Error",
                        );
                      })
                    }
                  >
                    {["open", "investigating", "waiting", "resolved", "closed"].map((v) => (
                      <option value={v} key={v}>
                        {adminLabel(v, he)}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          ) : (
            <div className="ops-empty">{he ? "אין פניות תמיכה." : "No support cases."}</div>
          )}
        </div>
        <div className="ops-card admin-session-card">
          <header>
            <div>
              <h2>{he ? "גישות תמיכה" : "Support access sessions"}</h2>
              <p>
                {he
                  ? "אין התחזות שקטה: לכל גישה יש פנייה, סיבה ותוקף"
                  : "No silent impersonation: every session has a case, reason and expiry"}
              </p>
            </div>
          </header>
          {sessions.length ? (
            <ul className="ops-list">
              {sessions.map((row) => (
                <li key={row.id}>
                  <div>
                    <strong>
                      {row.organizations?.name || row.organization_id} ·{" "}
                      {adminLabel(row.access_level, he)}
                    </strong>
                    <small>
                      {row.reason} · {he ? "עד" : "Until"}{" "}
                      {new Date(row.expires_at).toLocaleString(he ? "he-IL" : "en-US")}
                    </small>
                  </div>
                  <span className="ops-session-actions">
                    <button
                      type="button"
                      className="ops-secondary"
                      disabled={pending}
                      onClick={() => openBusiness(row)}
                    >
                      {he ? "פתיחת העסק" : "Open business"}
                    </button>
                    {row.revoked_at ? (
                      <span className="ops-pill">{he ? "בוטלה" : "Revoked"}</span>
                    ) : (
                      <button
                        type="button"
                        className="ops-danger"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const result = await revokeSupportSession(row.id);
                            setSnapshot(null);
                            setMessage(
                              result.ok
                                ? he
                                  ? "הגישה בוטלה ונפסקה מיידית"
                                  : "Access revoked — it stops working immediately"
                                : result.error || "Error",
                            );
                          })
                        }
                      >
                        {he ? "ביטול גישה" : "Revoke"}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="ops-empty">
              {he ? "לא נפתחו גישות תמיכה." : "No support access has been opened."}
            </div>
          )}
          {message && <div className="ops-message">{message}</div>}
          {snapshot && (
            <div className="ops-snapshot">
              <h3>{snapshot.name}</h3>
              <small>
                {he ? "רמת גישה" : "Access level"}: {adminLabel(snapshot.accessLevel, he)}
                {snapshot.expiresAt
                  ? ` · ${he ? "עד" : "until"} ${new Date(snapshot.expiresAt).toLocaleString(he ? "he-IL" : "en-US")}`
                  : ""}
              </small>
              <div className="admin-snapshot-counts">
                {[
                  [he ? "לקוחות" : "Customers", snapshot.counts.customers],
                  [he ? "עבודות" : "Jobs", snapshot.counts.jobs],
                  [he ? "עבודות פתוחות" : "Open jobs", snapshot.counts.openJobs],
                  [he ? "חשבוניות" : "Invoices", snapshot.counts.invoices],
                  [he ? "לא שולמו" : "Unpaid", snapshot.counts.unpaidInvoices],
                  [he ? "צוות" : "Team", snapshot.counts.team],
                ].map(([label, value]) => (
                  <span key={String(label)}>
                    <b>{value as number}</b>
                    {label as string}
                  </span>
                ))}
              </div>
              <ul className="ops-list">
                {snapshot.recentActivity.map((row, index) => (
                  <li key={index}>
                    <div>
                      <strong>{row.table}</strong>
                      <small>
                        {row.action} · {new Date(row.at).toLocaleString(he ? "he-IL" : "en-US")}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      <div>
        <div className="ops-card">
          <header>
            <div>
              <h2>{he ? "פתיחת פנייה" : "Open support case"}</h2>
            </div>
          </header>
          <form action={caseAction} className="ops-form">
            <label>
              {he ? "עסק" : "Business"}
              <select name="organizationId">
                <option value="">{he ? "ללא עסק" : "No business"}</option>
                {organizations.map((o) => (
                  <option value={o.id} key={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <Field name="subject" label={he ? "נושא" : "Subject"} required />
            <label>
              {he ? "חומרה" : "Severity"}
              <select name="severity">
                {["low", "normal", "high", "critical"].map((v) => (
                  <option value={v} key={v}>
                    {adminLabel(v, he)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {he ? "תיאור" : "Description"}
              <textarea name="description" />
            </label>
            <Action state={caseState} he={he} />
          </form>
        </div>
        <div className="ops-card admin-session-card">
          <header>
            <div>
              <h2>{he ? "פתיחת גישת תמיכה" : "Open support access"}</h2>
            </div>
          </header>
          <form action={sessionAction} className="ops-form">
            <label>
              {he ? "פנייה מקושרת" : "Linked case"}
              <select name="caseId" required>
                <option value="">{he ? "בחירת פנייה" : "Choose a case"}</option>
                {cases
                  .filter((c) => c.organization_id)
                  .map((c) => (
                    <option value={c.id} key={c.id}>
                      #{c.case_number} · {c.subject}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {he ? "רמת גישה" : "Access level"}
              <select name="accessLevel">
                <option value="read_only">{adminLabel("read_only", he)}</option>
                <option value="guided_write">{adminLabel("guided_write", he)}</option>
              </select>
            </label>
            <Field
              name="hours"
              label={he ? "משך בשעות (עד 8)" : "Hours (up to 8)"}
              type="number"
              min="1"
              max="8"
              defaultValue="1"
            />
            <label>
              {he ? "סיבה מפורטת" : "Detailed reason"}
              <textarea name="reason" required />
            </label>
            <Action state={sessionState} he={he} />
          </form>
        </div>
      </div>
    </div>
  );
}

function Releases({
  he,
  role,
  flags,
  releases,
}: {
  he: boolean;
  role: string;
  flags: Flag[];
  releases: Release[];
}) {
  const [flagState, flagAction] = useActionState(saveFeatureFlag, initial),
    [releaseState, releaseAction] = useActionState(createRelease, initial),
    [pending, start] = useTransition(),
    [message, setMessage] = useState("");
  return (
    <div className="ops-grid">
      <div>
        <div className="ops-card">
          <header>
            <div>
              <h2>{he ? "גרסאות מבוקרות" : "Controlled releases"}</h2>
              <p>
                {he
                  ? "אי אפשר לאשר גרסה לפני שכל בדיקות השמירה הושלמו"
                  : "A release cannot advance until every regression check passes"}
              </p>
            </div>
          </header>
          {releases.length ? (
            <div className="release-list">
              {releases.map((row) => (
                <article key={row.id}>
                  <div>
                    <strong>
                      {row.version} · {row.title}
                    </strong>
                    <small>
                      {row.git_sha || "—"} · {adminLabel(row.risk_level, he)} ·{" "}
                      {new Date(row.created_at).toLocaleDateString(he ? "he-IL" : "en-US")}
                    </small>
                  </div>
                  <div className="release-checks">
                    {Object.entries(row.regression_checklist || {}).map(([key, value]) => (
                      <span className={value ? "done" : ""} key={key}>
                        {value ? "✓" : "○"} {key.replaceAll("_", " ")}
                      </span>
                    ))}
                  </div>
                  <select
                    value={row.status}
                    disabled={pending}
                    aria-label={he ? "מצב הגרסה" : "Release status"}
                    onChange={(e) =>
                      start(async () => {
                        const result = await updateReleaseStatus(row.id, e.target.value);
                        setMessage(
                          result.ok
                            ? he
                              ? "הגרסה עודכנה"
                              : "Release updated"
                            : result.error || "Error",
                        );
                      })
                    }
                  >
                    {[
                      "draft",
                      "review",
                      "approved",
                      "rolling_out",
                      "live",
                      "paused",
                      "rolled_back",
                    ].map((v) => (
                      <option value={v} key={v}>
                        {adminLabel(v, he)}
                      </option>
                    ))}
                  </select>
                </article>
              ))}
            </div>
          ) : (
            <div className="ops-empty">{he ? "אין גרסאות רשומות." : "No releases recorded."}</div>
          )}
          {message && <div className="ops-message">{message}</div>}
        </div>
        <div className="ops-card admin-session-card">
          <header>
            <div>
              <h2>{he ? "דגלי תכונות" : "Feature flags"}</h2>
            </div>
          </header>
          <ul className="ops-list">
            {flags.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>{row.key}</strong>
                  <small>
                    {row.description || "—"} · {row.rollout_percent}%
                  </small>
                </div>
                <span className={`ops-pill ${row.enabled ? "" : "warn"}`}>
                  {row.enabled ? (he ? "פעיל" : "On") : he ? "כבוי" : "Off"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div>
        <div className="ops-card">
          <header>
            <div>
              <h2>{he ? "רישום גרסה" : "Register release"}</h2>
            </div>
          </header>
          <form action={releaseAction} className="ops-form">
            <Field name="version" label={he ? "גרסה" : "Version"} required />
            <Field name="title" label={he ? "כותרת" : "Title"} required />
            <Field name="gitSha" label="Git SHA" />
            <Field name="deploymentUrl" label={he ? "קישור לפריסה" : "Deployment URL"} type="url" />
            <label>
              {he ? "רמת סיכון" : "Risk"}
              <select name="risk">
                <option value="low">{adminLabel("low", he)}</option>
                <option value="standard">{adminLabel("standard", he)}</option>
                <option value="high">{adminLabel("high", he)}</option>
              </select>
            </label>
            <label>
              {he ? "סיכום" : "Summary"}
              <textarea name="summary" />
            </label>
            {[
              ["featuresPreserved", he ? "כל התכונות נשמרו" : "All features preserved"],
              ["bilingualChecked", he ? "אנגלית ועברית נבדקו" : "English and Hebrew checked"],
              ["rolesChecked", he ? "כל התפקידים נבדקו" : "All roles checked"],
              ["databaseChecked", he ? "מסד הנתונים נבדק" : "Database checked"],
            ].map(([name, text]) => (
              <label className="admin-check" key={name}>
                <input type="checkbox" name={name} />
                {text}
              </label>
            ))}
            <Action state={releaseState} he={he} />
          </form>
        </div>
        {["operations", "super_admin"].includes(role) && (
          <div className="ops-card admin-session-card">
            <header>
              <div>
                <h2>{he ? "הוספת דגל תכונה" : "Add feature flag"}</h2>
              </div>
            </header>
            <form action={flagAction} className="ops-form">
              <Field name="key" label={he ? "מפתח" : "Key"} required />
              <Field name="description" label={he ? "תיאור" : "Description"} />
              <Field
                name="rollout"
                label={he ? "אחוז חשיפה" : "Rollout percent"}
                type="number"
                min="0"
                max="100"
                defaultValue="0"
              />
              <label className="admin-check">
                <input type="checkbox" name="enabled" />
                {he ? "פעיל" : "Enabled"}
              </label>
              <Action state={flagState} he={he} />
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function Health({ he, rows }: { he: boolean; rows: Org[] }) {
  return (
    <div className="ops-card">
      <header>
        <div>
          <h2>{he ? "מצב עסקים" : "Business health"}</h2>
          <p>
            {he
              ? "תמונת מצב תפעולית ללא כניסה לחשבון הלקוח"
              : "Operational overview without entering a customer's account"}
          </p>
        </div>
      </header>
      <div className="admin-health">
        <div className="admin-health-head">
          <span>{he ? "עסק" : "Business"}</span>
          <span>{he ? "צוות" : "Team"}</span>
          <span>{he ? "פרטיות" : "Privacy"}</span>
          <span>{he ? "תשלומים" : "Payments"}</span>
        </div>
        {rows.map((row) => (
          <article key={row.id}>
            <div>
              <strong>{row.name}</strong>
              <small>
                {row.locale.toUpperCase()} ·{" "}
                {new Date(row.created_at).toLocaleDateString(he ? "he-IL" : "en-US")}
              </small>
            </div>
            <b>{row.members}</b>
            <span className={`ops-pill ${row.privacyReady ? "" : "warn"}`}>
              {row.privacyReady ? (he ? "מוגדר" : "Ready") : he ? "דורש הגדרה" : "Setup"}
            </span>
            <span className="ops-pill">{row.merchantStatus}</span>
          </article>
        ))}
      </div>
    </div>
  );
}

function Action({ state, he }: { state: AdminResult; he: boolean }) {
  return (
    <div className="ops-actions">
      <Submit he={he} />
      {state.ok && <span className="ops-success">✓ {he ? "נשמר" : "Saved"}</span>}
      {state.error && <span className="form-error">{state.error}</span>}
    </div>
  );
}
function Submit({ he }: { he: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="ops-primary" disabled={pending}>
      {pending ? (he ? "שומרים…" : "Saving…") : he ? "שמירה" : "Save"}
    </button>
  );
}
function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <label>
      {label}
      <input {...rest} />
    </label>
  );
}
function adminLabel(v: string, he: boolean) {
  const en: Record<string, string> = {
    open: "Open",
    investigating: "Investigating",
    waiting: "Waiting",
    resolved: "Resolved",
    closed: "Closed",
    low: "Low",
    normal: "Normal",
    high: "High",
    critical: "Critical",
    read_only: "Read only",
    guided_write: "Guided write",
    draft: "Draft",
    review: "Review",
    approved: "Approved",
    rolling_out: "Rolling out",
    live: "Live",
    paused: "Paused",
    rolled_back: "Rolled back",
    standard: "Standard",
  };
  const heb: Record<string, string> = {
    open: "פתוחה",
    investigating: "בבדיקה",
    waiting: "ממתינה",
    resolved: "נפתרה",
    closed: "נסגרה",
    low: "נמוכה",
    normal: "רגילה",
    high: "גבוהה",
    critical: "קריטית",
    read_only: "קריאה בלבד",
    guided_write: "כתיבה בליווי",
    draft: "טיוטה",
    review: "בבדיקה",
    approved: "מאושרת",
    rolling_out: "בפריסה",
    live: "חיה",
    paused: "מושהית",
    rolled_back: "הוחזרה",
    standard: "רגילה",
  };
  return (he ? heb : en)[v] || v;
}
