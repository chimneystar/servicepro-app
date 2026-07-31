"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

export type Cust = { id: string; name: string; phone: string | null; city: string | null; address: string | null; email: string | null; source: string | null };

const AC = ["#2563eb", "#16a34a", "#d97706", "#7c3aed", "#db2777", "#0891b2"];
function initials(n: string) { const p = (n || "?").trim().split(" "); return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase(); }
function colorFor(s: string) { let h = 0; for (let i = 0; i < (s || "").length; i++) h = s.charCodeAt(i) + ((h << 5) - h); return AC[Math.abs(h) % AC.length]; }

export default function CustomerList({ customers, emptyText }: { customers: Cust[]; emptyText: string }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return customers;
    return customers.filter((c) =>
      [c.name, c.phone, c.city, c.address, c.email].some((f) => (f ?? "").toLowerCase().includes(s))
    );
  }, [q, customers]);

  return (
    <div>
      <div style={{ position: "relative", marginBottom: 12 }}>
        <span aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: "0.9375rem", color: "#94a3b8" }}>🔍</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, address, or phone…"
          aria-label="Search by name, address, or phone…"
          style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 38px", fontSize: "1rem", outline: "none" }}
        />
        {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", border: "none", background: "#eef2f8", borderRadius: 8, padding: "4px 8px", cursor: "pointer", color: "#5c6675" }}>✕</button>}
      </div>
      {q && <div style={{ fontSize: "0.8125rem", color: "#5c6675", margin: "0 4px 8px" }}>{filtered.length} match{filtered.length === 1 ? "" : "es"}</div>}

      <div className="rlist">
        {filtered.map((c) => (
          <Link className="ritem" href={`/customers/${c.id}`} key={c.id}>
            <div className="avatar-sm" style={{ background: colorFor(c.name) }}>{initials(c.name)}</div>
            <div className="rmain">
              <div className="rtitle">{c.name}</div>
              <div className="rsub">{c.phone}{c.city ? ` · ${c.city}` : ""}</div>
            </div>
            {c.source && <span className="pill" style={{ background: "#eef1f6", color: "#57606f" }}>{c.source}</span>}
            <span aria-hidden="true" style={{ color: "#b6bfcc", fontSize: "1.125rem" }}>›</span>
          </Link>
        ))}
        {filtered.length === 0 && <div className="rempty">{q ? "No customers match your search." : emptyText}</div>}
      </div>
    </div>
  );
}
