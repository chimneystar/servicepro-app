"use client";

import { useId, useState, useTransition } from "react";
import { autoSendDocument } from "@/app/(app)/share-actions";
import Modal from "@/components/Modal";
import { dirFor, t, type Locale } from "@/lib/i18n";

export type ShareTarget = {
  kind: "estimate" | "invoice";
  number: number;
  token: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  orgName: string;
};

export default function ShareDoc({
  target,
  locale,
  onClose,
}: {
  target: ShareTarget;
  locale: Locale;
  onClose: () => void;
}) {
  const link = typeof window !== "undefined" ? `${window.location.origin}/p/${target.token}` : "";
  const [mode, setMode] = useState<"email" | "text">(target.customerEmail ? "email" : "text");
  const [to, setTo] = useState(target.customerEmail ?? "");
  const [phone, setPhone] = useState(target.customerPhone ?? "");
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  // A send that fails used to say nothing at all: the transition ended, the
  // dialog sat there unchanged, and the user had no way to tell an unsent
  // document from a sent one. Both outcomes of the { ok, error } contract are
  // surfaced here, in the reader's own language.
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const titleId = useId();

  function send(channel: "email" | "text") {
    const recipient = channel === "email" ? to : phone;
    setNotice(null);
    start(async () => {
      const result = await autoSendDocument(
        target.token,
        channel,
        recipient,
        window.location.origin,
        locale,
      );
      if (result.ok) {
        setNotice({
          tone: "success",
          text: t(locale, channel === "email" ? "share.sent_email" : "share.sent_text", {
            target: recipient,
          }),
        });
        return;
      }
      // `configured:false` means no provider is connected at all — a different
      // message from "we tried and it failed", and neither is a silent no-op.
      setNotice({
        tone: "error",
        text: t(locale, result.configured ? "share.failed" : "share.unavailable"),
      });
    });
  }

  function copy() {
    navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId} width={420}>
      <div dir={dirFor(locale)}>
        <h3 id={titleId} style={{ fontSize: "1.125rem", fontWeight: 800, marginBottom: 4 }}>
          {t(locale, `share.title_${target.kind}`, { number: target.number })}
        </h3>
        <p style={{ color: "#5c6675", fontSize: "0.875rem", marginBottom: 14 }}>
          {t(locale, "share.to_customer", { name: target.customerName })}
        </p>

        <div
          role="group"
          aria-label={t(locale, "share.channel_label")}
          style={{
            display: "inline-flex",
            background: "#eef2f8",
            borderRadius: 10,
            padding: 3,
            marginBottom: 14,
          }}
        >
          <button
            type="button"
            onClick={() => {
              setMode("email");
              setNotice(null);
            }}
            aria-pressed={mode === "email"}
            style={{ ...seg, ...(mode === "email" ? segOn : {}) }}
          >
            <span aria-hidden="true">✉️</span> {t(locale, "share.email")}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("text");
              setNotice(null);
            }}
            aria-pressed={mode === "text"}
            style={{ ...seg, ...(mode === "text" ? segOn : {}) }}
          >
            <span aria-hidden="true">💬</span> {t(locale, "share.text")}
          </button>
        </div>

        {mode === "email" ? (
          <>
            <label className="sp-field">
              <span style={lbl}>{t(locale, "share.email_label")}</span>
              <input
                type="email"
                dir="ltr"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="client@example.com"
                autoComplete="email"
                className="sp-input sp-control--lg"
              />
            </label>
            <button
              type="button"
              onClick={() => send("email")}
              disabled={!to || pending}
              style={{ ...btn, marginTop: 12, width: "100%", opacity: to ? 1 : 0.5 }}
            >
              {pending ? t(locale, "share.sending") : t(locale, "share.send_email")}
            </button>
          </>
        ) : (
          <>
            <label className="sp-field">
              <span style={lbl}>{t(locale, "share.phone_label")}</span>
              <input
                type="tel"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 123 4567"
                autoComplete="tel"
                className="sp-input sp-control--lg"
              />
            </label>
            <button
              type="button"
              onClick={() => send("text")}
              disabled={!phone || pending}
              style={{ ...btn, marginTop: 12, width: "100%", opacity: phone ? 1 : 0.5 }}
            >
              {pending ? t(locale, "share.sending") : t(locale, "share.send_text")}
            </button>
          </>
        )}

        {notice && (
          <div
            role="status"
            style={{
              marginTop: 10,
              background: notice.tone === "success" ? "#e6f6ec" : "#fdeaea",
              color: notice.tone === "success" ? "#15803d" : "#dc2626",
              padding: "9px 12px",
              borderRadius: 10,
              fontSize: "0.875rem",
              fontWeight: 700,
              textAlign: "center",
            }}
          >
            {notice.text}
          </div>
        )}

        <div style={{ marginTop: 14, borderTop: "1px solid #eef1f6", paddingTop: 12 }}>
          <div style={{ fontSize: "0.875rem", color: "#5c6675", marginBottom: 6 }}>
            {t(locale, "share.copy_help")}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              readOnly
              dir="ltr"
              value={link}
              style={{ ...inp, fontSize: "0.875rem", color: "#5c6675" }}
              aria-label={t(locale, "share.copy_help")}
            />
            <button
              type="button"
              onClick={copy}
              style={{ ...btn, background: "#eef2f8", color: "#2563eb", flexShrink: 0 }}
            >
              {copied ? `✓ ${t(locale, "share.copied")}` : t(locale, "share.copy")}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{ ...btn, background: "#e2e9f4", color: "#2563eb", width: "100%", marginTop: 14 }}
        >
          {t(locale, "share.close")}
        </button>
        <p style={{ fontSize: "0.875rem", color: "#94a3b8", marginTop: 10, textAlign: "center" }}>
          <span aria-hidden="true">🔒</span> {t(locale, "share.security_note")}
        </p>
      </div>
    </Modal>
  );
}

const seg: React.CSSProperties = {
  minHeight: 44,
  border: "none",
  background: "transparent",
  padding: "7px 16px",
  borderRadius: 8,
  fontWeight: 700,
  fontSize: "0.875rem",
  color: "#5c6675",
  cursor: "pointer",
};
const segOn: React.CSSProperties = {
  background: "#fff",
  color: "#0b1524",
  boxShadow: "0 1px 3px rgba(0,0,0,.12)",
};
const lbl: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 700,
  color: "#334155",
  display: "block",
  marginBottom: 6,
};
const inp: React.CSSProperties = {
  width: "100%",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: "1rem",
  outline: "none",
};
const btn: React.CSSProperties = {
  minHeight: 44,
  background: "#2563eb",
  color: "#fff",
  border: "none",
  padding: "11px 16px",
  borderRadius: 10,
  fontWeight: 700,
  cursor: "pointer",
};
