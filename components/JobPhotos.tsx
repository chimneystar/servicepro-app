"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { recordPhoto, deletePhoto } from "@/app/(app)/jobs/[id]/actions";

export type Photo = { id: string; path: string; url: string | null; label: string | null };

export default function JobPhotos({ jobId, orgId, photos }: { jobId: string; orgId: string; photos: Photo[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy(true); setError(null);
    try {
      for (const file of files) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${orgId}/${jobId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("job-photos").upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const res = await recordPhoto(jobId, path, "");
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
        <input type="file" accept="image/*" multiple onChange={onFiles} disabled={busy} style={{ display: "none" }} />
        {busy ? "Uploading…" : "📷 Upload photos (before / after)"}
      </label>
      {error && <div style={{ color: "#dc2626", fontSize: 13, marginTop: 8 }}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 10, marginTop: 12 }}>
        {photos.map((p) => (
          <div key={p.id} style={{ position: "relative", aspectRatio: "1", borderRadius: 12, overflow: "hidden", border: "1px solid #e2e8f0", background: "#eef2f8" }}>
            {p.url ? <img src={p.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ padding: 8, fontSize: 11, color: "#5c6675" }}>image</div>}
            <button onClick={() => remove(p)} style={delBtn} title="Delete">✕</button>
          </div>
        ))}
        {photos.length === 0 && <div style={{ color: "#5c6675", fontSize: 13, padding: 8 }}>No photos yet.</div>}
      </div>
    </div>
  );
}

const upload: React.CSSProperties = { display: "inline-block", border: "2px dashed #b9c8e6", color: "#2563eb", background: "#f8fbff", borderRadius: 12, padding: "12px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer" };
const delBtn: React.CSSProperties = { position: "absolute", top: 5, right: 5, background: "rgba(220,38,38,.92)", color: "#fff", border: "none", width: 24, height: 24, borderRadius: 7, fontSize: 12, cursor: "pointer" };
