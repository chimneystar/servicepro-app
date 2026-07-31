"use client";

import { useState, useTransition } from "react";
import { exportForAccounting, reconcileAgainstLedger, type ReconcileResult } from "./actions";

/**
 * Accounting sync — PARTIAL, and this panel says so in the first sentence
 * (ledger 6c.12).
 *
 * There is no OAuth connection here and none is implied. What the panel offers
 * is an export in the target's own import format with a stable reference on
 * every row, and a two-way match against the ledger's own export. What it does
 * NOT offer is listed, verbatim, from ACCOUNTING_SYNC_STATUS.
 */
export default function AccountingSync({
  status,
}: {
  status: {
    status: string;
    built: readonly string[];
    remaining: readonly string[];
    reason: string;
  };
}) {
  const now = new Date();
  const [target, setTarget] = useState<"quickbooks" | "xero">("quickbooks");
  const [from, setFrom] = useState(
    new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(
    new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10),
  );
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [ledgerCsv, setLedgerCsv] = useState("");
  const [result, setResult] = useState<ReconcileResult | null>(null);

  const money = (minor?: number) => `${((minor ?? 0) / 100).toFixed(2)}`;

  const download = (kind: "invoices" | "payments" | "expenses") => {
    setMessage(null);
    start(async () => {
      const r = await exportForAccounting(target, kind, from, to);
      if (!r.ok || !r.csv) {
        setMessage({ ok: false, text: r.error ?? "The export failed." });
        return;
      }
      const blob = new Blob([r.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename ?? "export.csv";
      a.click();
      URL.revokeObjectURL(url);
      setMessage({
        ok: true,
        text: `✓ ${r.rows} row${r.rows === 1 ? "" : "s"} (${money(r.totalMinor)}) — every row carries its SP- reference, so a re-import updates rather than duplicates.`,
      });
    });
  };

  const check = () => {
    setResult(null);
    start(async () => {
      const r = await reconcileAgainstLedger(target, ledgerCsv);
      if (!r.ok) {
        setMessage({ ok: false, text: r.error ?? "The reconciliation failed." });
        return;
      }
      setMessage(null);
      setResult(r);
    });
  };

  return (
    <div style={{ maxWidth: 620, marginTop: 22 }}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 800, marginBottom: 6 }}>QuickBooks / Xero</h2>

      <div
        role="note"
        style={{
          background: "#fff7ed",
          border: "1px solid #fcd9a8",
          color: "#9a3412",
          borderRadius: 12,
          padding: "12px 14px",
          fontSize: "0.8125rem",
          marginBottom: 14,
        }}
      >
        <b>This is not a live connection — it is PARTIAL.</b> {status.reason}
        <div style={{ marginTop: 8, fontWeight: 700 }}>What works today:</div>
        <ul style={{ margin: "4px 0 0", paddingInlineStart: 18 }}>
          {status.built.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div style={{ marginTop: 8, fontWeight: 700 }}>What is still missing:</div>
        <ul style={{ margin: "4px 0 0", paddingInlineStart: 18 }}>
          {status.remaining.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div
        style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18 }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <div>
            <label style={lbl} htmlFor="acct-target">
              Ledger
            </label>
            <select
              id="acct-target"
              value={target}
              onChange={(e) => setTarget(e.target.value as "quickbooks" | "xero")}
              style={inp}
            >
              <option value="quickbooks">QuickBooks Online</option>
              <option value="xero">Xero</option>
            </select>
          </div>
          <div>
            <label style={lbl} htmlFor="acct-from">
              From
            </label>
            <input
              id="acct-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              style={inp}
            />
          </div>
          <div>
            <label style={lbl} htmlFor="acct-to">
              To
            </label>
            <input
              id="acct-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              style={inp}
            />
          </div>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <button type="button" onClick={() => download("invoices")} disabled={pending} style={btn}>
            ⬇ Invoices for {target === "xero" ? "Xero" : "QuickBooks"}
          </button>
          <button type="button" onClick={() => download("payments")} disabled={pending} style={btn}>
            ⬇ Payments for {target === "xero" ? "Xero" : "QuickBooks"}
          </button>
          <button type="button" onClick={() => download("expenses")} disabled={pending} style={btn}>
            ⬇ Expenses for {target === "xero" ? "Xero" : "QuickBooks"}
          </button>
        </div>
        {message && (
          <div
            role="status"
            style={{
              marginTop: 12,
              color: message.ok ? "#15803d" : "#dc2626",
              fontWeight: 700,
              fontSize: "0.8125rem",
            }}
          >
            {message.text}
          </div>
        )}
      </div>

      <h3 style={{ fontSize: "0.9375rem", fontWeight: 800, margin: "18px 0 6px" }}>
        Check the books match
      </h3>
      <p style={{ fontSize: "0.8125rem", color: "#5c6675", marginBottom: 8 }}>
        Export the same period out of {target === "xero" ? "Xero" : "QuickBooks"} and paste it here.
        Rows are matched on the SP- reference, so only what this product sent is compared.
      </p>
      <textarea
        value={ledgerCsv}
        onChange={(e) => setLedgerCsv(e.target.value)}
        placeholder="Paste the ledger's CSV export here…"
        aria-label="Paste the ledger's CSV export here…"
        rows={5}
        style={{ ...inp, fontFamily: "ui-monospace, monospace", fontSize: "0.75rem" }}
      />
      <button
        type="button"
        onClick={check}
        disabled={pending || !ledgerCsv.trim()}
        style={{ ...btn, marginTop: 8, opacity: ledgerCsv.trim() ? 1 : 0.5 }}
      >
        {pending ? "Checking…" : "⇄ Reconcile"}
      </button>

      {result && (
        <div
          role="status"
          style={{
            marginTop: 12,
            borderRadius: 12,
            padding: "12px 14px",
            fontSize: "0.8125rem",
            border: "1px solid",
            ...(result.balanced
              ? { background: "#e6f6ec", borderColor: "#b7e3c6", color: "#15803d" }
              : { background: "#fdeaea", borderColor: "#f5b5b5", color: "#b91c1c" }),
          }}
        >
          <b>
            {result.balanced
              ? `✓ Balanced — ${result.matched} rows match exactly.`
              : `The books do NOT agree. ${result.matched} matched.`}
          </b>
          <div style={{ marginTop: 6 }}>
            Here: {money(result.localTotalMinor)} · Ledger: {money(result.remoteTotalMinor)}
          </div>
          {(result.amountMismatch?.length ?? 0) > 0 && (
            <>
              <div style={{ marginTop: 8, fontWeight: 700 }}>
                Same row, different money ({result.amountMismatch!.length}):
              </div>
              <ul style={list}>
                {result.amountMismatch!.map((row) => (
                  <li key={row.ref}>
                    {row.ref}: here {money(row.localMinor)}, ledger {money(row.remoteMinor)} (off by{" "}
                    {money(row.differenceMinor)})
                  </li>
                ))}
              </ul>
            </>
          )}
          {(result.missingRemote?.length ?? 0) > 0 && (
            <>
              <div style={{ marginTop: 8, fontWeight: 700 }}>
                Sent, but not in the ledger ({result.missingRemote!.length}):
              </div>
              <ul style={list}>
                {result.missingRemote!.map((row) => (
                  <li key={row.ref}>
                    {row.ref}: {money(row.amountMinor)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {(result.missingLocal?.length ?? 0) > 0 && (
            <>
              <div style={{ marginTop: 8, fontWeight: 700 }}>
                In the ledger, but not here ({result.missingLocal!.length}):
              </div>
              <ul style={list}>
                {result.missingLocal!.map((row) => (
                  <li key={row.ref}>
                    {row.ref}: {money(row.amountMinor)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
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
const inp: React.CSSProperties = {
  width: "100%",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: "0.875rem",
  outline: "none",
};
const btn: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "11px 16px",
  fontWeight: 700,
  fontSize: "0.875rem",
  cursor: "pointer",
};
const list: React.CSSProperties = {
  margin: "4px 0 0",
  paddingInlineStart: 18,
  display: "grid",
  gap: 2,
};
