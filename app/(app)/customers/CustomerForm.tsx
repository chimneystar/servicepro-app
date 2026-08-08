"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { createCustomer, type ActionResult } from "./actions";
import { t, sourceOptions, type Locale } from "@/lib/i18n";
import AddressAutocomplete from "@/components/AddressAutocomplete";
import Modal from "@/components/Modal";
import { Button, Label, Notice } from "@/components/ui";

const initial: ActionResult = { ok: false };

export default function CustomerForm({
  locale,
  initialOpen = false,
}: {
  locale: Locale;
  initialOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const titleId = useId();
  const [state, formAction] = useFormState(createCustomer, initial);
  const sources = sourceOptions(locale);
  const [addr, setAddr] = useState("");
  const [city, setCity] = useState("");

  if (state.ok && open)
    setTimeout(() => {
      setOpen(false);
      setAddr("");
      setCity("");
      router.refresh();
    }, 0);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <span aria-hidden="true">➕</span> {t(locale, "cust.new")}
      </Button>
      {open && (
        <Modal onClose={() => setOpen(false)} labelledBy={titleId} width={480}>
          <form action={formAction}>
            <h3 id={titleId} style={{ fontSize: "1.125rem", fontWeight: 800, marginBottom: 14 }}>
              {t(locale, "cust.form.new")}
            </h3>
            <Field name="name" label={t(locale, "form.name")} />
            <Field name="phone" label={t(locale, "form.phone")} />
            <Field name="email" label={t(locale, "form.email")} type="email" />
            <label style={lbl}>{`${t(locale, "form.address")} (service)`}</label>
            <AddressAutocomplete value={addr} city={city} onChange={setAddr} onCity={setCity} />
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
            <Field name="billing_address" label="Billing address" />
            <Field name="billing_city" label="Billing city" />
            <label className="sp-field">
              <Label>{t(locale, "form.source")}</Label>
              <select name="source" defaultValue="" className="sp-select">
                <option value="">{t(locale, "form.source_choose")}</option>
                {sources.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="sp-field">
              <Label>{t(locale, "form.notes")}</Label>
              <textarea name="notes" rows={2} className="sp-textarea" />
            </label>
            {state.error && <Notice mt={5}>{state.error}</Notice>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <SubmitButton locale={locale} />
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
    </>
  );
}

function SubmitButton({ locale }: { locale: Locale }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t(locale, "common.saving") : `💾 ${t(locale, "common.save")}`}
    </Button>
  );
}

function Field({ name, label, type = "text" }: { name: string; label: string; type?: string }) {
  return (
    <label className="sp-field">
      <Label>{label}</Label>
      <input name={name} type={type} className="sp-input" />
    </label>
  );
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
const lbl: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 700,
  color: "#334155",
  display: "block",
  margin: "10px 0 6px",
};
