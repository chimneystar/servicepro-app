"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { addExpense, deleteExpense, type ActionResult } from "./actions";
import { t, type Locale } from "@/lib/i18n";
import Modal from "@/components/Modal";
import { Button, Grid, Label, Notice } from "@/components/ui";

type Expense = {
  id: string;
  expense_date: string;
  category: string;
  vendor: string | null;
  amount_minor: number;
};
const initial: ActionResult = { ok: false };
const sym: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };
const CATS = [
  "Vehicle & fuel",
  "Materials",
  "Payroll",
  "Marketing",
  "Insurance",
  "Office",
  "Software",
  "Other",
];

export default function ExpensesClient({
  locale,
  expenses,
  currency,
  monthTotal,
  net,
}: {
  locale: Locale;
  expenses: Expense[];
  currency: string;
  monthTotal: number;
  net: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const [state, formAction] = useFormState(addExpense, initial);
  const cur = sym[currency] ?? "$";
  const m = (v: number) =>
    cur + (v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const d = (iso: string) => {
    const x = new Date(iso + "T00:00:00");
    return `${x.getDate()}/${x.getMonth() + 1}`;
  };
  if (state.ok && open)
    setTimeout(() => {
      setOpen(false);
      router.refresh();
    }, 0);
  async function del(id: string) {
    if (!confirm("Delete this expense?")) return;
    await deleteExpense(id);
    router.refresh();
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h1 className="sp-heading sp-heading--lg">{t(locale, "exp.title")}</h1>
        <Button onClick={() => setOpen(true)}>
          <span aria-hidden="true">➕</span> {t(locale, "exp.new")}
        </Button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <Kpi label={t(locale, "exp.month")} value={m(monthTotal)} tone="#b45309" />
        <Kpi label={t(locale, "exp.net")} value={m(net)} tone={net >= 0 ? "#15803d" : "#dc2626"} />
      </div>

      <div className="rlist">
        {expenses.map((e) => (
          <div className="ritem" key={e.id}>
            <div
              className="avatar-sm"
              style={{ background: "#fdeaea", color: "#dc2626", fontSize: "1rem" }}
            >
              💸
            </div>
            <div className="rmain">
              <div className="rtitle">{e.category}</div>
              <div className="rsub">
                {e.vendor || ""}
                {e.vendor ? " · " : ""}
                {d(e.expense_date)}
              </div>
            </div>
            <div className="rend">
              <b style={{ fontSize: "0.9375rem" }}>{m(e.amount_minor)}</b>
              <button
                type="button"
                onClick={() => del(e.id)}
                style={{
                  background: "#fdeaea",
                  border: "none",
                  borderRadius: 8,
                  padding: "4px 8px",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                }}
                aria-label={t(locale, "common.delete")}
              >
                🗑️
              </button>
            </div>
          </div>
        ))}
        {expenses.length === 0 && <div className="rempty">{t(locale, "exp.empty")}</div>}
      </div>

      {open && (
        <Modal onClose={() => setOpen(false)} labelledBy={titleId} width={440}>
          <form action={formAction}>
            <h3 id={titleId} style={{ fontSize: "1.125rem", fontWeight: 800, marginBottom: 14 }}>
              {t(locale, "exp.new")}
            </h3>
            <Grid cols={2}>
              <div>
                <label className="sp-field">
                  <L>{t(locale, "exp.date")}</L>
                  <input
                    name="date"
                    type="date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    className="sp-input"
                  />
                </label>
              </div>
              <div>
                <label className="sp-field">
                  <L>{t(locale, "exp.amount")}</L>
                  <input
                    name="amount"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    required
                    className="sp-input"
                  />
                </label>
              </div>
            </Grid>
            <label className="sp-field">
              <L>{t(locale, "exp.category")}</L>
              <select name="category" defaultValue={CATS[0]} className="sp-select">
                {CATS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="sp-field">
              <L>{t(locale, "exp.vendor")}</L>
              <input name="vendor" className="sp-input" />
            </label>
            {state.error && <Notice>{state.error}</Notice>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <Save locale={locale} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}
              >
                {t(locale, "common.cancel")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 14,
        padding: 15,
        boxShadow: "0 6px 18px rgba(15,42,94,.06)",
      }}
    >
      <div style={{ fontSize: "1.375rem", fontWeight: 800, color: tone }}>{value}</div>
      <div style={{ fontSize: "0.8125rem", color: "#5c6675", fontWeight: 600 }}>{label}</div>
    </div>
  );
}
function Save({ locale }: { locale: Locale }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t(locale, "common.saving") : `💾 ${t(locale, "common.save")}`}
    </Button>
  );
}
function L({ children }: { children: React.ReactNode }) {
  return <Label>{children}</Label>;
}

const btn: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  padding: "10px 16px",
  borderRadius: 10,
  fontWeight: 700,
  cursor: "pointer",
};
