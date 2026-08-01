"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addEquipment, deleteEquipment } from "@/app/(app)/jobs/[id]/actions";
import { useAppLocale } from "@/components/LocaleProvider";
import { Button, Notice } from "@/components/ui";

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
      if (!r.ok) setErr(r.error ?? (he ? "לא הצלחנו לשמור" : "Could not save"));
      else {
        setAdding(false);
        router.refresh();
      }
    });
  }

  return (
    <div>
      <div className="rlist">
        {equipment.map((e) => (
          <div className="ritem" key={e.id}>
            <span style={{ fontSize: "1.25rem" }} aria-hidden="true">
              🔧
            </span>
            <div className="rmain">
              <div className="rtitle">{e.name}</div>
              <div className="rsub">
                {[e.serial ? `S/N ${e.serial}` : null, e.notes].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setErr(null);
                start(async () => {
                  const r = await deleteEquipment(e.id, jobId);
                  if (!r.ok) setErr(r.error ?? (he ? "לא הצלחנו למחוק" : "Could not delete"));
                  else router.refresh();
                });
              }}
              disabled={pending}
              style={xBtn}
              aria-label={he ? `מחיקת "${e.name}"` : `Delete "${e.name}"`}
            >
              🗑️
            </button>
          </div>
        ))}
        {equipment.length === 0 && (
          <div className="rempty">
            {he ? "עוד לא נשמר ציוד אצל הלקוח." : "No equipment recorded."}
          </div>
        )}
      </div>
      {/* A failed delete used to leave the row on screen with no explanation. */}
      {err && !adding && (
        <Notice role="alert" mt={3}>
          {err}
        </Notice>
      )}

      {!adding && (
        <Button onClick={() => setAdding(true)} size="md">
          {he ? "הוספת ציוד" : "Add equipment"}
        </Button>
      )}
      {adding && (
        <form
          action={submit}
          style={{
            background: "#f8fbff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            padding: 14,
            marginTop: 10,
          }}
        >
          <input
            name="name"
            placeholder={he ? "שם הציוד או הדגם" : "Equipment name or model"}
            aria-label={he ? "שם הציוד או הדגם" : "Equipment name or model"}
            autoFocus
            className="sp-input sp-control--lg"
          />
          <input
            name="serial"
            placeholder={he ? "מספר סידורי, אם יש" : "Serial number, if available"}
            aria-label={he ? "מספר סידורי, אם יש" : "Serial number, if available"}
            style={{ ...inp, marginTop: 8 }}
          />
          <input
            name="notes"
            placeholder={he ? "הערות" : "Notes"}
            aria-label={he ? "הערות" : "Notes"}
            style={{ ...inp, marginTop: 8 }}
          />
          {err && <Notice mt={3}>{err}</Notice>}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Button type="submit" disabled={pending} size="md">
              {pending ? (he ? "שומרים…" : "Saving…") : he ? "שמירה" : "Save"}
            </Button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}
            >
              {he ? "ביטול" : "Cancel"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  padding: "9px 15px",
  borderRadius: 10,
  fontWeight: 700,
  cursor: "pointer",
};
const xBtn: React.CSSProperties = {
  background: "#fdeaea",
  border: "none",
  borderRadius: 8,
  padding: "5px 8px",
  cursor: "pointer",
  marginInlineStart: 8,
};
const inp: React.CSSProperties = {
  width: "100%",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: "1rem",
  outline: "none",
};
