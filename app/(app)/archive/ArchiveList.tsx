"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { restoreFromArchive } from "./actions";
import { ActionError, useActionStatus } from "@/components/ActionStatus";

export type ArchRow = { id: string; name: string; phone: string | null; email: string | null; address: string | null; city: string | null; legacy_note: string | null };

export default function ArchiveList({ records }: { records: ArchRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const { pending, error, run } = useActionStatus();
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return records;
    return records.filter((r) => [r.name, r.phone, r.email, r.address, r.city, r.legacy_note].some((f) => (f ?? "").toLowerCase().includes(s)));
  }, [q, records]);

  function restore(id: string) {
    if (!confirm("Move this record into your active customers?")) return;
    // A failed restore used to leave the row sitting in the archive with the
    // operator convinced the customer had been brought back.
    run(() => restoreFromArchive(id), () => router.refresh());
  }

  return (
    <div>
      <div style={{ position: "relative", marginBottom: 12 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }}>🔍</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search archived records…" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 38px", fontSize: "1rem", outline: "none" }} />
      </div>
      <ActionError error={error} style={{ marginTop: 0, marginBottom: 10 }} />
      <div style={{ display: "grid", gap: 8 }}>
        {filtered.map((r) => (
          <div key={r.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800 }}>{r.name} <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#9a3412", background: "#fff7ed", borderRadius: 6, padding: "2px 6px", marginInlineStart: 4 }}>ARCHIVED</span></div>
                <div style={{ fontSize: "0.8125rem", color: "#5c6675" }}>{[r.phone, r.email, [r.address, r.city].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</div>
                {r.legacy_note && <div style={{ fontSize: "0.8125rem", color: "#475569", marginTop: 4 }}>🗒️ {r.legacy_note}</div>}
              </div>
              <button onClick={() => restore(r.id)} disabled={pending} style={{ background: "#e0ebff", color: "#2563eb", border: "none", borderRadius: 9, padding: "7px 11px", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer", flexShrink: 0 }}>↩ Restore</button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="rempty">{q ? "No archived records match." : "No archived records yet."}</div>}
      </div>
    </div>
  );
}
