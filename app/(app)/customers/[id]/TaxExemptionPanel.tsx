"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { addTaxExemption, setTaxExemptionActive, type TaxExemptionResult } from "./tax-actions";
import type { Locale } from "@/lib/i18n";

export type Exemption = {
  id: string; certificate_number: string | null; reason: string;
  document_url: string | null; expires_on: string | null; active: boolean;
};

const initial: TaxExemptionResult = { ok: false };

/**
 * Sales-tax exemption certificates for one customer (ledger 5.16).
 *
 * `exempt` here is the same test the document pricing runs: active, and either
 * no expiry or an expiry that has not passed. The banner says what it means for
 * money, so nobody has to infer it from a row in a list.
 */
export default function TaxExemptionPanel({ locale, customerId, exemptions, today }:
  { locale: Locale; customerId: string; exemptions: Exemption[]; today: string }) {
  const he = locale === "he";
  const [state, action] = useActionState(addTaxExemption, initial);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const live = (row: Exemption) => row.active && (!row.expires_on || row.expires_on >= today);
  const exempt = exemptions.some(live);
  const day = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString(he ? "he-IL" : "en-US");

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800 }}>{he ? "פטור ממס מכירה" : "Sales tax exemption"}</h3>
        <span className="pill" style={exempt ? { background: "#e6f6ec", color: "#15803d" } : { background: "#eef1f6", color: "#57606f" }}>
          {exempt ? (he ? "פטור פעיל" : "Exempt") : (he ? "חייב במס" : "Taxable")}
        </span>
      </div>
      <p style={{ fontSize: 12.5, color: "#5c6675", margin: "4px 0 10px" }}>
        {exempt
          ? (he ? "מסמכים חדשים ללקוח הזה ייווצרו ללא מס." : "New documents for this customer are raised with no tax.")
          : (he ? "מסמכים חדשים ללקוח הזה ייווצרו עם מס לפי ההגדרות." : "New documents for this customer are taxed at the configured rate.")}
      </p>

      {exemptions.map((row) => (
        <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid #f1f4f9", fontSize: 13 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{row.certificate_number || (he ? "ללא מספר אישור" : "No certificate number")}</b>
            <div style={{ fontSize: 12, color: "#5c6675" }}>
              {row.reason}
              {row.expires_on ? ` · ${row.expires_on < today ? (he ? "פג ב־" : "expired ") : (he ? "בתוקף עד " : "until ")}${day(row.expires_on)}` : ` · ${he ? "ללא תפוגה" : "no expiry"}`}
              {!row.active ? ` · ${he ? "בוטל" : "revoked"}` : ""}
            </div>
          </div>
          {row.document_url && <a href={row.document_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#2563eb", fontWeight: 700 }}>{he ? "מסמך" : "Document"}</a>}
          <button type="button" disabled={pending} style={mini} onClick={() => start(async () => {
            const result = await setTaxExemptionActive(row.id, customerId, !row.active);
            setMessage(result.ok ? (he ? "עודכן" : "Updated") : (result.error || "Error"));
          })}>{row.active ? (he ? "ביטול" : "Revoke") : (he ? "החזרה" : "Restore")}</button>
        </div>
      ))}
      {exemptions.length === 0 && <div style={{ fontSize: 13, color: "#5c6675" }}>{he ? "לא נרשם אישור פטור." : "No exemption certificate on file."}</div>}
      {message && <div style={{ fontSize: 12.5, color: "#2563eb", marginTop: 8 }} role="status">{message}</div>}

      <details style={{ marginTop: 10 }}>
        <summary style={{ fontSize: 13, fontWeight: 700, color: "#2563eb", cursor: "pointer" }}>{he ? "רישום אישור פטור" : "Record an exemption certificate"}</summary>
        <form action={action} style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <input type="hidden" name="customerId" value={customerId} />
          <label style={lbl}>{he ? "סיבה" : "Reason"}<input name="reason" required style={inp} placeholder={he ? "מוסד ללא כוונת רווח" : "Non-profit organisation"} /></label>
          <label style={lbl}>{he ? "מספר אישור" : "Certificate number"}<input name="certificate" style={inp} /></label>
          <label style={lbl}>{he ? "בתוקף עד" : "Expires on"}<input name="expiresOn" type="date" style={inp} /></label>
          <label style={lbl}>{he ? "קישור למסמך" : "Document link"}<input name="documentUrl" type="url" style={inp} /></label>
          <Save he={he} />
          {state.error && <span className="form-error" role="alert">{state.error}</span>}
          {state.ok && <span className="ops-success" role="status">✓ {he ? "נשמר" : "Saved"}</span>}
        </form>
      </details>
    </div>
  );
}

function Save({ he }: { he: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} style={btn}>{pending ? (he ? "שומרים…" : "Saving…") : (he ? "שמירה" : "Save")}</button>;
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, marginBottom: 16 };
const btn: React.CSSProperties = { background: "#2b66f6", color: "#fff", border: "none", padding: "9px 15px", borderRadius: 10, fontWeight: 700, cursor: "pointer", justifySelf: "start" };
const mini: React.CSSProperties = { background: "#eef2f8", border: "none", borderRadius: 8, padding: "5px 9px", cursor: "pointer", fontSize: 12, fontWeight: 700 };
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#334155", display: "grid", gap: 5 };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 11px", fontSize: 14, outline: "none" };
