"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateLeadStatus, convertLead, deleteLead } from "./actions";
import { ActionError, useActionStatus } from "@/components/ActionStatus";

export type Lead = {
  id: string; name: string; phone: string | null; email: string | null; address: string | null; city: string | null;
  service: string | null; notes: string | null; status: string; source: string | null; preferred_date: string | null; created_at: string;
};

const STATUSES: [string, string, string][] = [
  ["new", "New", "#e0ebff|#2563eb"], ["contacted", "Contacted", "#ede9fe|#7c3aed"],
  ["quoted", "Quoted", "#fdf1dc|#b45309"], ["won", "Won", "#e6f6ec|#15803d"], ["lost", "Lost", "#fdeaea|#dc2626"],
];

export default function LeadsBoard({ leads, orgId }: { leads: Lead[]; orgId: string }) {
  const router = useRouter();
  // Pipeline stage, conversion and deletion all used to fail without a word:
  // the select snapped back on the next refresh and the lead stayed where it
  // was, which reads as "the app is slow", not "that did not save".
  const { pending, error, run } = useActionStatus();
  const [filter, setFilter] = useState("open");
  const [copied, setCopied] = useState(false);

  const shown = leads.filter((l) => filter === "all" ? true : filter === "open" ? !["won", "lost"].includes(l.status) : l.status === filter);
  const count = (s: string) => leads.filter((l) => l.status === s).length;
  const openCount = leads.filter((l) => !["won", "lost"].includes(l.status)).length;

  function bookingLink() { return `${window.location.origin}/book/${orgId}`; }
  function copyLink() { navigator.clipboard?.writeText(bookingLink()).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1600); }
  function setStatus(id: string, s: string) { run(() => updateLeadStatus(id, s), () => router.refresh()); }
  function convert(l: Lead) {
    if (!confirm(`Add ${l.name} to your customers?`)) return;
    let customerId: string | undefined;
    run(async () => { const r = await convertLead(l.id); customerId = r.customerId; return r; },
      () => { if (customerId) router.push(`/customers/${customerId}`); else router.refresh(); });
  }
  function remove(id: string) { if (!confirm("Delete this lead?")) return; run(() => deleteLead(id), () => router.refresh()); }

  return (
    <div>
      {/* Booking link card */}
      <div style={{ background: "#0f2a5e", color: "#fff", borderRadius: 14, padding: 16, marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: "0.9375rem", marginBottom: 4 }}>🔗 Your online booking link</div>
        <div style={{ fontSize: "0.8125rem", opacity: .85, marginBottom: 10 }}>Share this so clients can request appointments. Each request shows up here as a lead.</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input readOnly value={typeof window !== "undefined" ? bookingLink() : ""} style={{ flex: 1, border: "none", borderRadius: 9, padding: "9px 11px", fontSize: "0.8125rem", color: "#0b1524" }} />
          <button onClick={copyLink} style={{ background: "#fff", color: "#2563eb", border: "none", borderRadius: 9, padding: "9px 14px", fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>{copied ? "✓ Copied" : "Copy"}</button>
        </div>
      </div>

      <div className="scroll-x" style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <Tab k="open" label={`Open (${openCount})`} filter={filter} setFilter={setFilter} />
        {STATUSES.map(([s, label]) => <Tab key={s} k={s} label={`${label} (${count(s)})`} filter={filter} setFilter={setFilter} />)}
        <Tab k="all" label={`All (${leads.length})`} filter={filter} setFilter={setFilter} />
      </div>

      <ActionError error={error} style={{ marginTop: 0, marginBottom: 10 }} />

      <div style={{ display: "grid", gap: 10 }}>
        {shown.map((l) => {
          const meta = STATUSES.find((s) => s[0] === l.status)!;
          const [bg, fg] = meta[2].split("|");
          return (
            <div key={l.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: "0.9375rem" }}>{l.name}</div>
                  <div style={{ fontSize: "0.8125rem", color: "#5c6675" }}>{[l.service, l.city].filter(Boolean).join(" · ") || "—"}</div>
                  {l.preferred_date && <div style={{ fontSize: "0.8125rem", color: "#5c6675" }}>📅 Prefers {new Date(l.preferred_date + "T00:00:00").toLocaleDateString("en-US")}</div>}
                  {l.notes && <div style={{ fontSize: "0.8125rem", color: "#475569", marginTop: 4 }}>{l.notes}</div>}
                </div>
                <span className="pill" style={{ background: bg, color: fg }}>{meta[1]}</span>
              </div>
              <div style={{ display: "flex", gap: 14, margin: "10px 0" }}>
                {l.phone && <a href={"tel:" + l.phone.replace(/[^0-9+]/g, "")} style={clink}>📞 Call</a>}
                {l.phone && <a href={"sms:" + l.phone} style={clink}>💬 Text</a>}
                {l.email && <a href={"mailto:" + l.email} style={clink}>✉️ Email</a>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select value={l.status} onChange={(e) => setStatus(l.id, e.target.value)} disabled={pending} style={sel}>
                  {STATUSES.map(([s, label]) => <option key={s} value={s}>{label}</option>)}
                </select>
                {l.status !== "won" && <button onClick={() => convert(l)} disabled={pending} style={{ ...btn, background: "#e6f6ec", color: "#15803d" }}>➕ Add as customer</button>}
                <button onClick={() => remove(l.id)} disabled={pending} style={{ ...btn, background: "#fdeaea", color: "#dc2626" }}>🗑️</button>
              </div>
            </div>
          );
        })}
        {shown.length === 0 && <div className="rempty">No leads here yet. Share your booking link to start getting requests.</div>}
      </div>
    </div>
  );
}

function Tab({ k, label, filter, setFilter }: { k: string; label: string; filter: string; setFilter: (s: string) => void }) {
  const on = filter === k;
  return <button onClick={() => setFilter(k)} style={{ border: "none", borderRadius: 9, padding: "7px 12px", fontWeight: 700, fontSize: "0.8125rem", whiteSpace: "nowrap", cursor: "pointer", background: on ? "#2563eb" : "#eef2f8", color: on ? "#fff" : "#5c6675" }}>{label}</button>;
}
const clink: React.CSSProperties = { color: "#2563eb", textDecoration: "none", fontWeight: 700, fontSize: "0.8125rem" };
const btn: React.CSSProperties = { border: "none", borderRadius: 9, padding: "8px 12px", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer" };
const sel: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 9, padding: "8px 10px", fontSize: "0.8125rem", fontWeight: 600, background: "#fff" };
