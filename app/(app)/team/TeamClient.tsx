"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { inviteMember, changeRole, removeMember, cancelInvite, resendInvite, updatePaymentPermissions, updateCapabilities, type ActionResult, type CapabilityValues } from "./actions";
// @ts-ignore -- pure logic, proven both ways in tests/invitations.test.mjs
import { describeInviteDelivery } from "@/lib/core/invitations.mjs";
import { t, type Locale } from "@/lib/i18n";
import { ActionError, useActionStatus } from "@/components/ActionStatus";

type Member = { id: string; full_name: string; role: string };
type Invite = { id: string; email: string; role: string; delivery_status?: string | null; delivery_error?: string | null; sent_at?: string | null };
type PaymentPermission = { profile_id: string; can_confirm_manual_payments: boolean; can_refund_payments: boolean; can_override_ach_holds: boolean };
type CapabilityRow = {
  profile_id: string; can_view_customers: boolean; can_edit_customers: boolean; can_manage_schedule: boolean; can_edit_jobs: boolean;
  can_manage_estimates: boolean; can_manage_invoices: boolean; can_manage_payments: boolean; can_view_reports: boolean;
  can_manage_purchasing: boolean; can_manage_automations: boolean; can_manage_settings: boolean; can_manage_team: boolean;
};
const initial: ActionResult = { ok: false };

export default function TeamClient({ locale, members, invites, paymentPermissions, capabilities, myId }: {
  locale: Locale; members: Member[]; invites: Invite[]; paymentPermissions: PaymentPermission[]; capabilities: CapabilityRow[]; myId: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(inviteMember, initial);
  const he = locale === "he";
  const roleLabel = (r: string) => t(locale, r === "owner" ? "role.owner" : r === "office" ? "role.office" : "role.tech");
  // Role changes, removals and invite cancellations are authorization changes.
  // Discarding the result meant a refused privilege change looked exactly like
  // an applied one — the select snapped back and nobody knew why.
  const { pending, error: runError, run: perform } = useActionStatus(he);
  const run = (fn: () => Promise<ActionResult>) => perform(fn, () => router.refresh());

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Invite */}
      <div style={card}>
        <h3 style={h3}>{t(locale, "team.invite")}</h3>
        <form action={formAction} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 200px" }}>
            <label style={lbl}>{t(locale, "team.email")}</label>
            <input name="email" type="email" required placeholder="tech@email.com" style={inp} />
          </div>
          <div style={{ flex: "0 0 130px" }}>
            <label style={lbl}>{t(locale, "team.role")}</label>
            <select name="role" defaultValue="tech" style={inp}>
              <option value="tech">{roleLabel("tech")}</option>
              <option value="office">{roleLabel("office")}</option>
              <option value="owner">{roleLabel("owner")}</option>
            </select>
          </div>
          <SendBtn locale={locale} />
        </form>
        {state.error && <div style={err}>{state.error}</div>}
        {/* An invitation that was saved but never emailed must not be reported
            as sent — that was the whole defect: no email was ever sent and the
            screen said the invitation had gone out. */}
        {state.ok && !state.notice && <div style={ok}>✓ {t(locale, "team.invite_sent")}</div>}
        {state.ok && state.notice && <div style={warn}>{state.notice}</div>}
      </div>

      {/* Members */}
      <div style={card}>
        <h3 style={h3}>{t(locale, "team.members")} ({members.length})</h3>
        <ActionError error={runError} style={{ marginTop: 0, marginBottom: 8 }} />
        {members.map((m) => {
          const paymentAccess = paymentPermissions.find((entry) => entry.profile_id === m.id);
          const capabilityAccess = capabilities.find((entry) => entry.profile_id === m.id);
          return <div key={m.id} style={{ ...row, alignItems: "flex-start" }}>
              <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#2563eb", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13 }}>{(m.full_name || "?").slice(0, 2)}</div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <b>{m.full_name || "—"}{m.id === myId ? ` (${t(locale, "team.you")})` : ""}</b>
                {m.role !== "owner" && m.id !== myId && <CapabilityEditor locale={locale} memberId={m.id} role={m.role} initial={capabilityAccess} onSaved={() => router.refresh()} />}
                {m.role === "office" && m.id !== myId && <PaymentPermissionEditor locale={locale} memberId={m.id} initial={paymentAccess} onSaved={() => router.refresh()} />}
              </div>
              <select value={m.role} disabled={m.id === myId || pending} onChange={(e) => run(() => changeRole(m.id, e.target.value))} style={{ ...inp, width: "auto", padding: "7px 10px", fontSize: 13 }}>
                <option value="tech">{roleLabel("tech")}</option>
                <option value="office">{roleLabel("office")}</option>
                <option value="owner">{roleLabel("owner")}</option>
              </select>
              {m.id !== myId && <button onClick={() => { if (confirm(he ? "להסיר את העובד מהצוות?" : "Remove this team member?")) run(() => removeMember(m.id)); }} disabled={pending} style={rm}>{t(locale, "team.remove")}</button>}
            </div>;
        })}
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div style={card}>
          <h3 style={h3}>{t(locale, "team.pending")} ({invites.length})</h3>
          {invites.map((iv) => (
            <div key={iv.id} style={row}>
              <div style={{ flex: 1, minWidth: 0 }}><b>{iv.email}</b><div style={{ fontSize: 12, color: "#5c6675" }}>{roleLabel(iv.role)} · {t(locale, "team.invited")}</div><div style={{ fontSize: 12, color: deliveryColour(describeInviteDelivery(iv, locale).tone) }}>{describeInviteDelivery(iv, locale).text}</div></div>
              <button onClick={() => run(() => resendInvite(iv.id))} disabled={pending} style={rm}>{he ? "שליחה מחדש" : "Resend"}</button>
              <button onClick={() => run(() => cancelInvite(iv.id))} disabled={pending} style={rm}>{t(locale, "team.cancelInvite")}</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: "#e0ebff", color: "#1d4ed8", padding: "11px 14px", borderRadius: 12, fontSize: 12.5 }}>
        {he ? "אנחנו שולחים לעובד מייל עם קישור הצטרפות אישי. ההצטרפות מחייבת גם את הקישור וגם את כתובת האימייל שאליה נשלח — כתובת אימייל לבדה אינה מספיקה. טכנאים רואים רק עבודות ששובצו להם." : "We email the person a personal join link. Joining needs both that link and the email address it was sent to — the email address alone is not enough. Technicians see only jobs assigned to them."}
      </div>
    </div>
  );
}

