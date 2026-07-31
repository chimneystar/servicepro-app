"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { bulkImportLegacy, type LegacyRow } from "./actions";

function parseCsv(text: string): LegacyRow[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  let cols = ["name", "phone", "email", "address", "city", "history"];
  let start = 0;
  if (/name|phone|email|address|city|history/i.test(lines[0])) { cols = lines[0].split(",").map((s) => s.trim().toLowerCase()); start = 1; }
  return lines.slice(start).map((line) => {
    const parts = line.split(",").map((s) => s.trim());
    const o: Record<string, string> = {};
    cols.forEach((c, i) => (o[c] = parts[i] ?? ""));
    return { name: o.name ?? parts[0] ?? "", phone: o.phone ?? "", email: o.email ?? "", address: o.address ?? "", city: o.city ?? "", history: o.history ?? o.notes ?? "" };
  }).filter((r) => r.name);
}

export default function LegacyImportClient() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const rows = parseCsv(text);

  function run() {
    start(async () => {
      const r = await bulkImportLegacy(rows);
      setResult(r.ok ? `✓ Imported ${r.inserted} legacy records into the archive` : `✗ ${r.error}`);
      if (r.ok) { setText(""); router.refresh(); }
    });
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <Link href="/archive" style={{ color: "#2563eb", fontWeight: 700, fontSize: "0.875rem", textDecoration: "none" }}>‹ Archive</Link>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: "8px 0 6px" }}>Import old records</h1>
      <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", borderRadius: 12, padding: "11px 14px", fontSize: "0.8125rem", marginBottom: 14 }}>
        🗄️ These records go into a <b>separate archive</b> — kept for history and lookup only. They will <b>not</b> appear in your active customers, jobs, or reports, so your live data stays clean.
      </div>
      <p style={{ color: "#5c6675", fontSize: "0.875rem", marginBottom: 12 }}>
        Paste rows from your old system or spreadsheet. First line can be a header. Columns: <b>name, phone, email, address, city, history</b> (only name is required). Put past invoices/estimates/notes in the <b>history</b> column.
      </p>

      <div style={{ background: "#f4f7fb", borderRadius: 10, padding: 12, fontSize: "0.8125rem", color: "#475569", marginBottom: 12, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
        name,phone,email,address,city,history{"\n"}Jane Cohen,555-1234,jane@mail.com,12 Oak St,Austin,&quot;3 past jobs; last invoice $450 paid 2024&quot;
      </div>

      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder="Paste CSV here…"
        style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, fontSize: "0.875rem", outline: "none", fontFamily: "monospace" }} />

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
        <button onClick={run} disabled={pending || rows.length === 0} style={{ background: rows.length ? "#9a3412" : "#94a3b8", color: "#fff", border: "none", borderRadius: 12, padding: "12px 20px", fontWeight: 800, cursor: rows.length ? "pointer" : "not-allowed" }}>
          {pending ? "Importing…" : `Import ${rows.length} record${rows.length === 1 ? "" : "s"} to archive`}
        </button>
        {result && <span style={{ fontWeight: 700, color: result.startsWith("✓") ? "#15803d" : "#dc2626" }}>{result}</span>}
      </div>

      {rows.length > 0 && (
        <div className="rlist" style={{ marginTop: 16 }}>
          {rows.slice(0, 8).map((r, i) => (
            <div className="ritem" key={i}>
              <div className="rmain"><div className="rtitle">{r.name}</div><div className="rsub">{[r.phone, r.city, r.history].filter(Boolean).join(" · ")}</div></div>
            </div>
          ))}
          {rows.length > 8 && <div className="rempty">+{rows.length - 8} more</div>}
        </div>
      )}
    </div>
  );
}
