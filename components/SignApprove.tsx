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
      if (!data) throw new Error(t(locale, "doc.approve_error"));
      setDone(true);
      window.dispatchEvent(new Event("servicepro:document-approved"));
    } catch {
      setError(t(locale, "doc.approve_error"));
    } finally { setBusy(false); }
  }

  if (done) return <div className="sign-approve-success" role="status">✓ {t(locale, "doc.thanks")}</div>;

  return (
    <section className="sign-approve" aria-labelledby="sign-approve-title">
      <header className="sign-approve-heading">
        <span aria-hidden="true">✓</span>
        <div><h2 id="sign-approve-title">{t(locale, "doc.sign_heading")}</h2><p>{t(locale, "doc.sign_help")}</p></div>
      </header>
      <label className="sign-approve-field" htmlFor="signer-name"><span>{t(locale, "doc.your_name")}</span>
        <input id="signer-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t(locale, "doc.name_placeholder")} />
      </label>

      <div className="sign-approve-label">
        <div><span>{t(locale, "doc.sign_here")}</span><small>{t(locale, "doc.signature_hint")}</small></div>
        <button type="button" onClick={clear}>{t(locale, "doc.clear")}</button>
      </div>
      <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        className="sign-approve-canvas" aria-label={t(locale, "doc.sign_here")} />

      {error && <div className="sign-approve-error" role="alert">{error}</div>}
      <button className="sign-approve-submit" onClick={approve} disabled={busy}>
        {busy ? "…" : `✓ ${t(locale, "doc.approve")}`}
      </button>
    </section>
  );
}
