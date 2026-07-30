"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { recordPhoto, deletePhoto } from "@/app/(app)/jobs/[id]/actions";

export type Photo = { id: string; path: string; url: string | null; label: string | null; mediaType: "image" | "video"; parentPhotoId: string | null; customerVisible: boolean };

export default function JobPhotos({ jobId, orgId, photos }: { jobId: string; orgId: string; photos: Photo[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Photo | null>(null);
  const he = typeof document !== "undefined" && document.documentElement.dir === "rtl";

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy(true); setError(null);
    try {
      for (const file of files) {
        const isVideo = file.type.startsWith("video/");
        const limit = isVideo ? 100 * 1024 * 1024 : 15 * 1024 * 1024;
        if ((!file.type.startsWith("image/") && !isVideo) || file.size > limit) throw new Error(he ? "הקובץ לא נתמך או גדול מדי." : "That file type is not supported or is too large.");
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${orgId}/${jobId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("job-photos").upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const res = await recordPhoto(jobId, path, "", isVideo ? "video" : "image");
        if (!res.ok) throw new Error(res.error);
      }
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Upload failed");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function saveAnnotation(blob: Blob, parent: Photo) {
    setBusy(true); setError(null);
    try { const path = `${orgId}/${jobId}/${crypto.randomUUID()}-annotated.png`; const { error: uploadError } = await supabase.storage.from("job-photos").upload(path, blob, { contentType: "image/png", upsert: false }); if (uploadError) throw uploadError; const result = await recordPhoto(jobId, path, he ? "תמונה עם סימון" : "Annotated photo", "image", parent.id); if (!result.ok) throw new Error(result.error); setEditing(null); router.refresh(); } catch (err: any) { setError(err?.message ?? (he ? "שמירת הסימון נכשלה." : "Annotation could not be saved.")); } finally { setBusy(false); }
  }

  async function remove(p: Photo) {
    if (!confirm("Delete this photo?")) return;
    setBusy(true);
    await deletePhoto(p.id, p.path, jobId);
    router.refresh();
    setBusy(false);
  }

  return (
    <div>
      <label style={upload}>
        <input type="file" accept="image/*,video/*" multiple onChange={onFiles} disabled={busy} style={{ display: "none" }} />
        {busy ? (he ? "מעלים…" : "Uploading…") : (he ? "העלאת תמונות או וידאו" : "Upload photos or video")}
      </label>
      {error && <div style={{ color: "#dc2626", fontSize: 14, marginTop: 8 }}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 10, marginTop: 12 }}>
        {photos.map((p) => (
          <div key={p.id} style={{ position: "relative", aspectRatio: "1", borderRadius: 12, overflow: "hidden", border: "1px solid #e2e8f0", background: "#eef2f8" }}>
            {p.url ? (p.mediaType === "video" ? <video src={p.url} controls playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <img src={p.url} alt={p.label ?? ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />) : <div style={{ padding: 8, fontSize: 14, color: "#5c6675" }}>{p.mediaType}</div>}
            {p.mediaType === "image" && p.url && <button type="button" onClick={() => setEditing(p)} style={annotateBtn}>{he ? "סימון" : "Mark up"}</button>}
            <button onClick={() => remove(p)} style={delBtn} title="Delete">✕</button>
          </div>
        ))}
        {photos.length === 0 && <div style={{ color: "#5c6675", fontSize: 14, padding: 8 }}>{he ? "עדיין אין תמונות או סרטונים." : "No photos or videos yet."}</div>}
      </div>
      {editing && editing.url && <PhotoAnnotator photo={editing} he={he} onCancel={() => setEditing(null)} onSave={saveAnnotation} />}
    </div>
  );
}

function PhotoAnnotator({ photo, he, onCancel, onSave }: { photo: Photo; he: boolean; onCancel: () => void; onSave: (blob: Blob, photo: Photo) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null); const drawing = useRef(false);
  useEffect(() => { const canvas = canvasRef.current; if (!canvas || !photo.url) return; const image = new Image(); image.crossOrigin = "anonymous"; image.onload = () => { const scale = Math.min(1, 900 / image.naturalWidth); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale); canvas.getContext("2d")?.drawImage(image,0,0,canvas.width,canvas.height); }; image.src = photo.url; }, [photo]);
  function point(event: React.PointerEvent<HTMLCanvasElement>) { const canvas = event.currentTarget; const rect = canvas.getBoundingClientRect(); return { x: (event.clientX-rect.left)*(canvas.width/rect.width), y: (event.clientY-rect.top)*(canvas.height/rect.height) }; }
  function start(event: React.PointerEvent<HTMLCanvasElement>) { drawing.current = true; event.currentTarget.setPointerCapture(event.pointerId); const ctx = event.currentTarget.getContext("2d"); const p = point(event); if (ctx) { ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.strokeStyle = "#f44336"; ctx.lineWidth = Math.max(4,event.currentTarget.width/140); ctx.lineCap = "round"; ctx.lineJoin = "round"; } }
  function move(event: React.PointerEvent<HTMLCanvasElement>) { if (!drawing.current) return; const ctx = event.currentTarget.getContext("2d"); const p = point(event); if (ctx) { ctx.lineTo(p.x,p.y); ctx.stroke(); } }
  function save() { canvasRef.current?.toBlob((blob) => { if (blob) onSave(blob,photo); },"image/png",.92); }
  return <div className="photo-annotator" role="dialog" aria-modal="true"><div><header><strong>{he ? "סימון על התמונה" : "Mark up photo"}</strong><small>{he ? "ציירו באדום על האזור שחשוב להראות." : "Draw in red over the area you want to call out."}</small></header><canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerUp={() => drawing.current=false} onPointerCancel={() => drawing.current=false} /><footer><button type="button" onClick={save}>{he ? "שמירת עותק" : "Save copy"}</button><button type="button" onClick={onCancel}>{he ? "ביטול" : "Cancel"}</button></footer></div></div>;
}

const upload: React.CSSProperties = { display: "inline-block", border: "2px dashed #b9c8e6", color: "#2563eb", background: "#f8fbff", borderRadius: 12, padding: "12px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer" };
const delBtn: React.CSSProperties = { position: "absolute", top: 5, right: 5, background: "rgba(220,38,38,.92)", color: "#fff", border: "none", width: 24, height: 24, borderRadius: 7, fontSize: 14, cursor: "pointer" };
const annotateBtn: React.CSSProperties = { position: "absolute", left: 5, bottom: 5, minHeight: 26, padding: "0 7px", border: 0, borderRadius: 7, background: "rgba(16,26,46,.88)", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer" };
