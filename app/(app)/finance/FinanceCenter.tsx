"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import {
  createDispute,
  createSettlement,
  createTaxFiling,
  createTaxJurisdiction,
  setTaxJurisdictionActive,
  setTaxMode,
  updateDispute,
  updateSettlementStatus,
  type FinanceResult,
} from "./actions";
import type { Locale } from "@/lib/i18n";

type TaxRule = {
  id: string;
  name: string;
  code: string | null;
  jurisdiction_type: string;
  rate_bps: number;
  applies_to: string;
  active: boolean;
  effective_from: string;
  effective_to?: string | null;
};
export type TaxSetup = {
  mode: "flat" | "jurisdictions";
  today: string;
  effectiveBps: number;
  appliedCount: number;
  skipped: { id: string | null; name: string; rateBps: number; reason: string }[];
};
type Filing = {
  id: string;
  period_start: string;
  period_end: string;
  due_on: string | null;
  taxable_sales_minor: number;
  tax_collected_minor: number;
  tax_remitted_minor: number;
  status: string;
  confirmation_reference: string | null;
};
type Settlement = {
  id: string;
  provider: string;
  provider_settlement_id: string | null;
  settlement_date: string;
  expected_arrival: string | null;
  gross_minor: number;
  fees_minor: number;
  refunds_minor: number;
  chargebacks_minor: number;
  adjustments_minor: number;
  net_minor: number;
  status: string;
  bank_reference: string | null;
};
type Dispute = {
  id: string;
  provider: string;
  provider_dispute_id: string | null;
  reason: string;
  disputed_minor: number;
  status: string;
  opened_at: string;
  response_due_at: string | null;
  evidence_notes: string | null;
  payments?: { provider_transaction_id: string | null; invoice_id: string | null } | null;
};
type Payment = {
  id: string;
  provider: string;
  provider_transaction_id: string | null;
  amount_minor: number;
  settled_at: string | null;
};
type Member = { id: string; full_name: string };
const initial: FinanceResult = { ok: false };

export default function FinanceCenter({
  locale,
  currency,
  taxRules,
  taxSetup,
  filings,
  settlements,
  disputes,
  payments,
  members,
}: {
  locale: Locale;
  currency: string;
  taxRules: TaxRule[];
  taxSetup: TaxSetup;
  filings: Filing[];
  settlements: Settlement[];
  disputes: Dispute[];
  payments: Payment[];
  members: Member[];
}) {
  const he = locale === "he";
  const [tab, setTab] = useState<"tax" | "settlements" | "disputes">("tax");
  const openFilings = filings.filter((row) => !["filed", "paid"].includes(row.status));
  const unmatched = settlements.filter((row) => row.status !== "reconciled");
  const urgent = disputes.filter((row) => ["needs_response", "under_review"].includes(row.status));
  const totalNet = settlements
    .filter((row) => row.status === "deposited" || row.status === "reconciled")
    .reduce((sum, row) => sum + Number(row.net_minor), 0);
  const money = (value: number) =>
    new Intl.NumberFormat(he ? "he-IL" : "en-US", { style: "currency", currency }).format(
      Number(value || 0) / 100,
    );
  return (
    <>
      <section className="ops-summary">
        <article className="ops-stat">
          <small>{he ? "הפקדות שנרשמו" : "Recorded deposits"}</small>
          <strong>{money(totalNet)}</strong>
          <span>{he ? "כולל הפקדות שבוצעו והותאמו" : "Deposited and reconciled batches"}</span>
        </article>
        <article className={`ops-stat ${unmatched.length ? "attention" : ""}`}>
          <small>{he ? "דורש התאמה" : "Needs reconciliation"}</small>
          <strong>{unmatched.length}</strong>
          <span>{he ? "הפקדות שעדיין לא נסגרו" : "Settlement batches still open"}</span>
        </article>
        <article className={`ops-stat ${urgent.length ? "attention" : ""}`}>
          <small>{he ? "מחלוקות פתוחות" : "Open disputes"}</small>
          <strong>{urgent.length}</strong>
          <span>{he ? "צריך לענות בזמן" : "Responses need attention"}</span>
        </article>
        <article className="ops-stat">
          <small>{he ? "תקופות מס פתוחות" : "Open tax periods"}</small>
          <strong>{openFilings.length}</strong>
          <span>
            {he ? "מעקב בלבד — לא הגשה אוטומטית" : "Tracking only — not automatic filing"}
          </span>
        </article>
      </section>
      <nav className="ops-tabs" aria-label={he ? "אזורי כספים" : "Finance sections"}>
        <button
          type="button"
          className={tab === "tax" ? "active" : ""}
          onClick={() => setTab("tax")}
        >
          {he ? "מסים ודיווח" : "Tax & filing"}
        </button>
        <button
          type="button"
          className={tab === "settlements" ? "active" : ""}
          onClick={() => setTab("settlements")}
        >
          {he ? "הפקדות והתאמות" : "Settlements"}
        </button>
        <button
          type="button"
          className={tab === "disputes" ? "active" : ""}
          onClick={() => setTab("disputes")}
        >
          {he ? "החזרים ומחלוקות" : "Chargebacks & disputes"}
        </button>
      </nav>
      {tab === "tax" && (
        <TaxPanel
          he={he}
          currency={currency}
          rules={taxRules}
          setup={taxSetup}
          filings={filings}
          money={money}
        />
      )}
      {tab === "settlements" && <SettlementPanel he={he} rows={settlements} money={money} />}
      {tab === "disputes" && (
        <DisputePanel he={he} rows={disputes} payments={payments} members={members} money={money} />
      )}
    </>
  );
}

