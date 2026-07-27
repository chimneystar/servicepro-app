"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendCustomerEmail, sendText } from "@/app/(app)/messages/actions";

export default function UnifiedComposer({ channel, contact, customerId, subject: initialSubject, threadId, connected }: {
  channel: "sms" | "email"; contact: string; customerId?: string | null; subject?: string | null; threadId?: string | null; connected: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState(initialSubject ?? "");
  const [error, setError] = useState("");

  function send() {
    const message = body.trim();
    if (!message || (channel === "email" && !subject.trim())) return;
    setError("");
    start(async () => {
      const result = channel === "sms"
        ? await sendText(contact, message)
        : await sendCustomerEmail({ to: contact, subject, body: message, customerId, threadId });
      if (result.ok) { setBody(""); router.refresh(); return; }
      if (!result.configured && channel === "sms") { window.location.href = `sms:${encodeURIComponent(contact)}?&body=${encodeURIComponent(message)}`; return; }
      setError(result.error ?? `${channel === "sms" ? "Text messaging" : "Gmail"} is not connected`);
    });
  }

  return (
    <div style={{ position: "sticky", bottom: 0, background: "#eef3fb", paddingTop: 10 }}>
      {channel === "email" && <input value={subject} onChange={(event) => setSubject(event.target.value)} aria-label="Email subject" placeholder="Subject" style={field} />}
      <div style={{ display: "flex", gap: 8 }}>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} aria-label={channel === "sms" ? "Text message" : "Email message"} placeholder={connected ? `Write a ${channel === "sms" ? "text" : "reply"}…` : `${channel === "sms" ? "Text messaging" : "Gmail"} is not connected`} rows={2} style={{ ...field, flex: 1, resize: "vertical", marginBottom: 0 }} />
        <button onClick={send} disabled={pending || !body.trim()} aria-label="Send message" style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 14, width: 50, fontSize: 18, flexShrink: 0 }}>➤</button>
      </div>
      {error && <div style={{ color: "#b91c1c", fontSize: 12, marginTop: 6 }}>{error}</div>}
    </div>
  );
}

const field: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 13px", fontSize: 16, outline: "none", background: "#fff", marginBottom: 7 };
