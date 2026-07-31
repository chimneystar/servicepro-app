"use client";

import { useState, useTransition } from "react";
import { restoreRecord } from "./actions";

export type TrashRow = {
  kind: "customer" | "job" | "estimate" | "invoice";
  id: string;
  title: string;
  detail: string;
  /** Raw ISO, used only for ordering. */
  deletedAt: string;
  /**
   * Already formatted on the server. Formatting a date inside a client component
   * makes the server and the browser disagree whenever their locale or timezone
   * differ, which is a hydration error (React #418/#423) — see
   * tests/hydration-guard.test.mjs.
   */
  deletedAtLabel: string;
  deletedBy: string | null;
  /** Empty means restorable. Each entry is a sentence explaining what to do first. */
  blockers: string[];
};

const ICON: Record<TrashRow["kind"], string> = { customer: "👤", job: "💼", estimate: "📝", invoice: "🧾" };
const LABEL: Record<TrashRow["kind"], string> = { customer: "Customer", job: "Job", estimate: "Estimate", invoice: "Invoice" };

export default function TrashList({ rows }: { rows: TrashRow[] }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [restored, setRestored] = useState<Set<string>>(new Set());

  function restore(row: TrashRow) {
    setMessage(null);
    setBusy(row.id);
    start(async () => {
      const result = await restoreRecord(row.kind, row.id);
      setBusy(null);
      if (result.ok) {
        setRestored((previous) => new Set(previous).add(row.id));
        setMessage({ id: row.id, text: `✓ Restored — ${row.title} is back in your ${row.kind === "customer" ? "customers" : `${row.kind}s`}.`, ok: true });
      } else {
        setMessage({ id: row.id, text: result.error ?? "Restore failed.", ok: false });
      }
    });
  }

  if (!rows.length) {
    return (
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 28, textAlign: "center", color: "#5c6675", fontSize: 14 }}>
        Nothing has been deleted. When someone deletes a customer, job, estimate or invoice it will appear here.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {rows.map((row) => {
        const isRestored = restored.has(row.id);
        const blocked = row.blockers.length > 0;
        return (
          <div key={`${row.kind}:${row.id}`} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 14, opacity: isRestored ? 0.55 : 1 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ fontSize: 20, lineHeight: 1.2 }} aria-hidden>{ICON[row.kind]}</div>
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#94a3b8" }}>{LABEL[row.kind]}</div>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a", overflowWrap: "anywhere" }}>{row.title}</div>
                {row.detail && <div style={{ color: "#5c6675", fontSize: 13, marginTop: 2, overflowWrap: "anywhere" }}>{row.detail}</div>}
                <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 6 }}>
                  Deleted {row.deletedAtLabel} · by {row.deletedBy ?? "unknown (deleted before this was recorded, or by an automated task)"}
                </div>
              </div>
              <div style={{ flex: "0 0 auto" }}>
                {isRestored ? (
                  <span style={{ color: "#15803d", fontWeight: 700, fontSize: 13 }}>✓ Restored</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => restore(row)}
                    disabled={blocked || pending}
                    title={blocked ? row.blockers.join(" ") : "Bring this record back"}
                    style={{
                      background: blocked ? "#f1f5f9" : "#16a34a",
                      color: blocked ? "#94a3b8" : "#fff",
                      border: "none", borderRadius: 10, padding: "10px 16px",
                      fontWeight: 700, fontSize: 13.5,
                      cursor: blocked || pending ? "not-allowed" : "pointer",
                    }}
                  >
                    {busy === row.id ? "Restoring…" : "↩ Restore"}
                  </button>
                )}
              </div>
            </div>

            {blocked && !isRestored && (
              <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#7c2d12", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, marginTop: 10, lineHeight: 1.5 }}>
                {row.blockers.map((blocker) => (<div key={blocker}>{blocker}</div>))}
              </div>
            )}

            {message?.id === row.id && (
              <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: message.ok ? "#15803d" : "#dc2626" }}>{message.text}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
