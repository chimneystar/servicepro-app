"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addEquipment, deleteEquipment } from "@/app/(app)/jobs/[id]/actions";

export type Equip = { id: string; name: string; serial: string | null; notes: string | null };

export default function JobEquipment({ jobId, equipment }: { jobId: string; equipment: Equip[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function submit(formData: FormData) {
    setErr(null);
    start(async () => {
      const r = await addEquipment(jobId, formData);
      if (!r.ok) setErr(r.error ?? "Error"); else { setAdding(false); router.refresh(); }
    });
  }

  return (
    <div>
      <div className="rlist">
        {equipment.map((e) => (
          <div className="ritem" key={e.id}>
            <span style={{ fontSize: 20 }}>🔧</span>
            <div className="rmain">
              <div className="rtitle">{e.name}</div>
              <div className="rsub">{[e.serial ? `S/N ${e.serial}` : null, e.notes].filter(Boolean).join(" · ") || "—"}</div>
            </div>
            <button onClick={() => start(async () => { await deleteEquipment(e.id, jobId); router.refresh(); })} disabled={pending} style={xBtn}>🗑️</button>
          </div>
        ))}
        {equipment.length === 0 && <div className="rempty">No equipment recorded.</div>}
      </div>

      {!adding && <button onClick={() => setAdding(true)} style={btn}>➕ Add equipment</button>}
      {adding && (
        <form action={submit} style={{ background: "#f8fbff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, marginTop: 10 }}>
          <input name="name" placeholder="Equipment name (e.g. AC unit, model)" style={inp} autoFocus />
          <input name="serial" placeholder="Serial number (optional)" style={{ ...inp, marginTop: 8 }} />
          <input name="notes" placeholder="Notes (optional)" style={{ ...inp, marginTop: 8 }} />
          {err && <div style={errBox}>{err}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="submit" disabled={pending} style={btn}>{pending ? "Saving…" : "💾 Save"}</button>
            <button type="button" onClick={() => setAdding(false)} style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "9px 15px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const xBtn: React.CSSProperties = { background: "#fdeaea", border: "none", borderRadius: 8, padding: "5px 8px", cursor: "pointer", marginInlineStart: 8 };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 16, outline: "none" };
const errBox: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "8px 12px", borderRadius: 10, fontSize: 13, marginTop: 8 };
