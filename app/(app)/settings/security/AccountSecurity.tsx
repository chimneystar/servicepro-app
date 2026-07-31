"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/lib/i18n";
// @ts-ignore -- the SAME rule the server enforces
import { MIN_LENGTH } from "@/lib/core/password-policy.mjs";
// @ts-ignore -- pure logic, proven both ways in tests/request-context.test.mjs
import { deviceLabel } from "@/lib/core/request-context.mjs";
import { changePassword, recordTwoFactorChange, setLoginAlerts, signOutEverywhere, type SecurityResult } from "./actions";

type SecurityRow = {
  login_alerts_enabled: boolean;
  mfa_enrolled_at: string | null;
  mfa_removed_at: string | null;
  sessions_revoked_at: string | null;
  last_password_change_at: string | null;
  last_sign_in_at: string | null;
} | null;

type EventRow = { id: number; event_type: string; ip: string | null; ip_trusted: boolean; device_label: string | null; details: any; at: string };
type Factor = { id: string; status: string; friendly_name?: string | null; created_at?: string };

const initial: SecurityResult = { ok: false };
const listStyle = { margin: "6px 0 0", paddingInlineStart: 18, fontSize: 12, lineHeight: 1.5 } as const;

export default function AccountSecurity({ locale, security, events, role }: { locale: Locale; security: SecurityRow; events: EventRow[]; role: string }) {
  const he = locale === "he";
  const [passwordState, passwordAction, passwordPending] = useActionState(changePassword, initial);

  return (
    <div className="ops-grid" style={{ marginBottom: 16 }}>
      <div style={{ display: "grid", gap: 14 }}>
        <TwoFactor locale={locale} enrolledAt={security?.mfa_enrolled_at ?? null} role={role} />

        <section className="ops-card">
          <header><div><h2>{he ? "שינוי סיסמה" : "Change password"}</h2>
            <p>{he ? `לפחות ${MIN_LENGTH} תווים. הכלל נאכף בשרת, לא בדפדפן.` : `At least ${MIN_LENGTH} characters. The rule is enforced on the server, not in the browser.`}</p></div></header>
          <form action={passwordAction} className="ops-form">
            <label>{he ? "סיסמה נוכחית" : "Current password"}<input name="current" type="password" required autoComplete="current-password" /></label>
            <div className="ops-form-grid">
              <label>{he ? "סיסמה חדשה" : "New password"}<input name="next" type="password" required minLength={MIN_LENGTH} autoComplete="new-password" /></label>
              <label>{he ? "אישור סיסמה" : "Confirm password"}<input name="confirm" type="password" required minLength={MIN_LENGTH} autoComplete="new-password" /></label>
            </div>
            {passwordState.error && (
              <div className="form-error" role="alert">{passwordState.error}
                {passwordState.problems?.length ? <ul style={listStyle}>{passwordState.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}
              </div>
            )}
            {passwordState.ok && passwordState.notice && <span className="ops-success" role="status">✓ {passwordState.notice}</span>}
            <div className="ops-actions"><button type="submit" className="ops-primary" disabled={passwordPending}>{he ? "עדכון סיסמה" : "Change password"}</button></div>
          </form>
        </section>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Devices locale={locale} security={security} events={events} />
      </div>
    </div>
  );
}

/**
 * Two-factor authentication (ledger 6b.5).
 *
 * Supabase has supported MFA for years and the app had never called it once:
 * an owner account controlling payouts and every customer record sat behind a
 * single password. Enrolment and removal are done through the Supabase client
 * itself, so the factor list on screen is always the real one; the server
 * action only mirrors the timestamps into the audit trail.
 *
 * NOT VERIFIED AGAINST A LIVE PROJECT. There is no Supabase instance on this
 * machine, MFA must additionally be enabled in the project's Authentication
 * settings, and if it is not, the panel says so instead of failing silently.
 * That is why ledger item 6b.5 is marked PARTIAL.
 */
function TwoFactor({ locale, enrolledAt, role }: { locale: Locale; enrolledAt: string | null; role: string }) {
  const he = locale === "he";
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [, startLoad] = useTransition();
  const load = () => startLoad(async () => {
    try {
      const { data, error } = await createClient().auth.mfa.listFactors();
      if (error) { setUnavailable(error.message); return; }
      setUnavailable(null);
      setFactors((data?.totp ?? []) as Factor[]);
    } catch (error: any) {
      setUnavailable(String(error?.message ?? error));
    }
  });
  useEffect(load, []);

  const verified = (factors ?? []).filter((factor) => factor.status === "verified");

  async function begin() {
    setBusy(true); setMessage(null);
    try {
      const { data, error } = await createClient().auth.mfa.enroll({ factorType: "totp", friendlyName: `ServicePro ${new Date().toISOString().slice(0, 10)}` });
      if (error) throw error;
      setEnrolling({ id: data.id, qr: (data as any).totp?.qr_code ?? "", secret: (data as any).totp?.secret ?? "" });
    } catch (error: any) {
      setMessage(String(error?.message ?? error));
    } finally { setBusy(false); }
  }

  async function confirm() {
    if (!enrolling) return;
    setBusy(true); setMessage(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolling.id, code: code.replace(/\D/g, "") });
      if (error) throw error;
      await recordTwoFactorChange(true);
      setEnrolling(null); setCode("");
      await load();
      setMessage(he ? "אימות דו-שלבי פעיל." : "Two-factor authentication is on.");
    } catch (error: any) {
      setMessage(String(error?.message ?? error));
    } finally { setBusy(false); }
  }

  async function remove(factorId: string) {
    setBusy(true); setMessage(null);
    try {
      const { error } = await createClient().auth.mfa.unenroll({ factorId });
      if (error) throw error;
      await recordTwoFactorChange(false);
      await load();
      setMessage(he ? "אימות דו-שלבי הוסר. החשבון מוגן בסיסמה בלבד." : "Two-factor removed. This account is protected by a password alone.");
    } catch (error: any) {
      setMessage(String(error?.message ?? error));
    } finally { setBusy(false); }
  }

  return (
    <section className="ops-card">
      <header><div><h2>{he ? "אימות דו-שלבי" : "Two-factor authentication"}</h2>
        <p>{he ? "קוד חד-פעמי מאפליקציית אימות, בנוסף לסיסמה." : "A one-time code from an authenticator app, on top of your password."}</p></div>
        {verified.length > 0 ? <span className="ops-pill">{he ? "פעיל" : "On"}</span> : <span className="ops-pill danger">{he ? "כבוי" : "Off"}</span>}
      </header>
      <div className="ops-card-body" style={{ display: "grid", gap: 10 }}>
        {role === "owner" && verified.length === 0 && (
          <p style={{ margin: 0, fontSize: 12 }}>{he
            ? "החשבון הזה שולט בתשלומים ובכל נתוני הלקוחות. סיסמה בלבד היא לא מספיק."
            : "This account controls payouts and every customer record. A password alone is not enough."}</p>
        )}

        {unavailable && (
          <p className="form-error" role="alert">{he
            ? `אימות דו-שלבי אינו זמין בפרויקט הזה: ${unavailable}. הפעילו אותו בהגדרות האימות של Supabase.`
            : `Two-factor is not available on this project: ${unavailable}. Enable it in the Supabase Authentication settings.`}</p>
        )}

        {verified.map((factor) => (
          <div key={factor.id} className="ops-row" style={{ padding: 0 }}>
            <div><strong>{factor.friendly_name || (he ? "אפליקציית אימות" : "Authenticator app")}</strong>
              <small>{he ? "נוסף" : "Added"} {enrolledAt ? new Date(enrolledAt).toLocaleDateString(he ? "he-IL" : "en-US") : "—"}</small></div>
            <button type="button" className="ops-danger" disabled={busy} onClick={() => remove(factor.id)}>{he ? "הסרה" : "Remove"}</button>
          </div>
        ))}

        {!enrolling && !unavailable && verified.length === 0 && (
          <div className="ops-actions"><button type="button" className="ops-primary" disabled={busy} onClick={begin}>{he ? "הפעלת אימות דו-שלבי" : "Turn on two-factor"}</button></div>
        )}

        {enrolling && (
          <div style={{ display: "grid", gap: 8 }}>
            {enrolling.qr && <img src={enrolling.qr} alt={he ? "קוד QR לאפליקציית האימות" : "Authenticator QR code"} style={{ width: 176, height: 176 }} />}
            <small>{he ? "או הזינו את המפתח ידנית:" : "Or enter this key by hand:"} <code>{enrolling.secret}</code></small>
            <label style={{ display: "grid", gap: 5, fontSize: 11, fontWeight: 800 }}>{he ? "קוד בן שש ספרות" : "Six-digit code"}
              <input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" maxLength={6} style={{ minHeight: 43, padding: "9px 11px", borderRadius: 11, border: "1px solid var(--line)" }} />
            </label>
            <div className="ops-actions">
              <button type="button" className="ops-primary" disabled={busy} onClick={confirm}>{he ? "אישור" : "Confirm"}</button>
              <button type="button" className="ops-secondary" disabled={busy} onClick={() => { setEnrolling(null); setCode(""); }}>{he ? "ביטול" : "Cancel"}</button>
            </div>
          </div>
        )}

        {message && <p className="ops-message" role="status">{message}</p>}
      </div>
    </section>
  );
}

