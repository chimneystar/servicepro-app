import Link from "next/link";
import type { Locale } from "@/lib/i18n";

export type AuditRow = { id: number; table_name: string; row_id: string | null; action: string; actor: string | null; at: string };
export type AuditFilters = { from: string; to: string; table: string; action: string; actor: string; page: number };

type PermissionRow = {
  id: number; subject_profile_id: string | null; actor_profile_id: string | null;
  source_table: string; operation: string; changes: Record<string, { from: unknown; to: unknown }>;
  ip: string | null; at: string;
};
type AttemptRow = { id: number; email_key: string; success: boolean; reason: string | null; ip: string | null; ip_trusted: boolean; device_label: string | null; at: string };
type SignatureRow = {
  id: number; document_type: string; document_id: string | null; signer_name: string | null;
  capture: string; ip: string | null; ip_trusted: boolean; device_label: string | null;
  signature_sha256: string | null; signed_at: string;
};

/** Tables the generic audit trigger actually writes (db/001_schema.sql, db/030). */
const AUDITED_TABLES = ["jobs", "customers", "estimates", "invoices", "payments", "payment_refunds"];
const ACTIONS = ["INSERT", "UPDATE", "DELETE"];

/**
 * The business audit log, finally readable (ledger 6b.4).
 *
 * `audit_log` has been populated by a trigger since the first schema and had a
 * single reader: `loadActivity()`, which shows the last 30 entries for ONE
 * record. Nobody could ask the question that matters after an incident — what
 * changed last week, and who did it — so a correct audit trail was effectively
 * write-only.
 *
 * The filter form is a plain GET form on purpose: the filters live in the URL,
 * so a query can be bookmarked, shared with an accountant, or handed to an
 * insurer, and paging cannot desynchronise from what is on screen.
 */
