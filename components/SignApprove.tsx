"use client";

import { useRef, useState, useEffect } from "react";
import { t, type Locale } from "@/lib/i18n";
import { approveDocument } from "@/app/p/[token]/actions";

export default function SignApprove({ token, locale }: { token: string; locale: Locale }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasDrawn = useRef(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    // scale for crisp lines
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0b1524";
  }, []);

  function pos(e: React.PointerEvent) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function down(e: React.PointerEvent) {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    hasDrawn.current = true;
  }
  function up() {
    drawing.current = false;
  }
  function clear() {
    const c = canvasRef.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    hasDrawn.current = false;
  }

  // The RPC used to be called from here, which is exactly why an approved
  // estimate had no evidence behind it: the server never saw the request, so
  // there was no IP and no user agent to record. It now posts to a server
  // action that captures both. See app/p/[token]/actions.ts.
  //
  // That action is also the only place the signing guards can be enforced — a
  // voided or already-signed document is refused there, and the refusal comes
  // back as `{ ok:false, error }`. Calling the RPC straight from the browser
  // again would put the customer back on an unguarded, unwitnessed path.
  async function approve() {
    if (!name.trim()) {
      setError(t(locale, "doc.your_name"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sig = hasDrawn.current ? canvasRef.current!.toDataURL("image/png") : "";
      const payload = new FormData();
      payload.set("token", token);
      payload.set("name", name.trim());
      payload.set("signature", sig);
      const result = await approveDocument({ ok: false }, payload);
      // The action's reason is already written in the reader's language, and it
      // is the only thing that distinguishes "voided" from "already signed"
      // from "too many attempts". Show it; fall back to the generic line.
      if (!result.ok) throw new Error(result.error || t(locale, "doc.approve_error"));
      setDone(true);
      window.dispatchEvent(new Event("servicepro:document-approved"));
    } catch (err: any) {
      setError(err?.message || t(locale, "doc.approve_error"));
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className="sign-approve-success" role="status">
        ✓ {t(locale, "doc.thanks")}
      </div>
    );

  return (
    <section className="sign-approve" aria-labelledby="sign-approve-title">
      <header className="sign-approve-heading">
        <span aria-hidden="true">✓</span>
        <div>
          <h2 id="sign-approve-title">{t(locale, "doc.sign_heading")}</h2>
          <p>{t(locale, "doc.sign_help")}</p>
        </div>
      </header>

      <label className="sign-approve-field" htmlFor="signer-name">
        <span>{t(locale, "doc.your_name")}</span>
        <input
          id="signer-name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t(locale, "doc.name_placeholder")}
        />
      </label>

      <div className="sign-approve-label">
        <div>
          {/* A <canvas> is not a labelable element, so the pad carries its own
              aria-label below and this stays plain text. */}
          <span>{t(locale, "doc.sign_here")}</span>
          <small>{t(locale, "doc.signature_hint")}</small>
        </div>
        <button type="button" onClick={clear}>
          {t(locale, "doc.clear")}
        </button>
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        aria-label={t(locale, "doc.sign_here")}
        className="sign-approve-canvas"
      />

      {error && (
        <div className="sign-approve-error" role="alert">
          {error}
        </div>
      )}
      <button type="button" className="sign-approve-submit" onClick={approve} disabled={busy}>
        {busy ? (
          "…"
        ) : (
          <>
            <span aria-hidden="true">✓</span> {t(locale, "doc.approve")}
          </>
        )}
      </button>
    </section>
  );
}
