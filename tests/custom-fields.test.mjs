import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FIELD_TYPES, ENTITY_TYPES, CustomFieldError,
  normalizeDefinitionInput, coerceFieldValue, collectFieldValues,
  assertEntityReference, formatFieldValue,
} from "../lib/core/custom-fields.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG = "22222222-2222-2222-2222-222222222222";
const def = (over = {}) => ({
  id: "def-1", organization_id: ORG, entity_type: "customer",
  label: "Gate code", field_type: "text", options_json: [], required: false, active: true, ...over,
});

test("field and entity types match the CHECK constraints in migration 019", () => {
  assert.deepEqual(FIELD_TYPES, ["text", "number", "date", "choice", "checkbox"]);
  assert.deepEqual(ENTITY_TYPES, ["customer", "job"]);
});

// ---------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------

test("a definition needs a name, a real entity and a real type", () => {
  const good = normalizeDefinitionInput({ label: " Gate code ", entityType: "customer", fieldType: "text" });
  assert.equal(good.label, "Gate code");
  assert.equal(good.entity_type, "customer");
  assert.equal(good.required, false);
  assert.throws(() => normalizeDefinitionInput({ label: "  ", entityType: "customer", fieldType: "text" }), CustomFieldError);
  assert.throws(() => normalizeDefinitionInput({ label: "x", entityType: "invoice", fieldType: "text" }), CustomFieldError);
  assert.throws(() => normalizeDefinitionInput({ label: "x", entityType: "customer", fieldType: "signature" }), CustomFieldError);
});

test("a choice field without options is refused, and duplicates are folded", () => {
  assert.throws(() => normalizeDefinitionInput({ label: "Tier", entityType: "job", fieldType: "choice", options: "  \n \n" }), CustomFieldError);
  const row = normalizeDefinitionInput({ label: "Tier", entityType: "job", fieldType: "choice", options: "Gold\nSilver\nGold\n" });
  assert.deepEqual(row.options_json, ["Gold", "Silver"]);
});

// ---------------------------------------------------------------------
// Values — the typing that jsonb will not do for you
// ---------------------------------------------------------------------

test("a number field takes a number and refuses anything else", () => {
  const d = def({ field_type: "number", label: "Unit count" });
  assert.deepEqual(coerceFieldValue(d, "12"), { present: true, value: 12 });
  assert.deepEqual(coerceFieldValue(d, " 12.5 "), { present: true, value: 12.5 });
  assert.throws(() => coerceFieldValue(d, "banana"), CustomFieldError);
  assert.throws(() => coerceFieldValue(d, "12,5"), CustomFieldError);
  assert.throws(() => coerceFieldValue(d, "1e9"), CustomFieldError);
});

test("a date field takes a real calendar day and refuses a plausible fake", () => {
  const d = def({ field_type: "date", label: "Filter changed" });
  assert.deepEqual(coerceFieldValue(d, "2026-07-31"), { present: true, value: "2026-07-31" });
  assert.deepEqual(coerceFieldValue(d, "2028-02-29"), { present: true, value: "2028-02-29" }); // leap year
  assert.throws(() => coerceFieldValue(d, "2026-02-30"), CustomFieldError);
  assert.throws(() => coerceFieldValue(d, "31/07/2026"), CustomFieldError);
  assert.throws(() => coerceFieldValue(d, "2026-13-01"), CustomFieldError);
});

test("a choice field refuses a value that is not on its list", () => {
  const d = def({ field_type: "choice", label: "Tier", options_json: ["Gold", "Silver"] });
  assert.deepEqual(coerceFieldValue(d, "Gold"), { present: true, value: "Gold" });
  assert.throws(() => coerceFieldValue(d, "Platinum"), CustomFieldError);
});

test("a checkbox is always present; blank text is absent, not empty string", () => {
  const box = def({ field_type: "checkbox" });
  assert.deepEqual(coerceFieldValue(box, "on"), { present: true, value: true });
  assert.deepEqual(coerceFieldValue(box, undefined), { present: true, value: false });
  assert.deepEqual(coerceFieldValue(def(), "   "), { present: false, value: null });
});