function CapabilityEditor({ locale, memberId, role, initial, onSaved }: { locale: Locale; memberId: string; role: string; initial?: CapabilityRow; onSaved: () => void }) {
  const he = locale === "he";
  const office = role === "office";
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<CapabilityValues>({
    viewCustomers: initial?.can_view_customers ?? true,
    editCustomers: initial?.can_edit_customers ?? office,
    manageSchedule: initial?.can_manage_schedule ?? office,
    editJobs: initial?.can_edit_jobs ?? true,
    manageEstimates: initial?.can_manage_estimates ?? office,
    manageInvoices: initial?.can_manage_invoices ?? office,
    managePayments: initial?.can_manage_payments ?? office,
    viewReports: initial?.can_view_reports ?? office,
    managePurchasing: initial?.can_manage_purchasing ?? office,
    manageAutomations: initial?.can_manage_automations ?? office,
    manageSettings: initial?.can_manage_settings ?? false,
    manageTeam: initial?.can_manage_team ?? false,
  });
  const [saving, startSaving] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const options: { key: keyof CapabilityValues; en: string; he: string }[] = [
    { key: "viewCustomers", en: "View customers", he: "צפייה בלקוחות" }, { key: "editCustomers", en: "Edit customers", he: "עריכת לקוחות" },
    { key: "manageSchedule", en: "Manage schedule", he: "ניהול לוח הזמנים" }, { key: "editJobs", en: "Update jobs", he: "עדכון עבודות" },
    { key: "manageEstimates", en: "Manage estimates", he: "ניהול הצעות מחיר" }, { key: "manageInvoices", en: "Manage invoices", he: "ניהול חשבוניות" },
    { key: "managePayments", en: "Manage payments", he: "ניהול תשלומים" }, { key: "viewReports", en: "View reports", he: "צפייה בדוחות" },
    { key: "managePurchasing", en: "Purchasing and vendors", he: "רכש וספקים" }, { key: "manageAutomations", en: "Manage automations", he: "ניהול אוטומציות" },
    { key: "manageSettings", en: "Business settings", he: "הגדרות העסק" }, { key: "manageTeam", en: "Team and permissions", he: "צוות והרשאות" },
  ];
  return <div className="team-capability-editor">
    <button type="button" className="team-capability-toggle" onClick={() => setOpen((current) => !current)} aria-expanded={open}>{he ? "הרשאות באפליקציה" : "App access"}<span>{open ? "−" : "+"}</span></button>
    {open && <div className="team-capability-panel">
      <p>{he ? "בחרו בדיוק מה העובד יכול לראות ולעשות." : "Choose exactly what this team member can see and do."}</p>
      <div className="team-capability-grid">{options.map((option) => <label key={option.key}><input type="checkbox" checked={values[option.key]} onChange={(event) => { setValues((current) => ({ ...current, [option.key]: event.target.checked })); setMessage(null); }} /><span>{he ? option.he : option.en}</span></label>)}</div>
      <button type="button" className="team-capability-save" disabled={saving} onClick={() => startSaving(async () => { const result = await updateCapabilities(memberId, values); setMessage(result.ok ? (he ? "ההרשאות נשמרו" : "Access saved") : (result.error ?? (he ? "לא הצלחנו לשמור" : "Couldn't save"))); if (result.ok) onSaved(); })}>{saving ? (he ? "שומרים…" : "Saving…") : (he ? "שמירת הרשאות" : "Save access")}</button>
      {message && <small>{message}</small>}
    </div>}
  </div>;
}

