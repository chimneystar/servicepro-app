"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { setOnMyWay, clockIn, clockOut, completeJob } from "@/app/(app)/jobs/[id]/actions";
import { ActionError, useActionStatus } from "@/components/ActionStatus";

export default function JobFieldTools({ jobId, onMyWayAt, startedAt, completedAt, clockedIn, totalMinutes, signedBy }: {
  jobId: string; onMyWayAt: string | null; startedAt: string | null; completedAt: string | null;
  clockedIn: boolean; totalMinutes: number; signedBy: string | null;
}) {
  const router = useRouter();
  // A failed clock-in used to be indistinguishable from a successful one, so a
  // technician could work a whole call with no time recorded against the job.
  const { pending, error, run: perform } = useActionStatus();
  const [signOpen, setSignOpen] = useState(false);
  const done = !!completedAt;

  const run = (fn: () => Promise<any>) => perform(fn, () => router.refresh());
  const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div style={{ background: "#0f2a5e", color: "#fff", borderRadius: 14, padding: 16, marginBottom: 12 }}>
      <div style={{ fontWeight: 800, fontSize: "0.875rem", marginBottom: 10 }}>🚚 Field tools</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
        <button onClick={() => run(() => setOnMyWay(jobId))} disabled={pending || done} style={{ ...b, background: onMyWayAt ? "#1e40af" : "#2563eb" }}>
          {onMyWayAt ? `✓ On the way ${fmtTime(onMyWayAt)}` : "🚗 On my way"}
        </button>
        {!clockedIn
          ? <button onClick={() => run(() => clockIn(jobId))} disabled={pending || done} style={{ ...b, background: "#15803d" }}>▶️ Clock in</button>
          : <button onClick={() => run(() => clockOut(jobId))} disabled={pending} style={{ ...b, background: "#b45309" }}>⏸️ Clock out</button>}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", opacity: .9, marginBottom: 10 }}>
        <span>{clockedIn ? "🟢 On the clock now" : "Time logged"}</span>
        <b>{Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m</b>
      </div>

      {!done
        ? <button onClick={() => setSignOpen(true)} disabled={pending} style={{ ...b, width: "100%", background: "#fff", color: "#15803d" }}>✅ Complete job {startedAt ? "" : ""}</button>
        : <div style={{ background: "rgba(255,255,255,.12)", borderRadius: 10, padding: "10px 12px", fontSize: "0.8125rem" }}>✓ Completed {fmtTime(completedAt)}{signedBy ? ` · signed by ${signedBy}` : ""}</div>}

      <ActionError error={error} />

      {signOpen && <SignModal jobId={jobId} onClose={() => setSignOpen(false)} />}
    </div>
  );
}

function SignModal({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const router = useRouter();
  const { pending, error, run } = useActionStatus();
  const [name, setName] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.strokeStyle = "#0b1524";
  }, []);

  function pos(e: any) {
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: (p.clientX - r.left) * (c.width / r.width), y: (p.clientY - r.top) * (c.height / r.height) };
  }
  function down(e: any) { e.preventDefault(); drawing.current = true; const ctx = canvasRef.current!.getContext("2d")!; const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); }
  function move(e: any) { if (!drawing.current) return; e.preventDefault(); const ctx = canvasRef.current!.getContext("2d")!; const { x, y } = pos(e); ctx.lineTo(x, y); ctx.stroke(); hasInk.current = true; }
  function up() { drawing.current = false; }
  function clear() { const c = canvasRef.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); hasInk.current = false; }

  function save() {
    const sig = hasInk.current ? canvasRef.current!.toDataURL("image/png") : "";
    // The modal used to close regardless, discarding a captured signature that
    // was never stored — the customer signs once and then it is gone.
    run(() => completeJob(jobId, sig, name), () => { onClose(); router.refresh(); });
  }

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <h3 style={{ fontSize: "1.125rem", fontWeight: 800, marginBottom: 4, color: "#0b1524" }}>Complete job</h3>
        <p style={{ color: "#5c6675", fontSize: "0.8125rem", marginBottom: 12 }}>Have the customer sign to confirm the work is done (optional).</p>
        <label style={lbl}>Customer name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={inp} placeholder="Name" />
        <label style={{ ...lbl, marginTop: 10 }}>Signature</label>
        <canvas ref={canvasRef} width={520} height={180}
          onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up}
          onTouchStart={down} onTouchMove={move} onTouchEnd={up}
          style={{ width: "100%", height: 160, border: "1px dashed #b9c8e6", borderRadius: 12, background: "#f8fbff", touchAction: "none" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={save} disabled={pending} style={{ ...b, background: "#15803d", color: "#fff", flex: 1 }}>{pending ? "Saving…" : "✅ Mark complete"}</button>
          <button onClick={clear} type="button" style={{ ...b, background: "#eef2f8", color: "#2563eb" }}>Clear</button>
          <button onClick={onClose} type="button" style={{ ...b, background: "#e2e9f4", color: "#2563eb" }}>Cancel</button>
        </div>
        <ActionError error={error} />
      </div>
    </div>
  );
}

const b: React.CSSProperties = { border: "none", borderRadius: 10, padding: "11px 12px", fontWeight: 700, fontSize: "0.875rem", color: "#fff", cursor: "pointer" };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15,30,61,.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, zIndex: 120, overflowY: "auto" };
const modal: React.CSSProperties = { background: "#fff", borderRadius: 18, width: "100%", maxWidth: 560, padding: 22 };
const lbl: React.CSSProperties = { fontSize: "0.8125rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 6 };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "11px 12px", fontSize: "1rem", outline: "none" };
