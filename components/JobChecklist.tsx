"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
} from "@/app/(app)/jobs/[id]/actions";
import { useAppLocale } from "@/components/LocaleProvider";
import { ActionError, useActionStatus } from "@/components/ActionStatus";
import { Button } from "@/components/ui";

export type Check = { id: string; label: string; checked: boolean };

export default function JobChecklist({ jobId, items }: { jobId: string; items: Check[] }) {
  const router = useRouter();
  const he = useAppLocale() === "he";
  const { pending, error, run } = useActionStatus(he);
  const [text, setText] = useState("");
  const done = items.filter((i) => i.checked).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;

  function add() {
    const v = text.trim();
    if (!v) return;
    // The box is cleared only once the row is actually stored, so a rejected
    // write does not also throw away what the technician typed.
    run(
      () => addChecklistItem(jobId, v),
      () => {
        setText("");
        router.refresh();
      },
    );
  }

  return (
    <div>
      {items.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.8125rem",
              color: "#5c6675",
              marginBottom: 4,
            }}
          >
            <span>{he ? "התקדמות" : "Progress"}</span>
            <span>{pct}%</span>
          </div>
          <div style={{ height: 8, background: "#eef2f8", borderRadius: 99 }}>
            <div
              style={{ width: `${pct}%`, height: "100%", background: "#15803d", borderRadius: 99 }}
            />
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={he ? "הוספת סעיף לבדיקה…" : "Add checklist item…"}
          aria-label={he ? "הוספת סעיף לבדיקה…" : "Add checklist item…"}
          style={inp}
        />
        <Button
          onClick={add}
          disabled={pending}
          aria-label={he ? "הוספת סעיף" : "Add item"}
          size="md"
        >
          ➕
        </Button>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((it) => (
          <div key={it.id} style={row}>
            <input
              type="checkbox"
              checked={it.checked}
              disabled={pending}
              onChange={() =>
                run(
                  () => toggleChecklistItem(it.id, !it.checked, jobId),
                  () => router.refresh(),
                )
              }
              style={{ width: 20, height: 20 }}
              aria-label={it.label}
            />
            <span
              style={{
                flex: 1,
                textDecoration: it.checked ? "line-through" : "none",
                color: it.checked ? "#94a3b8" : "#0b1524",
              }}
            >
              {it.label}
            </span>
            <button
              type="button"
              onClick={() =>
                run(
                  () => deleteChecklistItem(it.id, jobId),
                  () => router.refresh(),
                )
              }
              disabled={pending}
              style={xBtn}
              aria-label={he ? `מחיקת "${it.label}"` : `Delete "${it.label}"`}
            >
              🗑️
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <div className="rempty">
            {he ? "עוד אין סעיפים ברשימת הבדיקה." : "No checklist items yet."}
          </div>
        )}
      </div>
      <ActionError error={error} />
    </div>
  );
}

const inp: React.CSSProperties = {
  flex: 1,
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: "1rem",
  outline: "none",
};
const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: "11px 14px",
};
const xBtn: React.CSSProperties = {
  background: "#fdeaea",
  border: "none",
  borderRadius: 8,
  padding: "5px 8px",
  cursor: "pointer",
};
