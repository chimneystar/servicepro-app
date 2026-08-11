"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveCustomFieldValues, type CustomFieldResult } from "./actions";
import type { CustomFieldDefinition } from "./load";
import type { Locale } from "@/lib/i18n";
// @ts-ignore — pure, unit-tested in tests/custom-fields.test.mjs
import { formatFieldValue } from "@/lib/core/custom-fields.mjs";

const initial: CustomFieldResult = { ok: false };

/**
 * The custom fields a business defined for its customers or its jobs
 * (ledger 5.10). Read-only for anyone who cannot edit the record — which is
 * also what the RLS on `custom_field_values` allows, so the screen and the
 * database agree instead of showing a form that would be refused.
 */
export default function CustomFieldValues({
  locale,
  entityType,
  entityId,
  definitions,
  values,
  canEdit,
  title,
}: {
  locale: Locale;
  entityType: "customer" | "job";
  entityId: string;
  definitions: CustomFieldDefinition[];
  values: Record<string, unknown>;
  canEdit: boolean;
  title?: string;
}) {
  const he = locale === "he";
  const [state, action] = useActionState(saveCustomFieldValues, initial);
  const [editing, setEditing] = useState(false);
  if (definitions.length === 0) return null;

  const heading = title ?? (he ? "שדות מותאמים" : "Custom fields");

  if (!canEdit || !editing) {
    return (
      <div style={card}>
        <div style={head}>
          <h3 className="sp-heading">{heading}</h3>
          {canEdit && (
            <button type="button" style={mini} onClick={() => setEditing(true)}>
              {he ? "עריכה" : "Edit"}
            </button>
          )}
        </div>
        <dl style={{ display: "grid", gap: 6, margin: 0 }}>
          {definitions.map((definition) => (
            <div key={definition.id} style={{ display: "flex", gap: 10, fontSize: "0.875rem" }}>
              <dt style={{ color: "#5c6675", fontWeight: 700, minWidth: 140 }}>
                {definition.label}
              </dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>
                {formatFieldValue(definition, values[definition.id] ?? null, locale)}
              </dd>
            </div>
          ))}
        </dl>
        {state.ok && (
          <div className="ops-success" role="status" style={{ marginTop: 8 }}>
            ✓ {he ? "נשמר" : "Saved"}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={head}>
        <h3 className="sp-heading">{heading}</h3>
      </div>
      <form action={action} style={{ display: "grid", gap: 10 }}>
        <input type="hidden" name="entityType" value={entityType} />
        <input type="hidden" name="entityId" value={entityId} />
        {definitions.map((definition) => {
          const name = `cf_${definition.id}`;
          const current = values[definition.id];
          if (definition.field_type === "checkbox") {
            return (
              <label
                key={definition.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: "0.875rem",
                  fontWeight: 700,
                }}
              >
                <input type="checkbox" name={name} defaultChecked={current === true} />
                {definition.label}
                {definition.required ? " *" : ""}
              </label>
            );
          }
          return (
            <label key={definition.id} style={lbl}>
              {definition.label}
              {definition.required ? " *" : ""}
              {definition.field_type === "choice" ? (
                <select
                  name={name}
                  defaultValue={current == null ? "" : String(current)}
                  style={inp}
                >
                  <option value="">{he ? "ללא" : "None"}</option>
                  {(definition.options_json ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name={name}
                  type={
                    definition.field_type === "date"
                      ? "date"
                      : definition.field_type === "number"
                        ? "number"
                        : "text"
                  }
                  step={definition.field_type === "number" ? "any" : undefined}
                  defaultValue={current == null ? "" : String(current)}
                  style={inp}
                />
              )}
            </label>
          );
        })}
        {state.error && (
          <span className="form-error" role="alert">
            {state.error}
          </span>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <Save he={he} />
          <button
            type="button"
            style={{ ...btn, background: "#eaf0ff", color: "#2b66f6" }}
            onClick={() => setEditing(false)}
          >
            {he ? "ביטול" : "Cancel"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Save({ he }: { he: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} style={btn}>
      {pending ? (he ? "שומרים…" : "Saving…") : he ? "שמירה" : "Save"}
    </button>
  );
}

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: 14,
  marginBottom: 16,
};
const head: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  marginBottom: 10,
};
const btn: React.CSSProperties = {
  background: "#2b66f6",
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
  padding: "5px 9px",
  cursor: "pointer",
  fontSize: "0.875rem",
  fontWeight: 700,
};
const lbl: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 700,
  color: "#334155",
  display: "grid",
  gap: 5,
};
const inp: React.CSSProperties = {
  width: "100%",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: "9px 11px",
  fontSize: "0.875rem",
  outline: "none",
};
