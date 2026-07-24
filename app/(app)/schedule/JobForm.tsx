"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createJob, type ActionResult } from "./actions";
import { t, type Locale } from "@/lib/i18n";

const initial: ActionResult = { ok: false };
const DEFAULT_SERVICES = ["AC Cleaning", "AC Install", "AC Repair", "Annual Maintenance", "Plumbing", "Electrical", "Renovation", "Other"];

type Opt = { id: string; label: string };
export type JobTypeOpt = { name: string; color?: string; duration_min?: number; default_price_minor?: number };

function addMinutes(hhmm: string, min: number) {
  const [h, m] = hhmm.split(":").map(Number);
  let total = h * 60 + m + min;
  total = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export default function JobForm({ locale, customers, techs, jobTypes }: { locale: Locale; customers: Opt[]; techs: Opt[]; jobTypes?: JobTypeOpt[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(createJob, initial);
  const types: JobTypeOpt[] = jobTypes && jobTypes.length ? jobTypes : DEFAULT_SERVICES.map((name) => ({ name }));

  const [service, setService] = useState(types[0]?.name ?? "");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [price, setPrice] = useState("");
  const [customer, setCustomer] = useState(customers[0]?.id ?? "__new__");

  if (state.ok && open) setTimeout(() => setOpen(false), 0);

  function applyType(name: string, startTime = start) {
    setService(name);
    const tp = types.find((x) => x.name === name);
    if (tp?.duration_min) setEnd(addMinutes(startTime, tp.duration_min));
    if (tp?.default_price_minor) setPrice((tp.default_price_minor / 100).toFixed(2));
  }
  function onStart(v: string) {
    setStart(v);
    const tp = types.find((x) => x.name === service);
    if (tp?.duration_min) setEnd(addMinutes(v, tp.duration_min));
  }

  return (
    <>
      <button onClick={() => setOpen(true)} style={btn}>➕ {t(locale, "sched.new")}</button>
      {open && (
        <div style={overlay} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form action={formAction} style={modal}>
            <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 14 }}>{t(locale, "sched.new")}</h3>
            <Label>{t(locale, "doc.customer")}</Label>
            <select name="customer_id" value={customer} onChange={(e) => setCustomer(e.target.value)} style={inp}>
              <option value="__new__">➕ {t(locale, "cust.new")}</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            {customer === "__new__" && (
              <div style={{ background: "#f8fbff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, marginTop: 8 }}>
                <Row>
                  <div><Label>{t(locale, "form.name")}</Label><input name="new_name" style={inp} /></div>
                  <div><Label>{t(locale, "form.phone")}</Label><input name="new_phone" style={inp} /></div>
                </Row>
                <Row>
                  <div><Label>{t(locale, "form.email")}</Label><input name="new_email" type="email" style={inp} /></div>
                  <div><Label>{t(locale, "form.city")}</Label><input name="new_city" style={inp} /></div>
                </Row>
                <Label>{t(locale, "form.address")}</Label><input name="new_address" style={inp} />
              </div>
            )}
            <Row>
              <div>
                <Label>{t(locale, "job.service")}</Label>
                <select name="service" value={service} onChange={(e) => applyType(e.target.value)} style={inp}>
                  {types.map((s) => <option key={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <Label>{t(locale, "job.tech")}</Label>
                <select name="assigned_to" style={inp}>
                  <option value="">{t(locale, "job.unassigned")}</option>
                  {techs.map((tt) => <option key={tt.id} value={tt.id}>{tt.label}</option>)}
                </select>
              </div>
            </Row>
            <Row>
              <div><Label>{t(locale, "job.date")}</Label><input name="date" type="date" style={inp} required /></div>
              <div><Label>{t(locale, "job.price")}</Label><input name="price" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} style={inp} placeholder="0.00" /></div>
            </Row>
            <Row>
              <div><Label>{t(locale, "job.start")}</Label><input name="start" type="time" value={start} onChange={(e) => onStart(e.target.value)} style={inp} /></div>
              <div><Label>{t(locale, "job.end")}</Label><input name="end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={inp} /></div>
            </Row>
            <Label>{t(locale, "form.notes")}</Label>
            <textarea name="notes" rows={2} style={inp} />
            {state.error && <div style={err}>{state.error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <Save locale={locale} />
              <button type="button" onClick={() => setOpen(false)} style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}>{t(locale, "common.cancel")}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function Save({ locale }: { locale: Locale }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} style={btn}>{pending ? t(locale, "common.saving") : `💾 ${t(locale, "common.save")}`}</button>;
}
function Label({ children }: { children: React.ReactNode }) { return <label style={lbl}>{children}</label>; }
function Row({ children }: { children: React.ReactNode }) { return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{children}</div>; }

const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "10px 16px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15,30,61,.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, zIndex: 100, overflowY: "auto" };
const modal: React.CSSProperties = { background: "#fff", borderRadius: 18, width: "100%", maxWidth: 500, padding: 22 };
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", margin: "10px 0 6px" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none" };
const err: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "9px 12px", borderRadius: 10, fontSize: 13, marginTop: 12 };
