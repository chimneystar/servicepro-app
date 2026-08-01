// =====================================================================
//  custom-fields.mjs — definitions and values for `custom_field_definitions`
//  and `custom_field_values` (created by migration 019, never used by the
//  product until now: ledger 5.10).
//
//  Two jobs, both pure so they can be tested without a database:
//
//   1. TYPING. A definition says a field is a number, a date or a choice.
//      `value_json` is jsonb and will happily store the string "banana" in a
//      number field, so every value is coerced and validated here before it is
//      written, and rejected loudly if it does not fit.
//
//   2. THE POLYMORPHIC REFERENCE. `custom_field_values.entity_id` has no
//      foreign key and no organisation guard (audit finding F21) — it can point
//      at any row in the database, including another tenant's. Migration 035
//      installs a trigger that refuses such a write at the database, which is
//      the real boundary; `assertEntityReference` is the same rule enforced in
//      the server action so the user gets a sentence instead of a 500, and so
//      the rule itself is testable.
// =====================================================================

/** @type {readonly ["text", "number", "date", "choice", "checkbox"]} */
export const FIELD_TYPES = ["text", "number", "date", "choice", "checkbox"];
/**
 * The literal tuple type is what lets a TypeScript caller write a checked entity
 * type into `custom_field_definitions.entity_type` and
 * `custom_field_values.entity_type`, whose CHECK constraints the generated
 * database types express as this same union. Annotation only — no runtime effect.
 *
 * @type {readonly ["customer", "job"]}
 */
export const ENTITY_TYPES = ["customer", "job"];

/** A rejected definition or value. Carries the definition it belongs to so the UI can point at the field. */
export class CustomFieldError extends Error {
  constructor(message, definitionId = null) {
    super(message);
    this.name = "CustomFieldError";
    this.definitionId = definitionId;
  }
}

const isPlainDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Is 'YYYY-MM-DD' a real calendar day? ('2026-02-30' is not.) */
function isRealDay(day) {
  if (!isPlainDay(day)) return false;
  const [y, m, d] = day.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= daysInMonth;
}

/**
 * Validate what the settings form submitted for a field definition.
 * Returns a row shaped for `custom_field_definitions`; throws CustomFieldError.
 *
 * The return type spells out the two checked columns as literal unions — that is
 * what lets a TypeScript caller insert this row into `custom_field_definitions`,
 * whose CHECK constraints the generated database types express the same way. The
 * function already refuses anything outside these sets, above. Annotation only.
 *
 * @returns {{
 *   label: string,
 *   entity_type: "customer" | "job",
 *   field_type: "text" | "number" | "date" | "choice" | "checkbox",
 *   options_json: string[],
 *   required: boolean,
 *   active: boolean,
 *   sort: number,
 * }}
 */
export function normalizeDefinitionInput(input) {
  const label = String(input.label ?? "").trim();
  if (!label) throw new CustomFieldError("A field needs a name.");
  if (label.length > 80) throw new CustomFieldError("Field names are limited to 80 characters.");

  const entityType = String(input.entityType ?? "");
  if (!ENTITY_TYPES.includes(entityType))
    throw new CustomFieldError("A field must belong to customers or to jobs.");

  const fieldType = String(input.fieldType ?? "");
  if (!FIELD_TYPES.includes(fieldType)) throw new CustomFieldError("Choose a field type.");

  let options = [];
  if (fieldType === "choice") {
    const raw = Array.isArray(input.options)
      ? input.options
      : String(input.options ?? "").split("\n");
    const seen = new Set();
    for (const entry of raw) {
      const option = String(entry).trim();
      if (!option || seen.has(option)) continue;
      if (option.length > 80)
        throw new CustomFieldError("Each choice is limited to 80 characters.");
      seen.add(option);
      options.push(option);
    }
    if (options.length === 0)
      throw new CustomFieldError("A choice field needs at least one option.");
    if (options.length > 50) throw new CustomFieldError("A choice field is limited to 50 options.");
  }

  const sort = Number.parseInt(String(input.sort ?? "0"), 10);
  return {
    label,
    entity_type: entityType,
    field_type: fieldType,
    options_json: options,
    required: input.required === true,
    active: input.active !== false,
    sort: Number.isFinite(sort) ? Math.max(0, Math.min(9999, sort)) : 0,
  };
}

/**
 * Coerce one submitted value against its definition.
 *
 * @returns {{present: boolean, value: string | number | boolean | null}}
 *          `present: false` means "no value" —
 *          the caller deletes the row rather than storing an empty string, so a
 *          cleared field is genuinely cleared and not stored as "".
 */
