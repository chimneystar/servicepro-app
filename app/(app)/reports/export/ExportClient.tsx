"use client";

import { useState, useTransition } from "react";
import { exportCsv } from "./actions";

export default function ExportClient() {
  const now = new Date();
  const [from, setFrom] = useState(new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function download(kind: "invoices" | "payments" | "expenses") {
    setMsg(null);
    start(async () => {
      const r = await exportCsv(kind, from, to);
      if (!r.ok || !r.csv) {
        setMsg(r.error ?? "Export failed");
        return;
      }
      const blob = new Blob([r.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename ?? "export.csv";
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`✓ Downloaded ${r.filename}`);
    });
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 14,
          padding: 18,
          boxShadow: "0 6px 18px rgba(15,42,94,.06)",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div>
            <label className="sp-field">
              <span style={lbl}>From</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="sp-input sp-control--lg"
              />
            </label>
          </div>
          <div>
            <label className="sp-field">
              <span style={lbl}>To</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="sp-input sp-control--lg"
              />
            </label>
          </div>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <button type="button" onClick={() => download("invoices")} disabled={pending} style={btn}>
            ⬇ Export invoices (.csv)
          </button>
          <button type="button" onClick={() => download("payments")} disabled={pending} style={btn}>
            ⬇ Export payments (.csv)
          </button>
          <button type="button" onClick={() => download("expenses")} disabled={pending} style={btn}>
            ⬇ Export expenses (.csv)
          </button>
        </div>
        {msg && (
          <div
            style={{
              marginTop: 12,
              color: msg.startsWith("✓") ? "#15803d" : "#dc2626",
              fontWeight: 700,
              fontSize: "0.8125rem",
            }}
          >
            {msg}
          </div>
        )}
      </div>
      <p style={{ color: "#5c6675", fontSize: "0.8125rem", marginTop: 12 }}>
        These CSV files import cleanly into QuickBooks, Xero, Wave, or a spreadsheet for your
        bookkeeper.
      </p>
    </div>
  );
}

const lbl: React.CSSProperties = {
  fontSize: "0.8125rem",
  fontWeight: 700,
  color: "#334155",
  display: "block",
  marginBottom: 5,
};
const btn: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "12px 16px",
  fontWeight: 700,
  fontSize: "0.875rem",
  cursor: "pointer",
};
