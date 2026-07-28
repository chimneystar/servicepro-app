"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendText } from "@/app/(app)/messages/actions";

export default function MessageComposer({ phone }: { phone: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");

  function send() {
    const body = text.trim(); if (!body) return;
    start(async () => {
      const r = await sendText(phone, body);
      if (r.ok) { setText(""); router.refresh(); return; }
      if (!r.configured) { window.location.href = `sms:${encodeURIComponent(phone)}?&body=${encodeURIComponent(body)}`; setText(""); return; }
      alert(r.error ?? "Could not send");
    });
  }

  return (
    <div style={{ position: "sticky", bottom: 0, background: "#eef3fb", paddingTop: 8, display: "flex", gap: 8 }}>
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Type a message…" style={{ flex: 1, border: "1px solid #e2e8f0", borderRadius: 22, padding: "12px 16px", fontSize: 16, outline: "none", background: "#fff" }} />
      <button onClick={send} disabled={pending} style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: "50%", width: 46, height: 46, fontSize: 18, cursor: "pointer", flexShrink: 0 }}>➤</button>
    </div>
  );
}