/** Sign-in history, new-device alerts and the global sign-out (ledger 6b.6). */
function Devices({ locale, security, events }: { locale: Locale; security: SecurityRow; events: EventRow[] }) {
  const he = locale === "he";
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const alertsOn = security?.login_alerts_enabled !== false;

  const label = (event: EventRow) => {
    const map: Record<string, [string, string]> = {
      sign_in: ["Signed in", "התחברות"],
      mfa_challenge_required: ["Two-factor requested", "נדרש אימות דו-שלבי"],
      mfa_challenge_passed: ["Two-factor passed", "אימות דו-שלבי עבר"],
      mfa_challenge_failed: ["Two-factor failed", "אימות דו-שלבי נכשל"],
      mfa_enrolled: ["Two-factor turned on", "אימות דו-שלבי הופעל"],
      mfa_removed: ["Two-factor removed", "אימות דו-שלבי הוסר"],
      password_changed: ["Password changed", "הסיסמה שונתה"],
      password_change_refused: ["Password change refused", "שינוי סיסמה נדחה"],
      sessions_revoked: ["All devices signed out", "כל המכשירים נותקו"],
      login_alerts_enabled: ["Login alerts on", "התראות התחברות הופעלו"],
      login_alerts_disabled: ["Login alerts off", "התראות התחברות כובו"],
      login_alert_undelivered: ["New-device alert NOT emailed", "התראת מכשיר חדש לא נשלחה"],
      login_alert_failed: ["New-device alert failed to send", "שליחת התראת מכשיר חדשה נכשלה"],
    };
    const pair = map[event.event_type];
    return pair ? (he ? pair[1] : pair[0]) : event.event_type;
  };

  return (
    <section className="ops-card">
      <header><div><h2>{he ? "מכשירים והתחברויות" : "Devices & sign-ins"}</h2>
        <p>{he ? "מה שהשרת ראה. עד עכשיו הוא לא ראה דבר." : "What the server observed. Until now it observed nothing."}</p></div></header>
      <div className="ops-card-body" style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <input type="checkbox" checked={alertsOn} disabled={pending}
            onChange={(event) => {
              const next = event.target.checked;
              startTransition(async () => { const result = await setLoginAlerts(next); if (result.error) setNotice(result.error); });
            }} />
          <span>{he ? "שלחו לי מייל על התחברות ממכשיר או רשת חדשים" : "Email me when a new device or network signs in"}</span>
        </label>

        <div className="ops-actions">
          <button type="button" className="ops-danger" disabled={pending}
            onClick={() => startTransition(async () => { const result = await signOutEverywhere(); setNotice(result.error ?? result.notice ?? null); })}>
            {he ? "ניתוק כל המכשירים" : "Sign out everywhere"}
          </button>
          <small style={{ color: "var(--muted)" }}>{he ? "כולל המכשיר הזה." : "This device included."}</small>
        </div>
        {notice && <p className="ops-message" role="status">{notice}</p>}
        {security?.sessions_revoked_at && (
          <small style={{ color: "var(--muted)" }}>{he ? "ניתוק אחרון" : "Last revoked"}: {new Date(security.sessions_revoked_at).toLocaleString(he ? "he-IL" : "en-US")}</small>
        )}

        <ul className="ops-list">
          {events.length === 0 && <li className="ops-empty">{he ? "אין רישומים עדיין." : "Nothing recorded yet."}</li>}
          {events.map((event) => (
            <li key={event.id}>
              <div>
                <strong>{label(event)}{event.details?.new_device ? ` · ${he ? "מכשיר חדש" : "new device"}` : ""}</strong>
                <small>
                  {event.device_label || deviceLabel(null)}
                  {event.ip ? ` · ${event.ip}${event.ip_trusted ? "" : ` (${he ? "לא מאומת" : "unverified"})`}` : ` · ${he ? "ללא כתובת" : "no address"}`}
                  {" · "}{new Date(event.at).toLocaleString(he ? "he-IL" : "en-US")}
                </small>
              </div>
            </li>
          ))}
        </ul>

        <p style={{ margin: 0, fontSize: 10.5, color: "var(--muted)" }}>{he
          ? "אלה התחברויות, לא הפעלות חיות. ניתוק מכשיר בודד אינו אפשרי דרך ה-API של Supabase, ולכן הניתוק הוא של כל המכשירים."
          : "These are sign-ins, not live sessions. Supabase's client API cannot revoke one device on its own, so revocation is all-or-nothing."}</p>
      </div>
    </section>
  );
}
