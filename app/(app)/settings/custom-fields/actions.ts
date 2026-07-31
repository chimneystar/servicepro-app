"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
// @ts-ignore — pure, unit-tested in tests/custom-fields.test.mjs
import {
  ENTITY_TYPES, CustomFieldError, normalizeDefinitionInput,
  collectFieldValues, assertEntityReference,
} from "@/lib/core/custom-fields.mjs";

export type CustomFieldResult = { ok: boolean; error?: string };

const forbidden = (he: boolean) => he ? "אין לך הרשאה לשנות שדות מותאמים." : "You don't have access to change custom fields.";
const failed = (he: boolean) => he ? "לא הצלחנו לשמור. נסו שוב." : "We couldn't save that. Try again.";

async function guard() {
  const profile = await requireProfile();
  assertRole(profile, ["owner", "office"]);
  return profile;
}

// ---------------------------------------------------------------------
// Definitions — what fields exist (settings)
// ---------------------------------------------------------------------

export async function saveCustomFieldDefinition(_previous: CustomFieldResult, formData: FormData): Promise<CustomFieldResult> {
  const he = (await getLocale()) === "he";
  let profile;
  try { profile = await guard(); } catch { return { ok: false, error: forbidden(he) }; }

  let row;
  try {
    row = normalizeDefinitionInput({
      label: formData.get("label"),
      entityType: formData.get("entityType"),
      fieldType: formData.get("fieldType"),
      options: formData.get("options"),
      required: formData.get("required") === "on",
      sort: formData.get("sort"),
    });
  } catch (error) {
    return { ok: false, error: error instanceof CustomFieldError ? error.message : failed(he) };
  }

  const supabase = await createClient();
  const id = String(formData.get("id") ?? "").trim();
  // entity_type is NOT editable after creation: values already recorded against
  // the definition would become values of the wrong kind of thing.
  const { error } = id
    ? await supabase.from("custom_field_definitions")
        .update({ label: row.label, field_type: row.field_type, options_json: row.options_json, required: row.required, sort: row.sort })
        .eq("id", id).eq("organization_id", profile.organization_id!)
    : await supabase.from("custom_field_definitions")
        .insert({ ...row, organization_id: profile.organization_id });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/custom-fields");
  return { ok: true };
}

/** Archive rather than delete: the values recorded against the field survive. */
export async function setCustomFieldActive(id: string, active: boolean): Promise<CustomFieldResult> {
  const he = (await getLocale()) === "he";
  let profile;
  try { profile = await guard(); } catch { return { ok: false, error: forbidden(he) }; }
  const supabase = await createClient();
  const { error } = await supabase.from("custom_field_definitions").update({ active })
    .eq("id", id).eq("organization_id", profile.organization_id!);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/custom-fields");
  return { ok: true };
}

/** Permanent: `custom_field_values.definition_id` cascades, so every recorded value goes too. */
export async function deleteCustomFieldDefinition(id: string): Promise<CustomFieldResult> {
  const he = (await getLocale()) === "he";
  let profile;
  try { profile = await guard(); } catch { return { ok: false, error: forbidden(he) }; }
  const supabase = await createClient();
  const { error } = await supabase.from("custom_field_definitions").delete()
    .eq("id", id).eq("organization_id", profile.organization_id!);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/custom-fields");
  return { ok: true };
}

// ---------------------------------------------------------------------
// Values — what a field says about one customer or one job
// ---------------------------------------------------------------------

/**
 * Save the custom field values for one customer or job.
 *
 * `custom_field_values.entity_id` is polymorphic with no foreign key and no
 * organisation guard (audit F21), so this action never trusts what the form
 * says. The definition list is re-read from the database scoped to this
 * organisation and entity type, anything not on it is discarded, the entity is
 * looked up and its organisation compared, and `assertEntityReference` applies
 * the same rule migration 035's trigger enforces at the database.
 */
export async function saveCustomFieldValues(_previous: CustomFieldResult, formData: FormData): Promise<CustomFieldResult> {
  const he = (await getLocale()) === "he";
  let profile;
  try { profile = await guard(); } catch { return { ok: false, error: forbidden(he) }; }

  const entityType = String(formData.get("entityType") ?? "");
  const entityId = String(formData.get("entityId") ?? "");
  if (!ENTITY_TYPES.includes(entityType) || !entityId) return { ok: false, error: failed(he) };

  const supabase = await createClient();
  const table = entityType === "customer" ? "customers" : "jobs";
  const [{ data: entity }, { data: definitions }] = await Promise.all([
    supabase.from(table).select("id, organization_id").eq("id", entityId).maybeSingle(),
    supabase.from("custom_field_definitions")
      .select("id, organization_id, entity_type, label, field_type, options_json, required, active")
      .eq("entity_type", entityType).eq("active", true).order("sort").order("label"),
  ]);

  const defs = definitions ?? [];
  try {
    for (const definition of defs) {
      assertEntityReference({ definition, entityType, entity, organizationId: profile.organization_id });
    }
  } catch (error) {
    return { ok: false, error: error instanceof CustomFieldError ? error.message : failed(he) };
  }

  const submitted: Record<string, FormDataEntryValue | null> = {};
  for (const definition of defs) submitted[definition.id] = formData.get(`cf_${definition.id}`);
  const { writes, deletes, errors } = collectFieldValues(defs, submitted);
  if (errors.length) return { ok: false, error: errors.join(" ") };

  const now = new Date().toISOString();
  if (writes.length) {
    const { error } = await supabase.from("custom_field_values").upsert(
      writes.map((write: { definitionId: string; value: unknown }) => ({
        organization_id: profile!.organization_id,
        definition_id: write.definitionId,
        entity_type: entityType,
        entity_id: entityId,
        value_json: write.value,
        updated_by: profile!.id,
        updated_at: now,
      })),
      { onConflict: "definition_id,entity_id" },
    );
    if (error) return { ok: false, error: error.message };
  }
  if (deletes.length) {
    const { error } = await supabase.from("custom_field_values").delete()
      .eq("entity_id", entityId).eq("organization_id", profile.organization_id!).in("definition_id", deletes);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(entityType === "customer" ? `/customers/${entityId}` : `/jobs/${entityId}`);
  return { ok: true };
}