test("required is enforced, and a cleared field is deleted rather than stored blank", () => {
  const defs = [
    def({ id: "a", label: "Gate code", required: true }),
    def({ id: "b", label: "Notes" }),
  ];
  const missing = collectFieldValues(defs, { a: "", b: "hello" });
  assert.deepEqual(missing.errors, ["Gate code is required."]);

  const filled = collectFieldValues(defs, { a: "4821", b: "" });
  assert.deepEqual(filled.errors, []);
  assert.deepEqual(filled.writes, [{ definitionId: "a", value: "4821" }]);
  assert.deepEqual(filled.deletes, ["b"]);
});

test("a definition id that was not offered is ignored, never written", () => {
  const out = collectFieldValues([def({ id: "mine" })], { mine: "ok", "someone-elses": "injected" });
  assert.deepEqual(out.writes, [{ definitionId: "mine", value: "ok" }]);
  assert.equal(out.writes.some((w) => w.definitionId === "someone-elses"), false);
});

test("an inactive definition is not collected", () => {
  assert.deepEqual(collectFieldValues([def({ active: false })], { "def-1": "x" }).writes, []);
});

// ---------------------------------------------------------------------
// F21 — the polymorphic entity_id that pointed at anything
// ---------------------------------------------------------------------

test("a value may be attached to an entity in the same org (the good case)", () => {
  assert.equal(assertEntityReference({
    definition: def(), entityType: "customer",
    entity: { id: "cust-1", organization_id: ORG }, organizationId: ORG,
  }), true);
});

test("F21: a value may NOT point at another tenant's row", () => {
  assert.throws(() => assertEntityReference({
    definition: def(), entityType: "customer",
    entity: { id: "cust-9", organization_id: OTHER_ORG }, organizationId: ORG,
  }), CustomFieldError);
});

test("F21: a value may NOT use another tenant's definition", () => {
  assert.throws(() => assertEntityReference({
    definition: def({ organization_id: OTHER_ORG }), entityType: "customer",
    entity: { id: "cust-1", organization_id: ORG }, organizationId: ORG,
  }), CustomFieldError);
});

test("F21: a customer definition may NOT be attached to a job", () => {
  assert.throws(() => assertEntityReference({
    definition: def({ entity_type: "customer" }), entityType: "job",
    entity: { id: "job-1", organization_id: ORG }, organizationId: ORG,
  }), CustomFieldError);
});

test("F21: a value may NOT point at an id that does not resolve to a row", () => {
  assert.throws(() => assertEntityReference({
    definition: def(), entityType: "customer", entity: null, organizationId: ORG,
  }), CustomFieldError);
});

test("F21: an unknown entity type is refused outright", () => {
  assert.throws(() => assertEntityReference({
    definition: def(), entityType: "payment",
    entity: { id: "pay-1", organization_id: ORG }, organizationId: ORG,
  }), CustomFieldError);
});

// ---------------------------------------------------------------------
// The database is the real boundary — assert the migration installs it
// ---------------------------------------------------------------------

test("migration 035 installs the entity guard the app mirrors, and drops nothing", () => {
  const sql = readFileSync(new URL("../db/035_custom_fields_tax.sql", import.meta.url), "utf8");
  assert.match(sql, /create or replace function public\.assert_custom_field_entity\(\)/);
  assert.match(sql, /create trigger custom_field_values_entity_guard/);
  assert.match(sql, /before insert or update on public\.custom_field_values/);
  // it must check BOTH the entity's existence/org and the definition's entity_type
  assert.match(sql, /entity_type\s*<>\s*new\.entity_type/);
  assert.match(sql, /cross-tenant/i);
  // idempotent, additive: no table or column may be destroyed by this migration
  assert.equal(/drop\s+table/i.test(sql), false);
  assert.equal(/drop\s+column/i.test(sql), false);
  assert.equal(/\balter\s+table[^;]*\bdrop\b/i.test(sql), false);
});

test("migration 035 makes jurisdiction tax OPT-IN, so no existing document total changes", () => {
  const sql = readFileSync(new URL("../db/035_custom_fields_tax.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists tax_mode text not null default 'flat'/);
  assert.match(sql, /tax_mode in \('flat','jurisdictions'\)/);
});

test("formatting a stored value is readable, not raw JSON", () => {
  assert.equal(formatFieldValue(def({ field_type: "checkbox" }), true), "Yes");
  assert.equal(formatFieldValue(def({ field_type: "checkbox" }), false), "No");
  assert.equal(formatFieldValue(def(), null), "—");
  assert.equal(formatFieldValue(def({ field_type: "number" }), 12.5), "12.5");
});