function PaymentPermissionEditor({ locale, memberId, initial, onSaved }: { locale: Locale; memberId: string; initial?: PaymentPermission; onSaved: () => void }) {
  const he = locale === "he";
  const [values, setValues] = useState({
    confirmManual: !!initial?.can_confirm_manual_payments,
    refund: !!initial?.can_refund_payments,
    overrideAchHold: !!initial?.can_override_ach_holds,
  });
  const [saving, startSaving] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const options = [
    { key: "confirmManual" as const, label: he ? "אישור Zelle וצ׳קים" : "Confirm Zelle & checks" },
    { key: "refund" as const, label: he ? "ביצוע החזרים" : "Issue refunds" },
    { key: "overrideAchHold" as const, label: he ? "שחרור עבודת ACH בהמתנה" : "Override ACH holds" },
  ];
  return <div className="team-payment-permissions">
    <span>{he ? "הרשאות תשלום" : "Payment permissions"}</span>
    <div>{options.map((option) => <label key={option.key}><input type="checkbox" checked={values[option.key]} onChange={(event) => { setValues((current) => ({ ...current, [option.key]: event.target.checked })); setMessage(null); }} />{option.label}</label>)}</div>
    <button type="button" disabled={saving} onClick={() => startSaving(async () => { const result = await updatePaymentPermissions(memberId, values); setMessage(result.ok ? (he ? "נשמר" : "Saved") : (result.error ?? (he ? "לא נשמר" : "Not saved"))); if (result.ok) onSaved(); })}>{saving ? (he ? "שומרים…" : "Saving…") : (he ? "שמירת הרשאות" : "Save access")}</button>
    {message && <small>{message}</small>}
  </div>;
}

function SendBtn({ locale }: { locale: Locale }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} style={{ ...btn, flex: "0 0 auto" }}>{pending ? t(locale, "common.saving") : `➕ ${t(locale, "team.send")}`}</button>;
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18, marginBottom: 16, boxShadow: "0 6px 18px rgba(15,42,94,.06)" };
const h3: React.CSSProperties = { fontSize: 15, fontWeight: 800, marginBottom: 12 };
const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid #f1f4f9", flexWrap: "wrap" };
const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 5 };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none", background: "#fff" };
const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "10px 16px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const rm: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", border: "none", padding: "7px 12px", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: "pointer" };
const err: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "9px 12px", borderRadius: 10, fontSize: 13, marginTop: 10 };
const ok: React.CSSProperties = { background: "#e6f6ec", color: "#15803d", padding: "9px 12px", borderRadius: 10, fontSize: 13, marginTop: 10 };
const warn: React.CSSProperties = { background: "#fff5e0", color: "#a15c07", padding: "9px 12px", borderRadius: 10, fontSize: 13, marginTop: 10 };
const deliveryColour = (tone: string) => tone === "ok" ? "#15803d" : tone === "error" ? "#dc2626" : "#a15c07";
