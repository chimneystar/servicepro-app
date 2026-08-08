"use client";

import { useState, useTransition } from "react";
import { requestReview } from "@/app/(app)/jobs/[id]/actions";
import { useAppLocale } from "@/components/LocaleProvider";

export default function ReviewButton({ jobId }: { jobId: string }) {
  const [pending, start] = useTransition();
  const he = useAppLocale() === "he";
  const [msg, setMsg] = useState<string | null>(null);

  function go() {
    setMsg(null);
    start(async () => {
      const r = await requestReview(jobId);
      if (!r.ok) {
        setMsg(r.error ?? (he ? "לא הצלחנו לשלוח את הבקשה" : "Could not send the request"));
        return;
      }
      if (r.sent) {
        setMsg(he ? "הבקשה לביקורת נשלחה" : "Review request sent");
        return;
      }
      // Fallback: open the user's own text/email app with the review link.
      const body = he
        ? `נשמח לשמוע איך היה השירות: ${r.reviewUrl}`
        : `We'd love a quick review: ${r.reviewUrl}`;
      if (r.phone)
        window.location.href = `sms:${encodeURIComponent(r.phone)}?&body=${encodeURIComponent(body)}`;
      else if (r.email)
        window.location.href = `mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent(he ? "איך היה השירות?" : "How did we do?")}&body=${encodeURIComponent(body)}`;
      else
        setMsg(
          he
            ? "לא שמורים טלפון או אימייל ללקוח הזה."
            : "No phone or email is saved for this customer.",
        );
    });
  }

  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        onClick={go}
        disabled={pending}
        style={{
          width: "100%",
          background: "#eab308",
          color: "#0b1524",
          border: "none",
          borderRadius: 12,
          padding: 12,
          fontWeight: 800,
          fontSize: "0.875rem",
          cursor: "pointer",
        }}
      >
        {pending ? "…" : he ? "בקשת ביקורת מהלקוח" : "Request a review"}
      </button>
      {msg && (
        <div
          style={{
            marginTop: 8,
            textAlign: "center",
            fontSize: "0.875rem",
            fontWeight: 700,
            color: msg.startsWith("✓") ? "#15803d" : "#dc2626",
          }}
        >
          {msg}
        </div>
      )}
    </div>
  );
}