export function coerceFieldValue(definition, raw) {
  const id = definition?.id ?? null;
  const type = definition?.field_type ?? definition?.fieldType;
  if (!FIELD_TYPES.includes(type)) throw new CustomFieldError(`Unknown field type: ${type}`, id);
  const label = definition?.label ?? "This field";

  if (type === "checkbox") {
    const truthy =
      ["1", "on", "true", "yes"].includes(
        String(raw ?? "")
          .trim()
          .toLowerCase(),
      ) || raw === true;
    return { present: true, value: truthy };
  }

  const text = String(raw ?? "").trim();
  if (text === "") return { present: false, value: null };

  if (type === "text") {
    if (text.length > 2000)
      throw new CustomFieldError(`${label} is limited to 2000 characters.`, id);
    return { present: true, value: text };
  }

  if (type === "number") {
    // Deliberately NOT a money parser: a custom number is a serial, a count or a
    // reading. Anything that is money belongs on a line item, in minor units.
    if (!/^-?\d{1,15}(\.\d{1,6})?$/.test(text))
      throw new CustomFieldError(`${label} must be a number.`, id);
    return { present: true, value: Number(text) };
  }

  if (type === "date") {
    if (!isRealDay(text)) throw new CustomFieldError(`${label} must be a date (YYYY-MM-DD).`, id);
    return { present: true, value: text };
  }

  // choice
  const options = definition.options_json ?? definition.options ?? [];
  if (!options.map(String).includes(text))
    throw new CustomFieldError(`${label} must be one of the configured options.`, id);
  return { present: true, value: text };
}

/**
 * Coerce every submitted value and enforce `required`.
 *
 * Definitions not in `definitions` are IGNORED, not written: the list comes from
 * the database scoped to this organisation and entity type, so a forged
 * definition id in the form body cannot reach `custom_field_values`.
 *
 * The written value is named as JSON rather than `any` because it goes straight
 * into the `value_json` jsonb column; `coerceFieldValue` below produces only
 * these four kinds.
 *
 * @returns {{
 *   writes: {definitionId: string, value: string | number | boolean | null}[],
 *   deletes: string[],
 *   errors: string[],
 * }}
 */
export function collectFieldValues(definitions, submitted) {
  const writes = [];
  const deletes = [];
  const errors = [];
  for (const definition of definitions ?? []) {
    if (definition.active === false) continue;
    const raw =
      submitted instanceof Map ? submitted.get(definition.id) : submitted?.[definition.id];
    let coerced;
    try {
      coerced = coerceFieldValue(definition, raw);
    } catch (error) {
      errors.push(error.message);
      continue;
    }
    const required = definition.required === true;
    const missing =
      !coerced.present || (definition.field_type === "checkbox" && coerced.value === false);
    if (required && missing) {
      errors.push(`${definition.label} is required.`);
      continue;
    }
    if (coerced.present) writes.push({ definitionId: definition.id, value: coerced.value });
    else deletes.push(definition.id);
  }
  return { writes, deletes, errors };
}

/**
 * The polymorphic reference guard (audit F21), in JavaScript.
 *
 * Every one of these throws, and each is a write the old schema would have
 * accepted: a value on another tenant's customer, a value on a job id that does
 * not exist, a "customer" definition attached to a job.
 */
export function assertEntityReference({ definition, entityType, entity, organizationId }) {
  if (!ENTITY_TYPES.includes(entityType))
    throw new CustomFieldError(`Unknown entity type: ${entityType}`);
  if (!organizationId) throw new CustomFieldError("No organisation in context.");
  if (!definition) throw new CustomFieldError("That field no longer exists.");
  if ((definition.organization_id ?? organizationId) !== organizationId)
    throw new CustomFieldError("That field belongs to another business.", definition.id ?? null);
  if ((definition.entity_type ?? definition.entityType) !== entityType)
    throw new CustomFieldError(
      `That field is defined for ${definition.entity_type ?? definition.entityType}s, not ${entityType}s.`,
      definition.id ?? null,
    );
  if (!entity) throw new CustomFieldError(`That ${entityType} does not exist.`);
  if (entity.organization_id !== organizationId)
    throw new CustomFieldError(`That ${entityType} belongs to another business.`);
  return true;
}

/** Render a stored value for display. Dates and checkboxes are the two that need help. */
export function formatFieldValue(definition, value, locale = "en") {
  const type = definition?.field_type ?? definition?.fieldType;
  const he = locale === "he";
  if (value === null || value === undefined || value === "") return "—";
  if (type === "checkbox") return value ? (he ? "כן" : "Yes") : he ? "לא" : "No";
  if (type === "date" && isPlainDay(String(value)))
    return new Date(`${value}T12:00:00Z`).toLocaleDateString(he ? "he-IL" : "en-US");
  if (type === "number") return String(value);
  return String(value);
}
