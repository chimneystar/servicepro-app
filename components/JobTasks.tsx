"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addJobTask, toggleJobTask, deleteJobTask } from "@/app/(app)/jobs/[id]/actions";
import { useAppLocale } from "@/components/LocaleProvider";
import { ActionError, useActionStatus } from "@/components/ActionStatus";

export type Task = { id: string; title: string; done: boolean };

export default function JobTasks({ jobId, tasks }: { jobId: string; tasks: Task[] }) {
  const router = useRouter();
  const he = useAppLocale() === "he";
  const { pending, error, run } = useActionStatus(he);
  const [text, setText] = useState("");
  const doneCount = tasks.filter((t) => t.done).length;

  function add() {
    const v = text.trim(); if (!v) return;
    run(() => addJobTask(jobId, v), () => { setText(""); router.refresh(); });
  }

  return (
    <div>
      {tasks.length > 0 && <div style={{ fontSize: 13, color: "#5c6675", marginBottom: 8 }}>{he ? `${doneCount} מתוך ${tasks.length} הושלמו` : `${doneCount} of ${tasks.length} complete`}</div>}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder={he ? "הוספת משימה…" : "Add a task…"} style={inp} />
        <button onClick={add} disabled={pending} style={btn}>➕</button>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {tasks.map((t) => (
          <div key={t.id} style={row}>
            <input type="checkbox" checked={t.done} disabled={pending} onChange={() => run(() => toggleJobTask(t.id, !t.done, jobId), () => router.refresh())} style={{ width: 20, height: 20 }} />
            <span style={{ flex: 1, textDecoration: t.done ? "line-through" : "none", color: t.done ? "#94a3b8" : "#0b1524" }}>{t.title}</span>
            <button onClick={() => run(() => deleteJobTask(t.id, jobId), () => router.refresh())} disabled={pending} style={xBtn}>🗑️</button>
          </div>
        ))}
        {tasks.length === 0 && <div className="rempty">{he ? "עוד אין משימות." : "No tasks yet."}</div>}
      </div>
      <ActionError error={error} />
    </div>
  );
}

const inp: React.CSSProperties = { flex: 1, border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 16, outline: "none" };
const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "9px 15px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "11px 14px" };
const xBtn: React.CSSProperties = { background: "#fdeaea", border: "none", borderRadius: 8, padding: "5px 8px", cursor: "pointer" };
