"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateJobAddress } from "@/app/(app)/jobs/[id]/actions";

export default function JobAddressForm({ jobId, jobAddress, jobCity }: { jobId: string; jobAddress: string | null; jobCity: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    start(async () => { await updateJobAddress(jobId, formData); setOpen(false); router.refresh(); });
  }

  if (!open) return <button onClick={() => setOpen(true)} style={link}>✏️ Edit job address</button>;
  return (
    <form action={submit} style={{ background: "#f8fbff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, marginTop: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#5c6675", marginBottom: 8 }}>Job address (leave blank to use client address)</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input name="job_address" defaultValue={jobAddress ?? ""} placeholder="Address" style={inp} />
        <input name="job_city" defaultValue={jobCity ?? ""} placeholder="City" style={inp} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="submit" disabled={pending} style={btn}>{pending ? "Saving…" : "💾 Save"}</button>
        <button type="button" onClick={() => setOpen(false)} style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}>Cancel</button>
      </div>
    </form>
  );
}

const link: React.CSSProperties = { background: "#eef2f8", color: "#2563eb", border: "none", borderRadius: 9, padding: "8px 12px", fontWeight: 700, fontSize: 13, cursor: "pointer", marginTop: 6 };
const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "9px 15px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 16, outline: "none" };
