"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateJobStatus, createInvoiceFromJob } from "@/app/(app)/jobs/[id]/actions";

const STATUSES = [["scheduled", "Scheduled"], ["in_progress", "In progress"], ["done", "Done"], ["cancelled", "Cancelled"]];

export default function JobActions({ jobId, status, canInvoice }: { jobId: string; status: string; canInvoice: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function changeStatus(s: string) { start(async () => { await updateJobStatus(jobId, s); router.refresh(); }); }
  function makeInvoice() {
    if (!confirm("Create an invoice from this job?")) return;
    start(async () => { const r = await createInvoiceFromJob(jobId); setMsg(r.ok ? "✓ Invoice created" : r.error || "Error"); router.refresh(); });
  }

  return (
    <div>
      <label style={{ fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", marginBottom: 6 }}>Status</label>
      <select value={status} disabled={pending} onChange={(e) => changeStatus(e.target.value)} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "11px 12px", marginBottom: 12, background: "#fff" }}>
        {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {canInvoice && <button onClick={makeInvoice} disabled={pending} style={{ width: "100%", background: "#15803d", color: "#fff", border: "none", borderRadius: 12, padding: 14, fontWeight: 800, fontSize: 15, cursor: "pointer" }}>🧾 Create invoice from job</button>}
      {msg && <div style={{ marginTop: 10, color: msg.startsWith("✓") ? "#15803d" : "#dc2626", fontSize: 13, fontWeight: 600 }}>{msg}</div>}
    </div>
  );
}
