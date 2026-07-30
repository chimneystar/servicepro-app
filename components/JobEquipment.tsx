"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addEquipment, deleteEquipment } from "@/app/(app)/jobs/[id]/actions";
import { useAppLocale } from "@/components/LocaleProvider";

export type Equip = { id: string; name: string; serial: string | null; notes: string | null };

export default function JobEquipment({ jobId, equipment }: { jobId: string; equipment: Equip[] }) {
  const router = useRouter();
  const he = useAppLocale() === "he";
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function submit(formData: FormData) {
    setErr(null);
    start(async () => {
      const r = await addEquipment(jobId, formData);
      if (!r.ok) setErr(r.error ?? (he ? "לא הצלחנו לשמור" : "Could not save")); else { setAdding(false); router.refresh(); }
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
        {equipment.length === 0 && <div className="rempty">{he ? "עוד לא נשמר ציוד אצל הלקוח." : "No equipment recorded."}</div>}
      </div>

      {!adding && <button onClick={() => setAdding(true)} style={btn}>{he ? "הוספת ציוד" : "Add equipment"}</button>}
      {adding && (
        <form action={submit} style={{ background: "#f8fbff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, marginTop: 10 }}>
          <input name="name" placeholder={he ? "שם הציוד או הדגם" : "Equipment name or model"} style={inp} autoFocus />
          <input name="serial" placeholder={he ? "מספר סידורי, אם יש" : "Serial number, if available"} style={{ ...inp, marginTop: 8 }} />
          <input name="notes" placeholder={he ? "הערות" : "Notes"} style={{ ...inp, marginTop: 8 }} />
          {err && <div style={errBox}>{err}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="submit" disabled={pending} style={btn}>{pending ? (he ? "שומרים…" : "Saving…") : (he ? "שמירה" : "Save")}</button>
            <button type="button" onClick={() => setAdding(false)} style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}>{he ? "ביטול" : "Cancel"}</button>
          </div>
        </form>
      )}
    </div>
  );
}

const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "9px 15px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const xBtn: React.CSSProperties = { background: "#fdeaea", border: "none", borderRadius: 8, padding: "5px 8px", cursor: "pointer", marginInlineStart: 8 };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 16, outline: "none" };
const errBox: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "8px 12px", borderRadius: 10, fontSize: 14, marginTop: 8 };
