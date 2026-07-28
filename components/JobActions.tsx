"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setJobStage, createInvoiceFromJob } from "@/app/(app)/jobs/[id]/actions";

export type Stage = { name: string; color: string };

export default function JobActions({ jobId, stage, stages, canInvoice }: { jobId: string; stage: string; stages: Stage[]; canInvoice: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const list = stages.length ? stages : [{ name: "Scheduled", color: "#2563eb" }];
  const current = list.find((s) => s.name === stage) ?? list[0];

  function changeStage(s: string) { start(async () => { await setJobStage(jobId, s); router.refresh(); }); }
  function makeInvoice() {
    if (!confirm("Create an invoice from this job?")) return;
    start(async () => { const r = await createInvoiceFromJob(jobId); setMsg(r.ok ? "✓ Invoice created" : r.error || "Error"); router.refresh(); });
  }

  return (
    <div>
      <label style={{ fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", marginBottom: 6 }}>Status</label>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ width: 12, height: 12, borderRadius: 4, background: current?.color ?? "#2563eb", flexShrink: 0 }} />
        <select value={stage} disabled={pending} onChange={(e) => changeStage(e.target.value)} style={{ flex: 1, border: "1px solid #e2e8f0", borderRadius: 10, padding: "11px 12px", background: "#fff", fontWeight: 600 }}>
          {list.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
      </div>
      {canInvoice && <button onClick={makeInvoice} disabled={pending} style={{ width: "100%", background: "#15803d", color: "#fff", border: "none", borderRadius: 12, padding: 14, fontWeight: 800, fontSize: 15, cursor: "pointer" }}>🧾 Create invoice from job</button>}
      {msg && <div style={{ marginTop: 10, color: msg.startsWith("✓") ? "#15803d" : "#dc2626", fontSize: 13, fontWeight: 600 }}>{msg}</div>}
    </div>
  );
}
