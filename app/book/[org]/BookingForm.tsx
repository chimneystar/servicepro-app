"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import AddressAutocomplete from "@/components/AddressAutocomplete";

export default function BookingForm({ orgId, accent, phone }: { orgId: string; accent: string; phone?: string | null }) {
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", phone: "", email: "", address: "", city: "", service: "", notes: "", date: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim() || !f.phone.trim()) { setError("Please enter your name and phone."); return; }
    setBusy(true); setError(null);
    const { data, error } = await supabase.rpc("submit_booking", {
      p_org: orgId, p_name: f.name, p_phone: f.phone, p_email: f.email,
      p_address: f.address, p_city: f.city, p_service: f.service, p_notes: f.notes,
      p_date: f.date || null,
    });
    setBusy(false);
    if (error || data === false) { setError("Something went wrong. Please call us instead."); return; }
    setDone(true);
  }

  if (done) return (
    <div style={{ textAlign: "center", padding: "20px 6px" }}>
      <div style={{ fontSize: 44 }}>✅</div>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: "8px 0" }}>Request received!</h2>
      <p style={{ color: "#5c6675", fontSize: 14 }}>Thanks {f.name.split(" ")[0]} — we’ll reach out shortly to confirm your appointment.{phone ? ` For anything urgent, call ${phone}.` : ""}</p>
    </div>
  );

  return (
    <form onSubmit={submit}>
      <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Request an appointment</h2>
      <p style={{ color: "#5c6675", fontSize: 13, marginBottom: 14 }}>Fill this out and we’ll get right back to you.</p>
      <Row><F label="Your name *" v={f.name} on={(v) => set("name", v)} /><F label="Phone *" v={f.phone} on={(v) => set("phone", v)} type="tel" /></Row>
      <F label="Email" v={f.email} on={(v) => set("email", v)} type="email" />
      <label style={lbl}>Address</label>
      <AddressAutocomplete value={f.address} city={f.city} onChange={(v) => set("address", v)} onCity={(v) => set("city", v)} />
      <Row><F label="Service needed" v={f.service} on={(v) => set("service", v)} placeholder="e.g. Chimney cleaning" /><F label="Preferred date" v={f.date} on={(v) => set("date", v)} type="date" /></Row>
      <label style={lbl}>Anything else?</label>
      <textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={3} style={inp} placeholder="Tell us about the job…" />
      {error && <div style={{ background: "#fdeaea", color: "#dc2626", padding: "9px 12px", borderRadius: 10, fontSize: 13, marginTop: 10 }}>{error}</div>}
      <button type="submit" disabled={busy} style={{ width: "100%", background: accent, color: "#fff", border: "none", borderRadius: 12, padding: 14, fontWeight: 800, fontSize: 15, marginTop: 14, cursor: "pointer" }}>
        {busy ? "Sending…" : "Request appointment"}
      </button>
    </form>
  );
}

function Row({ children }: { children: React.ReactNode }) { return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{children}</div>; }
function F({ label, v, on, type = "text", placeholder }: { label: string; v: string; on: (v: string) => void; type?: string; placeholder?: string }) {
  return <div><label style={lbl}>{label}</label><input value={v} onChange={(e) => on(e.target.value)} type={type} placeholder={placeholder} style={inp} /></div>;
}
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", margin: "8px 0 5px" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "11px 12px", fontSize: 16, outline: "none" };
