"use client";

import { useId, useState, useTransition } from "react";
import { autoSendDocument } from "@/app/(app)/share-actions";
import Modal from "@/components/Modal";

export type ShareTarget = {
  kind: "estimate" | "invoice";
  number: number;
  token: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  orgName: string;
};

export default function ShareDoc({ target, onClose }: { target: ShareTarget; onClose: () => void }) {
  const link = typeof window !== "undefined" ? `${window.location.origin}/p/${target.token}` : "";
  const label = target.kind === "invoice" ? "invoice" : "estimate";
  const [mode, setMode] = useState<"email" | "text">(target.customerEmail ? "email" : "text");
  const [to, setTo] = useState(target.customerEmail ?? "");
  const [phone, setPhone] = useState(target.customerPhone ?? "");
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const [sent, setSent] = useState<string | null>(null);
  const titleId = useId();

  const subject = `${target.orgName} — ${label} #${target.number}`;
  const body = `Hi ${target.customerName},\n\nPlease review your ${label} #${target.number} from ${target.orgName} here:\n${link}\n\nYou can approve and sign it online. Thank you!`;

  function sendEmail() {
    setSent(null);
    start(async () => {
      const r = await autoSendDocument(target.token, "email", to, window.location.origin);
      if (r.ok) { setSent("✓ Email sent to " + to); return; }
      // fall back to the user's own email app
      window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
  }
  function sendText() {
    setSent(null);
    start(async () => {
      const r = await autoSendDocument(target.token, "text", phone, window.location.origin);
      if (r.ok) { setSent("✓ Text sent to " + phone); return; }
      window.location.href = `sms:${encodeURIComponent(phone)}?&body=${encodeURIComponent(`${target.orgName}: your ${label} #${target.number} — ${link}`)}`;
    });
  }
  function copy() { navigator.clipboard?.writeText(link).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1600); }

  return (
    <Modal onClose={onClose} labelledBy={titleId} width={420}>
      <h3 id={titleId} style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Send {label} #{target.number}</h3>
      <p style={{ color: "#5c6675", fontSize: 13, marginBottom: 14 }}>To {target.customerName}</p>

      <div role="group" aria-label="Send method" style={{ display: "inline-flex", background: "#eef2f8", borderRadius: 10, padding: 3, marginBottom: 14 }}>
        <button type="button" onClick={() => setMode("email")} aria-pressed={mode === "email"} style={{ ...seg, ...(mode === "email" ? segOn : {}) }}><span aria-hidden="true">✉️</span> Email</button>
        <button type="button" onClick={() => setMode("text")} aria-pressed={mode === "text"} style={{ ...seg, ...(mode === "text" ? segOn : {}) }}><span aria-hidden="true">💬</span> Text</button>
      </div>

      {mode === "email" ? (
        <>
          <label style={{ display: "block" }}>
            <span style={lbl}>Send to email</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@email.com" style={inp} />
          </label>
          <button type="button" onClick={sendEmail} disabled={!to || pending} style={{ ...btn, marginTop: 12, width: "100%", opacity: to ? 1 : .5 }}>{pending ? "Sending…" : "✉️ Send email"}</button>
        </>
      ) : (
        <>
          <label style={{ display: "block" }}>
            <span style={lbl}>Send to phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" style={inp} />
          </label>
          <button type="button" onClick={sendText} disabled={!phone || pending} style={{ ...btn, marginTop: 12, width: "100%", opacity: phone ? 1 : .5 }}>{pending ? "Sending…" : "💬 Send text"}</button>
        </>
      )}
      {sent && <div style={{ marginTop: 10, background: "#e6f6ec", color: "#15803d", padding: "9px 12px", borderRadius: 10, fontSize: 13, fontWeight: 700, textAlign: "center" }}>{sent}</div>}

      <div style={{ marginTop: 14, borderTop: "1px solid #eef1f6", paddingTop: 12 }}>
        <div style={{ fontSize: 12, color: "#5c6675", marginBottom: 6 }}>Or copy the link and paste it anywhere:</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input readOnly value={link} style={{ ...inp, fontSize: 12.5, color: "#5c6675" }} aria-label="Shareable link" />
          <button type="button" onClick={copy} style={{ ...btn, background: "#eef2f8", color: "#2563eb", flexShrink: 0 }}>{copied ? "✓ Copied" : "Copy"}</button>
        </div>
      </div>

      <button type="button" onClick={onClose} style={{ ...btn, background: "#e2e9f4", color: "#2563eb", width: "100%", marginTop: 14 }}>Close</button>
      <p style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 10, textAlign: "center" }}>Opens your own email/messages app with everything pre-filled. Automatic 1-click sending comes when you connect an email/SMS provider.</p>
    </Modal>
  );
}

const seg: React.CSSProperties = { border: "none", background: "transparent", padding: "7px 16px", borderRadius: 8, fontWeight: 700, fontSize: 13.5, color: "#5c6675", cursor: "pointer" };
const segOn: React.CSSProperties = { background: "#fff", color: "#0b1524", boxShadow: "0 1px 3px rgba(0,0,0,.12)" };
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", marginBottom: 6 };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 16, outline: "none" };
const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "11px 16px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
