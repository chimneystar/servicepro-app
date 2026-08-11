"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { updateCustomer, type ActionResult } from "@/app/(app)/customers/actions";
import Modal from "@/components/Modal";
import { Button, Notice } from "@/components/ui";

export type EditCust = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  billing_address: string | null;
  billing_city: string | null;
  notes: string | null;
};

export default function CustomerEditForm({ customer }: { customer: EditCust }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const action = updateCustomer.bind(null, customer.id);
  const [state, formAction] = useFormState(action, { ok: false } as ActionResult);
  if (state.ok && open)
    setTimeout(() => {
      setOpen(false);
      router.refresh();
    }, 0);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={editBtn}>
        <span aria-hidden="true">✏️</span> Edit
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} labelledBy={titleId} width={460}>
          <form action={formAction}>
            <h3 id={titleId} style={{ fontSize: "1.125rem", fontWeight: 800, marginBottom: 12 }}>
              Edit customer
            </h3>
            <label className="sp-field">
              <L>Name</L>
              <input name="name" defaultValue={customer.name} required className="sp-input" />
            </label>
            <label className="sp-field">
              <L>Phone</L>
              <input name="phone" defaultValue={customer.phone ?? ""} className="sp-input" />
            </label>
            <label className="sp-field">
              <L>Email</L>
              <input
                name="email"
                type="email"
                defaultValue={customer.email ?? ""}
                className="sp-input"
              />
            </label>
            <label className="sp-field">
              <L>Service address</L>
              <input name="address" defaultValue={customer.address ?? ""} className="sp-input" />
            </label>
            <label className="sp-field">
              <L>City</L>
              <input name="city" defaultValue={customer.city ?? ""} className="sp-input" />
            </label>
            <div
              style={{
                fontSize: "0.875rem",
                fontWeight: 700,
                color: "#5c6675",
                margin: "12px 0 -2px",
              }}
            >
              Billing address (leave blank if same)
            </div>
            <label className="sp-field">
              <L>Billing address</L>
              <input
                name="billing_address"
                defaultValue={customer.billing_address ?? ""}
                className="sp-input"
              />
            </label>
            <label className="sp-field">
              <L>Billing city</L>
              <input
                name="billing_city"
                defaultValue={customer.billing_city ?? ""}
                className="sp-input"
              />
            </label>
            <label className="sp-field">
              <L>Notes</L>
              <textarea
                name="notes"
                rows={2}
                defaultValue={customer.notes ?? ""}
                className="sp-textarea"
              />
            </label>
            {state.error && <Notice>{state.error}</Notice>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <Save />
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ ...save, background: "#e2e9f4", color: "#2563eb" }}
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "💾 Save"}
    </Button>
  );
}
function L({ children }: { children: React.ReactNode }) {
  return <span style={lbl}>{children}</span>;
}

const editBtn: React.CSSProperties = {
  background: "#eef2f8",
  color: "#2563eb",
  border: "none",
  borderRadius: 9,
  padding: "7px 12px",
  fontWeight: 700,
  fontSize: "0.875rem",
  cursor: "pointer",
};
const save: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  padding: "10px 16px",
  borderRadius: 10,
  fontWeight: 700,
  cursor: "pointer",
};
const lbl: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 700,
  color: "#334155",
  display: "block",
  margin: "9px 0 5px",
};