export default function AuditLog({
  locale, filters, rows, total, pageSize, people, permissionChanges, loginAttempts, signatures,
}: {
  locale: Locale; filters: AuditFilters; rows: AuditRow[]; total: number; pageSize: number;
  people: { id: string; full_name: string }[];
  permissionChanges: PermissionRow[]; loginAttempts: AttemptRow[]; signatures: SignatureRow[];
}) {
  const he = locale === "he";
  const names = new Map(people.map((person) => [person.id, person.full_name]));
  const who = (id: string | null) => (id ? names.get(id) ?? (he ? "משתמש שהוסר" : "removed user") : (he ? "המערכת" : "system"));
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ from: filters.from, to: filters.to, table: filters.table, action: filters.action, actor: filters.actor })) {
      if (value) params.set(key, String(value));
    }
    params.set("page", String(page));
    return `/settings/security?${params.toString()}`;
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <section className="ops-card">
        <header><div><h2>{he ? "מה השתנה בעסק" : "What changed in the business"}</h2>
          <p>{he ? "כל שינוי בעבודות, לקוחות, הצעות, חשבוניות ותשלומים." : "Every change to jobs, customers, estimates, invoices and payments."}</p></div>
          <span className="ops-pill">{total.toLocaleString()}</span>
        </header>

        <form method="get" className="ops-form">
          <div className="ops-form-grid">
            <label>{he ? "מתאריך" : "From"}<input type="date" name="from" defaultValue={filters.from} /></label>
            <label>{he ? "עד תאריך" : "To"}<input type="date" name="to" defaultValue={filters.to} /></label>
            <label>{he ? "רשומה" : "Record type"}
              <select name="table" defaultValue={filters.table}>
                <option value="">{he ? "הכול" : "All"}</option>
                {AUDITED_TABLES.map((table) => <option key={table} value={table}>{table}</option>)}
              </select>
            </label>
            <label>{he ? "פעולה" : "Action"}
              <select name="action" defaultValue={filters.action}>
                <option value="">{he ? "הכול" : "All"}</option>
                {ACTIONS.map((action) => <option key={action} value={action}>{action}</option>)}
              </select>
            </label>
            <label className="wide">{he ? "מי" : "Who"}
              <select name="actor" defaultValue={filters.actor}>
                <option value="">{he ? "כולם" : "Anyone"}</option>
                {people.map((person) => <option key={person.id} value={person.id}>{person.full_name || person.id}</option>)}
              </select>
            </label>
          </div>
          <div className="ops-actions">
            <button type="submit" className="ops-primary">{he ? "סינון" : "Filter"}</button>
            <Link href="/settings/security" className="ops-secondary">{he ? "ניקוי" : "Clear"}</Link>
          </div>
        </form>

        <ul className="ops-list">
          {rows.length === 0 && <li className="ops-empty">{he ? "אין רישומים בטווח הזה." : "Nothing recorded in that range."}</li>}
          {rows.map((row) => (
            <li key={row.id}>
              <div>
                <strong>{verb(row.action, he)} {row.table_name}</strong>
                <small>{who(row.actor)} · {new Date(row.at).toLocaleString()}{row.row_id ? ` · ${row.row_id.slice(0, 8)}` : ""}</small>
              </div>
            </li>
          ))}
        </ul>

        {lastPage > 1 && (
          <div className="ops-actions" style={{ padding: "12px 17px" }}>
            {filters.page > 1 && <Link className="ops-secondary" href={pageHref(filters.page - 1)}>{he ? "הקודם" : "Previous"}</Link>}
            <small>{he ? `עמוד ${filters.page} מתוך ${lastPage}` : `Page ${filters.page} of ${lastPage}`}</small>
            {filters.page < lastPage && <Link className="ops-secondary" href={pageHref(filters.page + 1)}>{he ? "הבא" : "Next"}</Link>}
          </div>
        )}
      </section>

      <section className="ops-card">
        <header><div><h2>{he ? "שינויי הרשאות" : "Permission changes"}</h2>
          <p>{he ? "תפקידים, יכולות והרשאות תשלום — נרשמים במסד הנתונים, לא באפליקציה." : "Roles, capabilities and payment permissions — recorded at the database, not by the app."}</p></div></header>
        <ul className="ops-list">
          {permissionChanges.length === 0 && <li className="ops-empty">{he ? "לא נרשמו שינויי הרשאות." : "No permission changes recorded."}</li>}
          {permissionChanges.map((change) => (
            <li key={change.id}>
              <div>
                <strong>{describeChanges(change.changes, he)}</strong>
                <small>
                  {he ? "על" : "for"} {who(change.subject_profile_id)} · {he ? "על ידי" : "by"} {who(change.actor_profile_id)}
                  {" · "}{change.source_table} {change.operation}
                  {" · "}{new Date(change.at).toLocaleString()}
                  {change.ip ? ` · ${change.ip}` : ` · ${he ? "ללא כתובת (שינוי ישיר במסד)" : "no address (changed outside the app)"}`}
                </small>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="ops-card">
        <header><div><h2>{he ? "ניסיונות התחברות" : "Sign-in attempts"}</h2>
          <p>{he ? "כולל ניסיונות כושלים ולניסיונות נגד כתובות שאינן קיימות." : "Including failures, and attempts against addresses that do not exist."}</p></div></header>
        <ul className="ops-list">
          {loginAttempts.length === 0 && <li className="ops-empty">{he ? "אין ניסיונות רשומים." : "No attempts recorded."}</li>}
          {loginAttempts.map((attempt) => (
            <li key={attempt.id}>
              <div>
                <strong>{attempt.success ? (he ? "הצלחה" : "Success") : (he ? "כישלון" : "Failed")} · {attempt.email_key}</strong>
                <small>
                  {attempt.device_label || (he ? "מכשיר לא ידוע" : "Unknown device")}
                  {attempt.ip ? ` · ${attempt.ip}${attempt.ip_trusted ? "" : ` (${he ? "לא מאומת" : "unverified"})`}` : ""}
                  {attempt.reason ? ` · ${attempt.reason}` : ""}
                  {" · "}{new Date(attempt.at).toLocaleString()}
                </small>
              </div>
              {!attempt.success && <span className="ops-pill danger">!</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="ops-card">
        <header><div><h2>{he ? "ראיות חתימה" : "Signature evidence"}</h2>
          <p>{he ? "מי חתם, מאיפה, ומה בדיוק נשמר." : "Who signed, from where, and a hash of exactly what was stored."}</p></div></header>
        <ul className="ops-list">
          {signatures.length === 0 && <li className="ops-empty">{he ? "לא נחתמו מסמכים עדיין." : "No documents signed yet."}</li>}
          {signatures.map((signature) => (
            <li key={signature.id}>
              <div>
                <strong>{signature.signer_name} · {signature.document_type}</strong>
                <small>
                  {signature.capture === "server"
                    ? `${signature.device_label ?? ""}${signature.ip ? ` · ${signature.ip}${signature.ip_trusted ? "" : ` (${he ? "לא מאומת" : "unverified"})`}` : ""}`
                    : (he ? "ללא הקשר שרת — נחתם ישירות מול מסד הנתונים" : "no server context — signed directly against the database")}
                  {" · "}{new Date(signature.signed_at).toLocaleString()}
                  {signature.signature_sha256 ? ` · sha256 ${signature.signature_sha256.slice(0, 12)}…` : ""}
                </small>
              </div>
              {signature.capture === "server" ? <span className="ops-pill">{he ? "מתועד" : "witnessed"}</span> : <span className="ops-pill warn">{he ? "ללא תיעוד" : "unwitnessed"}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function verb(action: string, he: boolean) {
  if (action === "INSERT") return he ? "נוצר" : "Created";
  if (action === "DELETE") return he ? "נמחק" : "Deleted";
  if (action === "UPDATE") return he ? "עודכן" : "Updated";
  return action;
}

/** "can_refund_payments: off → on" rather than a jsonb blob. */
function describeChanges(changes: Record<string, { from: unknown; to: unknown }> | null, he: boolean) {
  const entries = Object.entries(changes ?? {});
  if (entries.length === 0) return he ? "שינוי" : "Changed";
  return entries
    .map(([field, change]) => `${field}: ${render(change.from, he)} → ${render(change.to, he)}`)
    .join(" · ");
}

function render(value: unknown, he: boolean) {
  if (value === true) return he ? "כן" : "on";
  if (value === false) return he ? "לא" : "off";
  if (value === null || value === undefined) return "—";
  return String(value);
}
