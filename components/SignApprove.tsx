"use client";

import { useRef, useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { t, type Locale } from "@/lib/i18n";

export default function SignApprove({ token, locale }: { token: string; locale: Locale }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasDrawn = useRef(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    // scale for crisp lines
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio; c.height = c.offsetHeight * ratio;
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.strokeStyle = "#0b1524";
  }, []);

  function pos(e: React.PointerEvent) {
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function down(e: React.PointerEvent) { drawing.current = true; const ctx = canvasRef.current!.getContext("2d")!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); (e.target as Element).setPointerCapture(e.pointerId); }
  function move(e: React.PointerEvent) { if (!drawing.current) return; const ctx = canvasRef.current!.getContext("2d")!; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); hasDrawn.current = true; }
  function up() { drawing.current = false; }
  function clear() { const c = canvasRef.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); hasDrawn.current = false; }

  async function approve() {
    if (!name.trim()) { setError(t(locale, "doc.your_name")); return; }
    setBusy(true); setError(null);
    try {
      const sig = hasDrawn.current ? canvasRef.current!.toDataURL("image/png") : "";
      const supabase = createClient();
      const { data, error } = await supabase.rpc("approve_document", { p_token: token, p_name: name.trim(), p_sig: sig });
      if (error) throw error;
      if (!data) throw new Error("Could not approve");
      setDone(true);
    } catch (err: any) {
      setError(err?.message ?? "Error");
    } finally { setBusy(false); }
  }

  if (done) return <div style={{ background: "#e6f6ec", color: "#15803d", padding: "16px", borderRadius: 12, fontWeight: 700, textAlign: "center" }}>✓ {t(locale, "doc.thanks")}</div>;

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 16 }}>
      <label style={{ fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", marginBottom: 6 }}>{t(locale, "doc.your_name")}</label>
      <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "11px 12px", fontSize: 16, outline: "none", marginBottom: 12 }} placeholder="John Smith" />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <label style={{ fontSize: 12.5, fontWeight: 700, color: "#334155" }}>{t(locale, "doc.sign_here")}</label>
        <button type="button" onClick={clear} style={{ background: "none", border: "none", color: "#2563eb", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>{t(locale, "doc.clear")}</button>
      </div>
      <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        style={{ width: "100%", height: 150, border: "1px dashed #b9c8e6", borderRadius: 10, touchAction: "none", background: "#fbfdff" }} />

      {error && <div style={{ color: "#dc2626", fontSize: 13, marginTop: 8 }}>{error}</div>}
      <button onClick={approve} disabled={busy} style={{ width: "100%", background: "#15803d", color: "#fff", border: "none", borderRadius: 12, padding: 15, fontSize: 16, fontWeight: 800, cursor: "pointer", marginTop: 12 }}>
        {busy ? "…" : `✓ ${t(locale, "doc.approve")}`}
      </button>
    </div>
  );
}