const pct = (bps: number) => `${(bps / 100).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;
const skipReason = (reason: string, he: boolean) =>
  ({
    inactive: he ? "כובה ידנית" : "switched off",
    not_yet_effective: he ? "עדיין לא בתוקף" : "not yet effective",
    expired: he ? "פג תוקף" : "expired",
    unsupported_scope: he
      ? "חל על עבודה/חומרים בלבד — לא נתמך"
      : "scoped to labour/materials — not supported",
  })[reason] ?? reason;

/**
 * How documents are actually taxed.
 *
 * This screen used to imply jurisdictional tax handling the product did not do:
 * the rules were stored and listed and nothing ever read them, while every
 * document was priced with the single flat organisation rate. The card below
 * states which of the two is in force, what today's combined rate resolves to,
 * and — crucially — names every rule that is NOT being charged and why.
 */
function TaxSetupCard({ he, setup }: { he: boolean; setup: TaxSetup }) {
  const [state, action] = useActionState(setTaxMode, initial);
  const on = setup.mode === "jurisdictions";
  return (
    <div className="ops-card">
      <header>
        <div>
          <h2>{he ? "איך מחושב המס במסמכים" : "How documents are taxed"}</h2>
          <p>
            {he
              ? "זה החישוב שרץ בפועל על כל הצעת מחיר וחשבונית"
              : "This is the calculation that actually runs on every estimate and invoice"}
          </p>
        </div>
        <span className={`ops-pill ${on ? "" : "warn"}`}>
          {on ? (he ? "לפי אזורי מס" : "By jurisdiction") : he ? "שיעור אחיד" : "Flat rate"}
        </span>
      </header>
      <ul className="ops-list">
        <li>
          <div>
            <strong>
              {on
                ? he
                  ? "שיעור משולב היום"
                  : "Combined rate today"
                : he
                  ? "שיעור אחיד מההגדרות"
                  : "Flat rate from Settings"}
            </strong>
            <small>
              {on
                ? `${setup.appliedCount} ${he ? "כללים בתוקף" : "rules in force"} · ${setup.today}`
                : he
                  ? "נקבע במסך ההגדרות של העסק"
                  : "Set on the business Settings screen"}
            </small>
          </div>
          <span className="ops-pill">
            {on ? pct(setup.effectiveBps) : he ? "ראו הגדרות" : "See Settings"}
          </span>
        </li>
        {on &&
          setup.skipped.map((row, index) => (
            <li key={row.id ?? index}>
              <div>
                <strong>{row.name || (he ? "כלל ללא שם" : "Unnamed rule")}</strong>
                <small>
                  {he ? "לא נגבה" : "not charged"} — {skipReason(row.reason, he)}
                </small>
              </div>
              <span className="ops-pill warn">{pct(row.rateBps)}</span>
            </li>
          ))}
      </ul>
      {on && setup.skipped.some((row) => row.reason === "unsupported_scope") && (
        <div className="ops-message" role="status">
          {he
            ? "כלל שחל על עבודה או חומרים בלבד אינו נגבה: שורות במסמך מסומנות כחייבות במס או פטורות, ואין שדה שמסווג שורה כעבודה או כחומרים. הכלל מוצג ולא מיושם — לא מיושם על הכול."
            : "A rule scoped to labour or materials is not charged. Document line items carry a taxable flag and nothing else — no field classifies a line as labour or materials — so its base cannot be identified. It is listed, not silently applied to everything."}
        </div>
      )}
      <form action={action} className="ops-form">
        <input type="hidden" name="mode" value={on ? "flat" : "jurisdictions"} />
        <p style={{ fontSize: "0.8125rem", color: "#5c6675", margin: "6px 0" }}>
          {on
            ? he
              ? "מעבר לשיעור אחיד יחזיר את החישוב לשיעור היחיד שבהגדרות. מסמכים קיימים לא משתנים."
              : "Switching back to the flat rate returns pricing to the single rate in Settings. Existing documents are not changed."
            : he
              ? "הפעלה תגרום למסמכים חדשים להשתמש בסכום שיעורי האזורים שבתוקף במקום בשיעור האחיד. מסמכים קיימים לא משתנים."
              : "Turning this on makes NEW documents use the sum of the jurisdiction rates in force instead of the flat rate. Existing documents are not changed."}
        </p>
        <ActionRow state={state} he={he} />
      </form>
    </div>
  );
}

function TaxPanel({
  he,
  rules,
  setup,
  filings,
  money,
}: {
  he: boolean;
  currency: string;
  rules: TaxRule[];
  setup: TaxSetup;
  filings: Filing[];
  money: (n: number) => string;
}) {
  const [ruleState, ruleAction] = useActionState(createTaxJurisdiction, initial);
  const [filingState, filingAction] = useActionState(createTaxFiling, initial);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  return (
    <div className="ops-grid">
      <TaxSetupCard he={he} setup={setup} />
      <div className="ops-card">
        <header>
          <div>
            <h2>{he ? "כללי המס" : "Tax rules"}</h2>
            <p>
              {he ? "שיעורים לפי אזור ותקופת תוקף" : "Rates by jurisdiction and effective date"}
            </p>
          </div>
          <span className="ops-pill">{rules.length}</span>
        </header>
        {rules.length ? (
          <ul className="ops-list">
            {rules.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>
                    {row.name}
                    {row.code ? ` · ${row.code}` : ""}
                  </strong>
                  <small>
                    {label(row.jurisdiction_type, he)} · {label(row.applies_to, he)} ·{" "}
                    {new Date(`${row.effective_from}T12:00:00`).toLocaleDateString(
                      he ? "he-IL" : "en-US",
                    )}
                    {row.effective_to
                      ? ` → ${new Date(`${row.effective_to}T12:00:00`).toLocaleDateString(he ? "he-IL" : "en-US")}`
                      : ""}
                  </small>
                </div>
                <div className="ops-inline">
                  <span className={`ops-pill ${row.active ? "" : "warn"}`}>
                    {pct(row.rate_bps)}
                  </span>
                  <button
                    type="button"
                    className="ops-secondary"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const result = await setTaxJurisdictionActive(row.id, !row.active);
                        setMessage(
                          result.ok
                            ? he
                              ? "הכלל עודכן"
                              : "Rule updated"
                            : result.error || "Error",
                        );
                      })
                    }
                  >
                    {row.active ? (he ? "כיבוי" : "Switch off") : he ? "הפעלה" : "Switch on"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="ops-empty">
            {he ? "עדיין לא הוגדרו כללי מס." : "No tax rules have been added yet."}
          </div>
        )}
        {message && (
          <div className="ops-message" role="status">
            {message}
          </div>
        )}
        <details className="ops-details">
          <summary>{he ? "הוספת כלל מס" : "Add tax rule"}</summary>
          <form action={ruleAction} className="ops-form">
            <div className="ops-form-grid">
              <Field name="name" label={he ? "שם האזור" : "Jurisdiction name"} required />
              <Field name="code" label={he ? "קוד" : "Code"} />
              <Select
                name="type"
                label={he ? "סוג אזור" : "Type"}
                options={[
                  ["state", he ? "מדינה" : "State"],
                  ["county", he ? "מחוז" : "County"],
                  ["city", he ? "עיר" : "City"],
                  ["district", he ? "אזור מיוחד" : "District"],
                  ["other", he ? "אחר" : "Other"],
                ]}
              />
              <Field
                name="rate"
                label={he ? "שיעור מס (%)" : "Tax rate (%)"}
                type="number"
                step="0.001"
                min="0"
                required
              />
              <Select
                name="appliesTo"
                label={he ? "חל על" : "Applies to"}
                options={[
                  ["all", he ? "הכול" : "Everything"],
                  ["labor", he ? "עבודה" : "Labor"],
                  ["materials", he ? "חומרים" : "Materials"],
                  ["custom", he ? "מותאם" : "Custom"],
                ]}
              />
              <Field
                name="effectiveFrom"
                label={he ? "בתוקף מתאריך" : "Effective from"}
                type="date"
                defaultValue={setup.today}
              />
              <Field
                name="effectiveTo"
                label={he ? "בתוקף עד (לא חובה)" : "Effective to (optional)"}
                type="date"
              />
              <label className="wide">
                {he ? "הערות" : "Notes"}
                <textarea name="notes" />
              </label>
            </div>
            <ActionRow state={ruleState} he={he} />
          </form>
        </details>
      </div>
      <div className="ops-card">
        <header>
          <div>
            <h2>{he ? "תקופות דיווח" : "Filing periods"}</h2>
            <p>
              {he
                ? "מעקב אחרי סכומים, תאריך יעד ואישור"
                : "Amounts, due date and confirmation tracking"}
            </p>
          </div>
        </header>
        {filings.length ? (
          <ul className="ops-list">
            {filings.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>
                    {row.period_start} — {row.period_end}
                  </strong>
                  <small>
                    {he ? "נגבה" : "Collected"}: {money(row.tax_collected_minor)} ·{" "}
                    {he ? "הועבר" : "Remitted"}: {money(row.tax_remitted_minor)}
                    {row.due_on ? ` · ${he ? "עד" : "Due"} ${row.due_on}` : ""}
                  </small>
                </div>
                <span
                  className={`ops-pill ${["overdue", "open"].includes(row.status) ? "warn" : ""}`}
                >
                  {label(row.status, he)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="ops-empty">{he ? "אין עדיין תקופות מס." : "No tax periods yet."}</div>
        )}
        <details className="ops-details">
          <summary>{he ? "פתיחת תקופת מס" : "Add tax period"}</summary>
          <form action={filingAction} className="ops-form">
            <div className="ops-form-grid">
              <Field
                name="periodStart"
                label={he ? "מתאריך" : "Period start"}
                type="date"
                required
              />
              <Field name="periodEnd" label={he ? "עד תאריך" : "Period end"} type="date" required />
              <Field name="dueOn" label={he ? "תאריך יעד" : "Due date"} type="date" />
              <Field
                name="taxableSales"
                label={he ? "מכירות חייבות במס" : "Taxable sales"}
                type="number"
                step="0.01"
                min="0"
              />
              <Field
                name="exemptSales"
                label={he ? "מכירות פטורות" : "Exempt sales"}
                type="number"
                step="0.01"
                min="0"
              />
              <Field
                name="taxCollected"
                label={he ? "מס שנגבה" : "Tax collected"}
                type="number"
                step="0.01"
                min="0"
              />
              <Field
                name="taxRemitted"
                label={he ? "מס שהועבר" : "Tax remitted"}
                type="number"
                step="0.01"
                min="0"
              />
              <Select
                name="status"
                label={he ? "מצב" : "Status"}
                options={[
                  ["open", he ? "פתוח" : "Open"],
                  ["ready", he ? "מוכן" : "Ready"],
                  ["filed", he ? "הוגש" : "Filed"],
                  ["paid", he ? "שולם" : "Paid"],
                  ["overdue", he ? "באיחור" : "Overdue"],
                ]}
              />
              <Field name="reference" label={he ? "אסמכתה" : "Confirmation reference"} />
            </div>
            <ActionRow state={filingState} he={he} />
          </form>
        </details>
      </div>
    </div>
  );
}

function SettlementPanel({
  he,
  rows,
  money,
}: {
  he: boolean;
  rows: Settlement[];
  money: (n: number) => string;
}) {
  const [state, action] = useActionState(createSettlement, initial);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  return (
    <div className="ops-grid">
      <div className="ops-card">
        <header>
          <div>
            <h2>{he ? "יומן הפקדות" : "Settlement ledger"}</h2>
            <p>
              {he
                ? "מה צפוי, מה נכנס ומה עדיין לא תואם"
                : "Expected, deposited and reconciled batches"}
            </p>
          </div>
          <span className="ops-pill">{rows.length}</span>
        </header>
        {rows.length ? (
          <ul className="ops-list">
            {rows.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>
                    {row.provider} · {row.provider_settlement_id || row.settlement_date}
                  </strong>
                  <small>
                    {he ? "ברוטו" : "Gross"} {money(row.gross_minor)} · {he ? "עמלות" : "Fees"}{" "}
                    {money(row.fees_minor)} · {he ? "נטו" : "Net"} {money(row.net_minor)}
                    {row.bank_reference ? ` · ${row.bank_reference}` : ""}
                  </small>
                </div>
                <div className="ops-inline">
                  <select
                    aria-label={he ? "מצב הפקדה" : "Settlement status"}
                    value={row.status}
                    disabled={pending}
                    onChange={(event) =>
                      start(async () => {
                        const result = await updateSettlementStatus(row.id, event.target.value);
                        setMessage(
                          result.ok
                            ? he
                              ? "המצב עודכן"
                              : "Status updated"
                            : result.error || "Error",
                        );
                      })
                    }
                  >
                    {["expected", "in_transit", "deposited", "reconciled", "exception"].map(
                      (value) => (
                        <option value={value} key={value}>
                          {label(value, he)}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="ops-empty">
            {he
              ? "אין עדיין הפקדות. הוסיפו את ההפקדה הראשונה כדי להתחיל התאמה."
              : "No settlements yet. Add the first batch to begin reconciliation."}
          </div>
        )}
        {message && (
          <div className="ops-message" role="status">
            {message}
          </div>
        )}
      </div>
      <div className="ops-card">
        <header>
          <div>
            <h2>{he ? "רישום הפקדה" : "Record settlement"}</h2>
            <p>
              {he
                ? "הנטו מחושב אוטומטית וניתן לתיקון"
                : "Net is calculated automatically and can be adjusted"}
            </p>
          </div>
        </header>
        <form action={action} className="ops-form">
          <div className="ops-form-grid">
            <Field name="provider" label={he ? "ספק תשלום" : "Provider"} defaultValue="manual" />
            <Field name="providerId" label={he ? "מספר הפקדה" : "Settlement ID"} />
            <Field
              name="settlementDate"
              label={he ? "תאריך הפקדה" : "Settlement date"}
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
            />
            <Field name="arrival" label={he ? "הגעה צפויה" : "Expected arrival"} type="date" />
            <Field name="gross" label={he ? "ברוטו" : "Gross"} type="number" step="0.01" />
            <Field name="fees" label={he ? "עמלות" : "Fees"} type="number" step="0.01" />
            <Field name="refunds" label={he ? "החזרים" : "Refunds"} type="number" step="0.01" />
            <Field
              name="chargebacks"
              label={he ? "הכחשות עסקה" : "Chargebacks"}
              type="number"
              step="0.01"
            />
            <Field
              name="adjustments"
              label={he ? "התאמות" : "Adjustments"}
              type="number"
              step="0.01"
            />
            <Field
              name="net"
              label={he ? "נטו (לא חובה)" : "Net (optional)"}
              type="number"
              step="0.01"
            />
            <Field name="bankReference" label={he ? "אסמכתת בנק" : "Bank reference"} />
            <Select
              name="status"
              label={he ? "מצב" : "Status"}
              options={[
                ["expected", label("expected", he)],
                ["in_transit", label("in_transit", he)],
                ["deposited", label("deposited", he)],
                ["reconciled", label("reconciled", he)],
                ["exception", label("exception", he)],
              ]}
            />
            <label className="wide">
              {he ? "הערות" : "Notes"}
              <textarea name="notes" />
            </label>
          </div>
          <ActionRow state={state} he={he} />
        </form>
      </div>
    </div>
  );
}

function DisputePanel({
  he,
  rows,
  payments,
  members,
  money,
}: {
  he: boolean;
  rows: Dispute[];
  payments: Payment[];
  members: Member[];
  money: (n: number) => string;
}) {
  const [state, action] = useActionState(createDispute, initial);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  return (
    <div className="ops-grid">
      <div className="ops-card">
        <header>
          <div>
            <h2>{he ? "תור מחלוקות" : "Dispute queue"}</h2>
            <p>
              {he
                ? "מועד תגובה, ראיות ותוצאה במקום אחד"
                : "Deadlines, evidence and outcomes in one place"}
            </p>
          </div>
          <span
            className={`ops-pill ${rows.some((r) => r.status === "needs_response") ? "warn" : ""}`}
          >
            {rows.length}
          </span>
        </header>
        {rows.length ? (
          <div className="dispute-list">
            {rows.map((row) => (
              <article key={row.id} className="dispute-row">
                <div className="dispute-top">
                  <div>
                    <strong>{row.reason}</strong>
                    <small>
                      {row.provider} ·{" "}
                      {row.provider_dispute_id ||
                        new Date(row.opened_at).toLocaleDateString(he ? "he-IL" : "en-US")}
                    </small>
                  </div>
                  <b>{money(row.disputed_minor)}</b>
                </div>
                <div className="dispute-controls">
                  <select
                    value={row.status}
                    disabled={pending}
                    aria-label={he ? "מצב מחלוקת" : "Dispute status"}
                    onChange={(event) =>
                      start(async () => {
                        const result = await updateDispute(
                          row.id,
                          event.target.value,
                          row.evidence_notes || "",
                        );
                        setMessage(
                          result.ok
                            ? he
                              ? "המחלוקת עודכנה"
                              : "Dispute updated"
                            : result.error || "Error",
                        );
                      })
                    }
                  >
                    {["needs_response", "under_review", "won", "lost", "accepted", "closed"].map(
                      (value) => (
                        <option value={value} key={value}>
                          {label(value, he)}
                        </option>
                      ),
                    )}
                  </select>
                  {row.response_due_at && (
                    <span>
                      {he ? "תגובה עד" : "Respond by"}{" "}
                      {new Date(row.response_due_at).toLocaleDateString(he ? "he-IL" : "en-US")}
                    </span>
                  )}
                </div>
                {row.evidence_notes && <p>{row.evidence_notes}</p>}
              </article>
            ))}
          </div>
        ) : (
          <div className="ops-empty">
            {he ? "אין מחלוקות פתוחות." : "There are no payment disputes."}
          </div>
        )}
        {message && (
          <div className="ops-message" role="status">
            {message}
          </div>
        )}
      </div>
      <div className="ops-card">
        <header>
          <div>
            <h2>{he ? "פתיחת מחלוקת" : "Open dispute"}</h2>
            <p>
              {he
                ? "רשמו את המועד והראיות מהרגע הראשון"
                : "Capture the deadline and evidence from day one"}
            </p>
          </div>
        </header>
        <form action={action} className="ops-form">
          <div className="ops-form-grid">
            <Field name="provider" label={he ? "ספק תשלום" : "Provider"} defaultValue="manual" />
            <Field name="providerId" label={he ? "מספר מחלוקת" : "Dispute ID"} />
            <label>
              {he ? "תשלום קשור" : "Related payment"}
              <select name="paymentId">
                <option value="">{he ? "ללא קישור" : "Not linked"}</option>
                {payments.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.provider} · {p.provider_transaction_id || p.id.slice(0, 8)} ·{" "}
                    {money(p.amount_minor)}
                  </option>
                ))}
              </select>
            </label>
            <Field
              name="amount"
              label={he ? "סכום במחלוקת" : "Disputed amount"}
              type="number"
              step="0.01"
              min="0.01"
              required
            />
            <Field name="reasonCode" label={he ? "קוד סיבה" : "Reason code"} />
            <Field
              name="responseDue"
              label={he ? "מועד אחרון לתגובה" : "Response deadline"}
              type="datetime-local"
            />
            <label>
              {he ? "אחראי" : "Assigned to"}
              <select name="assignedTo">
                <option value="">{he ? "ללא שיוך" : "Unassigned"}</option>
                {members.map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.full_name}
                  </option>
                ))}
              </select>
            </label>
            <Field name="reason" label={he ? "סיבה" : "Reason"} required />
            <label className="wide">
              {he ? "ראיות והערות" : "Evidence notes"}
              <textarea name="evidence" />
            </label>
          </div>
          <ActionRow state={state} he={he} />
        </form>
      </div>
    </div>
  );
}

function ActionRow({ state, he }: { state: FinanceResult; he: boolean }) {
  return (
    <div className="ops-actions">
      <Submit he={he} />
      {state.ok && (
        <span className="ops-success" role="status">
          ✓ {he ? "נשמר" : "Saved"}
        </span>
      )}
      {state.error && (
        <span className="form-error" role="alert">
          {state.error}
        </span>
      )}
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
function Select({
  name,
  label: caption,
  options,
}: {
  name: string;
  label: string;
  options: [string, string][];
}) {
  return (
    <label>
      {caption}
      <select name={name}>
        {options.map(([value, text]) => (
          <option value={value} key={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
function label(value: string, he: boolean) {
  const en: Record<string, string> = {
    state: "State",
    county: "County",
    city: "City",
    district: "District",
    other: "Other",
    all: "All sales",
    labor: "Labor",
    materials: "Materials",
    custom: "Custom",
    open: "Open",
    ready: "Ready",
    filed: "Filed",
    paid: "Paid",
    overdue: "Overdue",
    expected: "Expected",
    in_transit: "In transit",
    deposited: "Deposited",
    reconciled: "Reconciled",
    exception: "Exception",
    needs_response: "Needs response",
    under_review: "Under review",
    won: "Won",
    lost: "Lost",
    accepted: "Accepted",
    closed: "Closed",
  };
  const heb: Record<string, string> = {
    state: "מדינה",
    county: "מחוז",
    city: "עיר",
    district: "אזור מיוחד",
    other: "אחר",
    all: "כל המכירות",
    labor: "עבודה",
    materials: "חומרים",
    custom: "מותאם",
    open: "פתוח",
    ready: "מוכן",
    filed: "הוגש",
    paid: "שולם",
    overdue: "באיחור",
    expected: "צפוי",
    in_transit: "בדרך לבנק",
    deposited: "הופקד",
    reconciled: "הותאם",
    exception: "דורש בדיקה",
    needs_response: "נדרשת תגובה",
    under_review: "בבדיקה",
    won: "התקבל",
    lost: "נדחה",
    accepted: "התקבל כהפסד",
    closed: "נסגר",
  };
  return (he ? heb : en)[value] || value.replaceAll("_", " ");
}
