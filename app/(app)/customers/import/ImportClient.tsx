"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { bulkImportCustomers } from "./actions";

type Row = { name: string; phone: string; email: string; city: string };

function parseCsv(text: string): Row[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  let cols = ["name", "phone", "email", "city"];
  let start = 0;
  if (/name|phone|email|city/i.test(lines[0])) { cols = lines[0].split(",").map((s) => s.trim().toLowerCase()); start = 1; }
  return lines.slice(start).map((line) => {
    const parts = line.split(",").map((s) => s.trim());
    const o: Record<string, string> = {};
    cols.forEach((c, i) => (o[c] = parts[i] ?? ""));
    return { name: o.name ?? parts[0] ?? "", phone: o.phone ?? "", email: o.email ?? "", city: o.city ?? "" };
  }).filter((r) => r.name);
}

export default function ImportClient() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const rows = parseCsv(text);

  function run() {
    start(async () => {
      const r = await bulkImportCustomers(rows);
      setResult(r.ok ? `✓ Imported ${r.inserted} customers` : `✗ ${r.error}`);
      if (r.ok) { setText(""); router.refresh(); }
    });
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <Link href="/customers" style={{ color: "#2563eb", fontWeight: 700, fontSize: "0.875rem", textDecoration: "none" }}>‹ Customers</Link>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: "8px 0 6px" }}>Import customers</h1>
      <p style={{ color: "#5c6675", fontSize: "0.875rem", marginBottom: 14 }}>
        Paste rows from your spreadsheet. First line can be a header. Columns: <b>name, phone, email, city</b> (only name is required).
      </p>

      <div style={{ background: "#f4f7fb", borderRadius: 10, padding: 12, fontSize: "0.8125rem", color: "#475569", marginBottom: 12, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
        name,phone,email,city{"\n"}Jane Cohen,555-1234,jane@mail.com,Austin{"\n"}Mike Ross,555-9876,,Dallas
      </div>

      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder="Paste CSV here…" aria-label="Paste CSV here…"
        style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, fontSize: "0.875rem", outline: "none", fontFamily: "monospace" }} />

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
        <button type="button" onClick={run} disabled={pending || rows.length === 0} style={{ background: rows.length ? "#2563eb" : "#94a3b8", color: "#fff", border: "none", borderRadius: 12, padding: "12px 20px", fontWeight: 800, cursor: rows.length ? "pointer" : "not-allowed" }}>
          {pending ? "Importing…" : `Import ${rows.length} customer${rows.length === 1 ? "" : "s"}`}
        </button>
        {result && <span style={{ fontWeight: 700, color: result.startsWith("✓") ? "#15803d" : "#dc2626" }}>{result}</span>}
      </div>

      {rows.length > 0 && (
        <div className="rlist" style={{ marginTop: 16 }}>
          {rows.slice(0, 8).map((r, i) => (
            <div className="ritem" key={i}>
              <div className="rmain"><div className="rtitle">{r.name}</div><div className="rsub">{[r.phone, r.city].filter(Boolean).join(" · ")}</div></div>
            </div>
          ))}
          {rows.length > 8 && <div className="rempty">+{rows.length - 8} more</div>}
        </div>
      )}
    </div>
  );
}
