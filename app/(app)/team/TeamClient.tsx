"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { inviteMember, changeRole, removeMember, cancelInvite, type ActionResult } from "./actions";
import { t, type Locale } from "@/lib/i18n";

type Member = { id: string; full_name: string; role: string };
type Invite = { id: string; email: string; role: string };
const initial: ActionResult = { ok: false };

export default function TeamClient({ locale, members, invites, myId }: {
  locale: Locale; members: Member[]; invites: Invite[]; myId: string;
}) {
  const router = useRouter();
  const [state, formAction] = useFormState(inviteMember, initial);
  const [pending, start] = useTransition();
  const roleLabel = (r: string) => t(locale, r === "owner" ? "role.owner" : r === "office" ? "role.office" : "role.tech");
  const run = (fn: () => Promise<ActionResult>) => start(async () => { await fn(); router.refresh(); });

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
        {state.ok && <div style={ok}>✓ {t(locale, "team.invite_sent")}</div>}
      </div>

      {/* Members */}
      <div style={card}>
        <h3 style={h3}>{t(locale, "team.members")} ({members.length})</h3>
        {members.map((m) => (
          <div key={m.id} style={row}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#2563eb", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13 }}>{(m.full_name || "?").slice(0, 2)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{m.full_name || "—"}{m.id === myId ? ` (${t(locale, "team.you")})` : ""}</b>
            </div>
            <select value={m.role} disabled={m.id === myId || pending} onChange={(e) => run(() => changeRole(m.id, e.target.value))} style={{ ...inp, width: "auto", padding: "7px 10px", fontSize: 13 }}>
              <option value="tech">{roleLabel("tech")}</option>
              <option value="office">{roleLabel("office")}</option>
              <option value="owner">{roleLabel("owner")}</option>
            </select>
            {m.id !== myId && <button onClick={() => { if (confirm("Remove this member?")) run(() => removeMember(m.id)); }} disabled={pending} style={rm}>{t(locale, "team.remove")}</button>}
          </div>
        ))}
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div style={card}>
          <h3 style={h3}>{t(locale, "team.pending")} ({invites.length})</h3>
          {invites.map((iv) => (
            <div key={iv.id} style={row}>
              <div style={{ flex: 1, minWidth: 0 }}><b>{iv.email}</b><div style={{ fontSize: 12, color: "#5c6675" }}>{roleLabel(iv.role)} · {t(locale, "team.invited")}</div></div>
              <button onClick={() => run(() => cancelInvite(iv.id))} disabled={pending} style={rm}>{t(locale, "team.cancelInvite")}</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: "#e0ebff", color: "#1d4ed8", padding: "11px 14px", borderRadius: 12, fontSize: 12.5 }}>
        ℹ️ Invited teammates sign up at your app URL with the invited email — they'll automatically join your business with the role you set. Technicians see only jobs assigned to them.
      </div>
    </div>
  );
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
