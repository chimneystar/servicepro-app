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
    <Modal onClose={onClose} labelledBy={titleId} width={460} className="share-dialog">
      <div dir={dirFor(locale)}>
        <header className="share-dialog-heading">
          <div>
            <h2 id={titleId}>
              {t(locale, `share.title_${target.kind}`, { number: target.number })}
            </h2>
            <p>{t(locale, "share.to_customer", { name: target.customerName })}</p>
          </div>
          <button
            type="button"
            className="share-dialog-dismiss"
            onClick={onClose}
            aria-label={t(locale, "share.close")}
          >
            ×
          </button>
        </header>

        <div
          className="share-channel-tabs"
          role="tablist"
          aria-label={t(locale, "share.channel_label")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "email"}
            onClick={() => {
              setMode("email");
              setNotice(null);
            }}
          >
            <span aria-hidden="true">✉</span>
            {t(locale, "share.email")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "text"}
            onClick={() => {
              setMode("text");
              setNotice(null);
            }}
          >
            <span aria-hidden="true">●</span>
            {t(locale, "share.text")}
          </button>
        </div>

        <div className="share-channel-panel" role="tabpanel">
          {mode === "email" ? (
            <>
              <label htmlFor="share-customer-email">{t(locale, "share.email_label")}</label>
              <input
                id="share-customer-email"
                type="email"
                dir="ltr"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="client@example.com"
                autoComplete="email"
              />
              <button
                type="button"
                className="share-primary"
                onClick={() => send("email")}
                disabled={!to || pending}
              >
                {pending ? t(locale, "share.sending") : t(locale, "share.send_email")}
              </button>
            </>
          ) : (
            <>
              <label htmlFor="share-customer-phone">{t(locale, "share.phone_label")}</label>
              <input
                id="share-customer-phone"
                type="tel"
                dir="ltr"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+1 555 123 4567"
                autoComplete="tel"
              />
              <button
                type="button"
                className="share-primary"
                onClick={() => send("text")}
                disabled={!phone || pending}
              >
                {pending ? t(locale, "share.sending") : t(locale, "share.send_text")}
              </button>
            </>
          )}
        </div>

        {notice && (
          <p className={`share-notice ${notice.tone}`} role="status">
            {notice.text}
          </p>
        )}

        <div className="share-copy-area">
          <label htmlFor="share-secure-link">{t(locale, "share.copy_help")}</label>
          <div>
            <input id="share-secure-link" readOnly dir="ltr" value={link} />
            <button type="button" onClick={copy}>
              {copied ? t(locale, "share.copied") : t(locale, "share.copy")}
            </button>
          </div>
        </div>

        <p className="share-security-note">
          <span aria-hidden="true">●</span>
          {t(locale, "share.security_note")}
        </p>
      </div>
    </Modal>
  );
}
