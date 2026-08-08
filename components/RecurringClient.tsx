"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import {
  savePlan,
  deletePlan,
  generateDuePlans,
  type ActionResult,
} from "@/app/(app)/recurring/actions";
import Modal from "@/components/Modal";
import { Button, Grid, Label, Notice } from "@/components/ui";

export type Plan = {
  id: string;
  customer_id: string;
  customer_name: string;
  service: string;
  interval_months: number;
  price_minor: number;
  next_due: string;
  assigned_to: string | null;
};
type Opt = { id: string; label: string };
const sym: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };

export default function RecurringClient({
  plans,
  customers,
  techs,
  currency,
  today,
}: {
  plans: Plan[];
  customers: Opt[];
  techs: Opt[];
  currency: string;
  today: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Plan | null | undefined>(undefined);
  const titleId = useId();
  const [pending, start] = useTransition();
  // The banner used to be hard-coded green, so a failure was reported in the
  // success colour. Tone is now tracked with the message.
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [state, formAction] = useFormState(savePlan, { ok: false } as ActionResult);
  const cur = sym[currency] ?? "$";
  if (state.ok && editing !== undefined)
    setTimeout(() => {
      setEditing(undefined);
      router.refresh();
    }, 0);

  const dueCount = plans.filter((p) => p.next_due <= today).length;
  function genDue() {
    start(async () => {
      const r = await generateDuePlans();
      setMsg(
        r.ok
          ? { text: `✓ Created ${r.created} job${r.created === 1 ? "" : "s"}`, ok: true }
          : { text: r.error ?? "Could not generate the due plans", ok: false },
      );
      router.refresh();
      setTimeout(() => setMsg(null), 4000);
    });
  }
  // A refused delete used to leave the plan on screen with no message at all.
  function del(id: string) {
    if (!confirm("Delete this plan?")) return;
    start(async () => {
      const r = await deletePlan(id);
      if (!r.ok) {
        setMsg({ text: r.error ?? "Could not delete this plan", ok: false });
        setTimeout(() => setMsg(null), 4000);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <div className="sp-text-muted">
          {plans.length} plans{dueCount ? ` · ${dueCount} due now` : ""}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {dueCount > 0 && (
            <button
              type="button"
              onClick={genDue}
              disabled={pending}
              style={{ ...btn, background: "#15803d" }}
            >
              <span aria-hidden="true">⚡</span> Generate {dueCount} due
            </button>
          )}
          <Button onClick={() => setEditing(null)} size="md">
            <span aria-hidden="true">➕</span> New plan
          </Button>
        </div>
      </div>
      {msg && (
        <div
          role={msg.ok ? "status" : "alert"}
          style={{
            background: msg.ok ? "#e6f6ec" : "#fdeaea",
            color: msg.ok ? "#15803d" : "#dc2626",
            padding: "9px 12px",
            borderRadius: 10,
            fontWeight: 700,
            fontSize: "0.875rem",
            marginBottom: 12,
          }}
        >
          {msg.text}
        </div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        {plans.map((p) => {
          const due = p.next_due <= today;
          return (
            <div
              key={p.id}
              style={{
                background: "#fff",
                border: `1px solid ${due ? "#f5d99b" : "#e2e8f0"}`,
                borderRadius: 12,
                padding: 14,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div className="sp-flex-fill">
                <div style={{ fontWeight: 700 }}>
                  {p.customer_name} · {p.service}
                </div>
                <div className="sp-text-muted">
                  Every {p.interval_months} mo · {cur}
                  {(p.price_minor / 100).toFixed(2)} · next {fmt(p.next_due)}
                </div>
              </div>
              {due && (
                <span className="pill" style={{ background: "#fdf1dc", color: "#b45309" }}>
                  due
                </span>
              )}
              <button
                type="button"
                onClick={() => setEditing(p)}
                style={mini}
                aria-label={`Edit ${p.customer_name} · ${p.service}`}
              >
                ✏️
              </button>
              <button
                type="button"
                onClick={() => del(p.id)}
                style={{ ...mini, background: "#fdeaea" }}
                aria-label={`Delete ${p.customer_name} · ${p.service}`}
              >
                🗑️
              </button>
            </div>
          );
        })}
        {plans.length === 0 && (
          <div className="rempty">
            No maintenance plans yet. Add one to auto-repeat annual chimney/AC visits.
          </div>
        )}
      </div>

      {editing !== undefined && (
        <Modal onClose={() => setEditing(undefined)} labelledBy={titleId} width={460}>
          <form action={formAction}>
            <h3 id={titleId} style={{ fontSize: "1.0625rem", fontWeight: 800, marginBottom: 12 }}>
              {editing ? "Edit plan" : "New maintenance plan"}
            </h3>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <label className="sp-field">
              <L>Customer</L>
              <select
                name="customer_id"
                defaultValue={editing?.customer_id ?? customers[0]?.id}
                required
                className="sp-select sp-control--lg"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="sp-field">
              <L>Service</L>
              <input
                name="service"
                defaultValue={editing?.service ?? ""}
                placeholder="e.g. Annual chimney cleaning"
                required
                className="sp-input sp-control--lg"
              />
            </label>
            <Grid cols={2}>
              <div>
                <label className="sp-field">
                  <L>Repeat every (months)</L>
                  <input
                    name="interval"
                    type="number"
                    defaultValue={editing?.interval_months ?? 12}
                    className="sp-input sp-control--lg"
                  />
                </label>
              </div>
              <div>
                <label className="sp-field">
                  <L>Price</L>
                  <input
                    name="price"
                    type="number"
                    step="0.01"
                    defaultValue={editing ? (editing.price_minor / 100).toFixed(2) : ""}
                    placeholder="0.00"
                    className="sp-input sp-control--lg"
                  />
                </label>
              </div>
            </Grid>
            <Grid cols={2}>
              <div>
                <label className="sp-field">
                  <L>Next due date</L>
                  <input
                    name="next_due"
                    type="date"
                    defaultValue={editing?.next_due ?? today}
                    className="sp-input sp-control--lg"
                  />
                </label>
              </div>
              <div>
                <label className="sp-field">
                  <L>Technician</L>
                  <select
                    name="assigned_to"
                    defaultValue={editing?.assigned_to ?? ""}
                    className="sp-select sp-control--lg"
                  >
                    <option value="">Unassigned</option>
                    {techs.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </Grid>
            {state.error && <Notice>{state.error}</Notice>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <Save />
              <button
                type="button"
                onClick={() => setEditing(undefined)}
                style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="md">
      {pending ? "Saving…" : "💾 Save"}
    </Button>
  );
}
function L({ children }: { children: React.ReactNode }) {
  return <Label>{children}</Label>;
}
function fmt(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
const btn: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  padding: "9px 15px",
  borderRadius: 10,
  fontWeight: 700,
  cursor: "pointer",
};
const mini: React.CSSProperties = {
  background: "#eef2f8",
  border: "none",
  borderRadius: 8,
  padding: "5px 8px",
  cursor: "pointer",
  fontSize: "0.875rem",
  flexShrink: 0,
};
