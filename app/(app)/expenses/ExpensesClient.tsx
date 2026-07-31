"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { addExpense, deleteExpense, type ActionResult } from "./actions";
import { t, type Locale } from "@/lib/i18n";
import Modal from "@/components/Modal";

type Expense = { id: string; expense_date: string; category: string; vendor: string | null; amount_minor: number };
const initial: ActionResult = { ok: false };
const sym: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };
const CATS = ["Vehicle & fuel", "Materials", "Payroll", "Marketing", "Insurance", "Office", "Software", "Other"];

export default function ExpensesClient({ locale, expenses, currency, monthTotal, net }: {
  locale: Locale; expenses: Expense[]; currency: string; monthTotal: number; net: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const [state, formAction] = useFormState(addExpense, initial);
  const cur = sym[currency] ?? "$";
  const m = (v: number) => cur + (v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const d = (iso: string) => { const x = new Date(iso + "T00:00:00"); return `${x.getDate()}/${x.getMonth() + 1}`; };
  if (state.ok && open) setTimeout(() => { setOpen(false); router.refresh(); }, 0);
  async function del(id: string) { if (!confirm("Delete this expense?")) return; await deleteExpense(id); router.refresh(); }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>{t(locale, "exp.title")}</h1>
        <button type="button" onClick={() => setOpen(true)} style={btn}><span aria-hidden="true">➕</span> {t(locale, "exp.new")}</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <Kpi label={t(locale, "exp.month")} value={m(monthTotal)} tone="#b45309" />
        <Kpi label={t(locale, "exp.net")} value={m(net)} tone={net >= 0 ? "#15803d" : "#dc2626"} />
      </div>

      <div className="rlist">
        {expenses.map((e) => (
          <div className="ritem" key={e.id}>
            <div className="avatar-sm" style={{ background: "#fdeaea", color: "#dc2626", fontSize: 16 }}>💸</div>
            <div className="rmain">
              <div className="rtitle">{e.category}</div>
              <div className="rsub">{e.vendor || ""}{e.vendor ? " · " : ""}{d(e.expense_date)}</div>
            </div>
            <div className="rend">
              <b style={{ fontSize: 15 }}>{m(e.amount_minor)}</b>
              <button type="button" onClick={() => del(e.id)} style={{ background: "#fdeaea", border: "none", borderRadius: 8, padding: "4px 8px", cursor: "pointer", fontSize: 12 }} aria-label={t(locale, "common.delete")}>🗑️</button>
            </div>
          </div>
        ))}
        {expenses.length === 0 && <div className="rempty">{t(locale, "exp.empty")}</div>}
      </div>

      {open && (
        <Modal onClose={() => setOpen(false)} labelledBy={titleId} width={440}>
          <form action={formAction}>
            <h3 id={titleId} style={{ fontSize: 18, fontWeight: 800, marginBottom: 14 }}>{t(locale, "exp.new")}</h3>
            <div style={two}>
              <div><label style={{ display: "block" }}><L>{t(locale, "exp.date")}</L><input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} style={inp} /></label></div>
              <div><label style={{ display: "block" }}><L>{t(locale, "exp.amount")}</L><input name="amount" type="number" step="0.01" style={inp} placeholder="0.00" required /></label></div>
            </div>
            <label style={{ display: "block" }}>
              <L>{t(locale, "exp.category")}</L>
              <select name="category" style={inp} defaultValue={CATS[0]}>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
            <label style={{ display: "block" }}><L>{t(locale, "exp.vendor")}</L><input name="vendor" style={inp} /></label>
            {state.error && <div style={err}>{state.error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <Save locale={locale} />
              <button type="button" onClick={() => setOpen(false)} style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}>{t(locale, "common.cancel")}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 15, boxShadow: "0 6px 18px rgba(15,42,94,.06)" }}><div style={{ fontSize: 22, fontWeight: 800, color: tone }}>{value}</div><div style={{ fontSize: 12.5, color: "#5c6675", fontWeight: 600 }}>{label}</div></div>;
}
function Save({ locale }: { locale: Locale }) { const { pending } = useFormStatus(); return <button type="submit" disabled={pending} style={btn}>{pending ? t(locale, "common.saving") : `💾 ${t(locale, "common.save")}`}</button>; }
function L({ children }: { children: React.ReactNode }) { return <span style={lbl}>{children}</span>; }

const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "10px 16px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const two: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", margin: "10px 0 6px" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none" };
const err: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "9px 12px", borderRadius: 10, fontSize: 13, marginTop: 10 };
