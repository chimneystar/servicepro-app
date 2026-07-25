"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function TopBar({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  function submit(e: React.FormEvent) { e.preventDefault(); const s = q.trim(); if (s) router.push(`/search?q=${encodeURIComponent(s)}`); }

  return (
    <div className="topbar">
      <form onSubmit={submit} style={{ flex: 1, maxWidth: 520, position: "relative" }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }}>🔍</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients, jobs, invoices, estimates…"
          style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 12px 10px 38px", fontSize: 14, outline: "none", background: "#fff" }} />
      </form>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {canManage && <Link href="/messages" title="Messages" style={icon}>💬</Link>}
        {canManage && <Link href="/settings" title="Settings" style={icon}>⚙️</Link>}
      </div>
    </div>
  );
}

const icon: React.CSSProperties = { width: 40, height: 40, borderRadius: 10, background: "#fff", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, textDecoration: "none" };
