"use client";

import { useState, useTransition } from "react";
import { requestReview } from "@/app/(app)/jobs/[id]/actions";

export default function ReviewButton({ jobId }: { jobId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function go() {
    setMsg(null);
    start(async () => {
      const r = await requestReview(jobId);
      if (!r.ok) { setMsg(r.error ?? "Could not send"); return; }
      if (r.sent) { setMsg("✓ Review request sent!"); return; }
      // Fallback: open the user's own text/email app with the review link.
      const body = `We'd love a quick review: ${r.reviewUrl}`;
      if (r.phone) window.location.href = `sms:${encodeURIComponent(r.phone)}?&body=${encodeURIComponent(body)}`;
      else if (r.email) window.location.href = `mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent("How did we do?")}&body=${encodeURIComponent(body)}`;
      else setMsg("No phone or email on file for this client.");
    });
  }

  return (
    <div style={{ marginTop: 10 }}>
      <button onClick={go} disabled={pending} style={{ width: "100%", background: "#eab308", color: "#0b1524", border: "none", borderRadius: 12, padding: 12, fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
        {pending ? "…" : "⭐ Request a review"}
      </button>
      {msg && <div style={{ marginTop: 8, textAlign: "center", fontSize: 13, fontWeight: 700, color: msg.startsWith("✓") ? "#15803d" : "#dc2626" }}>{msg}</div>}
    </div>
  );
}
