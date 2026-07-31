"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendCustomerStatement } from "@/app/(app)/customers/actions";

/**
 * Send this statement (ledger 6c.6).
 *
 * A refusal and a breakage read differently, because they need different
 * actions: "Dana unsubscribed" is not "Resend is down". Neither is swallowed.
 */
export default function StatementActions({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const send = (channel: "sms" | "email") => {
    start(async () => {
      const result = await sendCustomerStatement(customerId, channel);
      setMessage(result.ok
        ? { ok: true, text: `✓ Statement sent by ${channel}.` }
        : { ok: false, text: result.error ?? "The statement was not sent." });
      router.refresh();
    });
  };

  return (
    <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
      <button type="button" onClick={() => send("email")} disabled={pending} style={button}>
        {pending ? "Working…" : "✉ Email statement"}
      </button>
      <button type="button" onClick={() => send("sms")} disabled={pending} style={button}>
        {pending ? "Working…" : "💬 Text statement"}
      </button>
      <button type="button" onClick={() => window.print()} style={{ ...button, background: "#eef2f8", color: "#0b1524" }}>
        🖨 Print
      </button>
      {message && (
        <span role="status" style={{ fontSize: "0.8125rem", fontWeight: 700, color: message.ok ? "#15803d" : "#b91c1c" }}>
          {message.text}
        </span>
      )}
    </div>
  );
}

const button: React.CSSProperties = {
  background: "#e0ebff", color: "#1d4ed8", border: "none", borderRadius: 10,
  padding: "9px 14px", fontWeight: 700, fontSize: "0.875rem", cursor: "pointer",
};
