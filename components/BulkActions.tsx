"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Multi-select for a list, plus the actions you can run on the selection
 * (ledger 6c.10).
 *
 * THE RULE THIS COMPONENT EXISTS TO HOLD: a bulk action that partially fails
 * must report EXACTLY which rows failed and why. So the result panel is not a
 * toast that fades — it stays until dismissed, it lists every failed row with
 * its reason, and it NEVER shows a success tick when anything failed. A silent
 * partial success on 40 invoices is worse than a refusal, because the operator
 * believes all 40 went out.
 *
 * Deliberately generic: the caller passes the row ids and the actions, so the
 * same component serves invoices and customers without either list learning
 * anything about the other.
 */

export type BulkRow = { id: string; label: string };

export type BulkFailure = { id: string; label: string; reason: string };

export type BulkResult = {
  ok: boolean;
  attempted: number;
  succeeded: number;
  failed: BulkFailure[];
  skipped: BulkFailure[];
  failedCount: number;
  skippedCount: number;
  error?: string;
};

export type BulkAction = {
  key: string;
  label: string;
  /** Shown in the confirm step. Omit for actions that need no confirmation. */
  confirm?: string;
  tone?: "default" | "danger";
  run: (ids: string[]) => Promise<BulkResult>;
};

export default function BulkActions({
  rows, actions, noun = "row",
}: {
  rows: BulkRow[];
  actions: BulkAction[];
  noun?: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<BulkResult | null>(null);
  const [pending, start] = useTransition();

  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const count = selected.size;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(ids));

  const run = (action: BulkAction) => {
    if (count === 0) return;
    if (action.confirm && !window.confirm(`${action.confirm}\n\n${count} ${noun}${count === 1 ? "" : "s"} selected.`)) return;
    start(async () => {
      let outcome: BulkResult;
      try {
        outcome = await action.run([...selected]);
      } catch (cause: unknown) {
        // A thrown action is still a failure the operator must see. Never let
        // it look like nothing happened.
        outcome = {
          ok: false, attempted: count, succeeded: 0, failed: [], skipped: [],
          failedCount: count, skippedCount: 0,
          error: cause instanceof Error ? cause.message : String(cause),
        };
      }
      setResult(outcome);
      // Only clear the selection when EVERYTHING worked, so a retry of the
      // failed rows does not mean re-ticking forty boxes.
      if (outcome.ok && outcome.failedCount === 0) setSelected(new Set());
      router.refresh();
    });
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={bar}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.875rem", fontWeight: 700, cursor: "pointer" }}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={`Select all ${noun}s`} />
          {count > 0 ? `${count} selected` : `Select ${noun}s`}
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {actions.map((action) => (
            <button
              key={action.key} type="button" disabled={count === 0 || pending}
              onClick={() => run(action)}
              style={{ ...actionButton, ...(action.tone === "danger" ? danger : {}), opacity: count === 0 || pending ? 0.5 : 1 }}
            >
              {pending ? "Working…" : action.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length > 0 && (
        <div style={picker}>
          {rows.map((row) => (
            <label key={row.id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: "0.8125rem", padding: "3px 6px", cursor: "pointer" }}>
              <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} aria-label={row.label} />
              <span>{row.label}</span>
            </label>
          ))}
        </div>
      )}

      {result && (
        <div
          role="status"
          style={{
            marginTop: 10, borderRadius: 12, padding: "12px 14px", fontSize: "0.8125rem",
            border: "1px solid",
            ...(result.ok && result.failedCount === 0
              ? { background: "#e6f6ec", borderColor: "#b7e3c6", color: "#15803d" }
              : { background: "#fdeaea", borderColor: "#f5b5b5", color: "#b91c1c" }),
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <b>
              {result.error
                ? `The action failed: ${result.error}`
                : result.failedCount > 0
                ? `${result.succeeded} of ${result.attempted} succeeded — ${result.failedCount} FAILED`
                : `${result.succeeded} of ${result.attempted} succeeded`}
            </b>
            <button type="button" onClick={() => setResult(null)} style={dismiss} aria-label="Dismiss">✕</button>
          </div>

          {result.failed.length > 0 && (
            <ul style={list}>
              {result.failed.map((f) => (
                <li key={`f-${f.id}`}><b>{f.label}</b>: {f.reason}</li>
              ))}
            </ul>
          )}

          {result.skipped.length > 0 && (
            <>
              <div style={{ marginTop: 8, fontWeight: 700 }}>
                {result.skippedCount} skipped on purpose:
              </div>
              <ul style={list}>
                {result.skipped.map((s) => (
                  <li key={`s-${s.id}`}><b>{s.label}</b>: {s.reason}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const bar: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
  flexWrap: "wrap", background: "#f5f7fb", border: "1px solid #e2e8f0",
  borderRadius: 12, padding: "10px 12px",
};
const picker: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))",
  gap: 2, marginTop: 8, maxHeight: 190, overflowY: "auto",
  border: "1px solid #eef1f6", borderRadius: 10, padding: 6, background: "#fff",
};
const actionButton: React.CSSProperties = {
  background: "#e0ebff", color: "#1d4ed8", border: "none", borderRadius: 9,
  padding: "8px 12px", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer",
};
const danger: React.CSSProperties = { background: "#fdeaea", color: "#b91c1c" };
const dismiss: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", color: "inherit", fontWeight: 700 };
const list: React.CSSProperties = { margin: "6px 0 0", paddingInlineStart: 18, display: "grid", gap: 3 };
