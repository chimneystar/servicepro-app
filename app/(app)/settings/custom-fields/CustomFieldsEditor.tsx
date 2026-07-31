"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { deleteCustomFieldDefinition, saveCustomFieldDefinition, setCustomFieldActive, type CustomFieldResult } from "./actions";
import type { CustomFieldDefinition } from "./load";
import type { Locale } from "@/lib/i18n";
import Modal from "@/components/Modal";

const initial: CustomFieldResult = { ok: false };

const TYPE_LABEL = (he: boolean): Record<string, string> => ({
  text: he ? "טקסט" : "Text",
  number: he ? "מספר" : "Number",
  date: he ? "תאריך" : "Date",
  choice: he ? "בחירה מרשימה" : "Choice",
  checkbox: he ? "כן / לא" : "Yes / no",
});

export default function CustomFieldsEditor({ locale, entityType, definitions }:
  { locale: Locale; entityType: "customer" | "job"; definitions: CustomFieldDefinition[] }) {
  const he = locale === "he";
  const router = useRouter();
  const [state, action] = useActionState(saveCustomFieldDefinition, initial);
  const [editing, setEditing] = useState<CustomFieldDefinition | null | undefined>(undefined);
  const titleId = useId();
  const [fieldType, setFieldType] = useState("text");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const types = TYPE_LABEL(he);

  if (state.ok && editing !== undefined) setTimeout(() => { setEditing(undefined); router.refresh(); }, 0);
  function open(definition: CustomFieldDefinition | null) {
    setFieldType(definition?.field_type ?? "text");
    setEditing(definition);
  }
  const noun = entityType === "customer" ? (he ? "לקוחות" : "customers") : (he ? "עבודות" : "jobs");

  return (
    <div className="settings-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800 }}>{entityType === "customer" ? (he ? "שדות לקוח" : "Customer fields") : (he ? "שדות עבודה" : "Job fields")}</h3>
        <button type="button" onClick={() => open(null)} style={btn}>{he ? "הוספה" : "Add"}</button>
      </div>
      <p style={{ fontSize: 12.5, color: "#5c6675", marginBottom: 10 }}>
        {he ? `שדות שמופיעים בכרטיס ה${noun}.` : `These appear on every ${entityType} record.`}
      </p>

      {definitions.map((definition) => (
        <div key={definition.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid #f1f4f9" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{definition.label}{definition.required ? " *" : ""}</b>
            <div style={{ fontSize: 12, color: "#5c6675" }}>
              {types[definition.field_type] ?? definition.field_type}
              {definition.field_type === "choice" && (definition.options_json ?? []).length ? ` · ${(definition.options_json ?? []).join(", ")}` : ""}
              {definition.active ? "" : ` · ${he ? "מוסתר" : "hidden"}`}
            </div>
          </div>
          <button type="button" onClick={() => open(definition)} style={mini} aria-label={he ? "עריכה" : "Edit"}>✎</button>
          <button type="button" disabled={pending} style={mini} onClick={() => start(async () => {
            const result = await setCustomFieldActive(definition.id, !definition.active);
            setMessage(result.ok ? (he ? "עודכן" : "Updated") : (result.error || "Error"));
            router.refresh();
          })}>{definition.active ? (he ? "הסתרה" : "Hide") : (he ? "הצגה" : "Show")}</button>
          <button type="button" disabled={pending} style={{ ...mini, background: "#fff0f0", color: "#b93545" }} onClick={() => {
            if (!confirm(he
              ? "למחוק את השדה? כל הערכים שנרשמו בו יימחקו לצמיתות. אפשר במקום זאת להסתיר."
              : "Delete this field? Every value recorded in it is permanently deleted. You can hide it instead.")) return;
            start(async () => {
              const result = await deleteCustomFieldDefinition(definition.id);
              setMessage(result.ok ? (he ? "נמחק" : "Deleted") : (result.error || "Error"));
              router.refresh();
            });
          }} aria-label={he ? "מחיקה" : "Delete"}>×</button>
        </div>
      ))}
      {definitions.length === 0 && <div style={{ color: "#5c6675", fontSize: 13, padding: 8 }}>{he ? "עוד לא הוגדרו שדות." : "No fields defined yet."}</div>}
      {message && <div style={{ fontSize: 12.5, color: "#2563eb", marginTop: 8 }} role="status">{message}</div>}

      {editing !== undefined && (
        <Modal onClose={() => setEditing(undefined)} labelledBy={titleId} width={420}>
          <form action={action}>
            <h3 id={titleId} style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>{editing ? (he ? "עריכת שדה" : "Edit field") : (he ? "שדה חדש" : "New field")}</h3>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <input type="hidden" name="entityType" value={entityType} />
            <label style={{ display: "block" }}>
              <L>{he ? "שם השדה" : "Field name"}</L>
              <input name="label" defaultValue={editing?.label ?? ""} style={inp} required maxLength={80} />
            </label>
            <label style={{ display: "block" }}>
              <L>{he ? "סוג" : "Type"}</L>
              <select name="fieldType" style={inp} value={fieldType} onChange={(event) => setFieldType(event.target.value)} disabled={Boolean(editing)}>
                {Object.entries(types).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
            </label>
            {editing && <input type="hidden" name="fieldType" value={editing.field_type} />}
            {fieldType === "choice" && (
              <label style={{ display: "block" }}>
                <L>{he ? "אפשרויות (שורה לכל אפשרות)" : "Options (one per line)"}</L>
                <textarea name="options" rows={4} style={inp} defaultValue={(editing?.options_json ?? []).join("\n")} />
              </label>
            )}
            <label style={{ display: "block" }}>
              <L>{he ? "סדר הצגה" : "Sort order"}</L>
              <input name="sort" type="number" min={0} defaultValue={editing?.sort ?? 0} style={inp} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 0", fontSize: 13.5, fontWeight: 700 }}>
              <input type="checkbox" name="required" defaultChecked={editing?.required ?? false} />
              {he ? "שדה חובה" : "Required"}
            </label>
            {state.error && <div style={err}>{state.error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <Save he={he} />
              <button type="button" onClick={() => setEditing(undefined)} style={{ ...btn, background: "#eaf0ff", color: "#2b66f6" }}>{he ? "ביטול" : "Cancel"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Save({ he }: { he: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} style={btn}>{pending ? (he ? "שומרים…" : "Saving…") : (he ? "שמירה" : "Save")}</button>;
}
function L({ children }: { children: React.ReactNode }) { return <span style={lbl}>{children}</span>; }

const btn: React.CSSProperties = { background: "#2b66f6", color: "#fff", border: "none", padding: "9px 15px", borderRadius: 10, fontWeight: 700, cursor: "pointer" };
const mini: React.CSSProperties = { background: "#eef2f8", border: "none", borderRadius: 8, padding: "5px 8px", cursor: "pointer", fontSize: 13 };
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", margin: "10px 0 6px" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none" };
const err: React.CSSProperties = { background: "#fdeaea", color: "#dc2626", padding: "9px 12px", borderRadius: 10, fontSize: 13, marginTop: 10 };
