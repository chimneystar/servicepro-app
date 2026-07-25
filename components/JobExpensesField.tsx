"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setJobExpenses } from "@/app/(app)/jobs/[id]/actions";

export default function JobExpensesField({ jobId, value }: { jobId: string; value: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [amt, setAmt] = useState((value / 100).toFixed(2));
  const [saved, setSaved] = useState(false);

  function save() {
    start(async () => { await setJobExpenses(jobId, amt); setSaved(true); setTimeout(() => setSaved(false), 1500); router.refresh(); });
  }
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, marginTop: 12 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#334155", marginBottom: 6 }}>Job costs (materials, fees) — used for commission</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={amt} onChange={(e) => setAmt(e.target.value)} type="number" step="0.01" style={{ flex: 1, border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 12px", fontSize: 16, outline: "none" }} placeholder="0.00" />
        <button onClick={save} disabled={pending} style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 10, padding: "9px 14px", fontWeight: 700, cursor: "pointer" }}>{saved ? "✓" : "Save"}</button>
      </div>
    </div>
  );
}
