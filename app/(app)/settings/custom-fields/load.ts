import { createClient } from "@/lib/supabase/server";

export type CustomFieldDefinition = {
  id: string;
  label: string;
  entity_type: "customer" | "job";
  field_type: "text" | "number" | "date" | "choice" | "checkbox";
  options_json: string[];
  required: boolean;
  active: boolean;
  sort: number;
};

/**
 * The active definitions for one kind of record, plus the values already
 * recorded for one particular record. Both queries are RLS-scoped to the
 * caller's organisation.
 *
 * Returns empty lists rather than throwing if the tables are unreachable, so a
 * screen that shows custom fields as one section among many is never taken down
 * by them.
 */
export async function loadCustomFields(entityType: "customer" | "job", entityId: string) {
  try {
    const supabase = await createClient();
    const { data: definitions } = await supabase
      .from("custom_field_definitions")
      .select("id, label, entity_type, field_type, options_json, required, active, sort")
      .eq("entity_type", entityType)
      .eq("active", true)
      .order("sort")
      .order("label");
    const defs = (definitions ?? []) as CustomFieldDefinition[];
    if (defs.length === 0) return { definitions: defs, values: {} as Record<string, unknown> };

    const { data: rows } = await supabase
      .from("custom_field_values")
      .select("definition_id, value_json")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId);
    const values: Record<string, unknown> = {};
    for (const row of rows ?? []) values[row.definition_id] = row.value_json;
    return { definitions: defs, values };
  } catch {
    return { definitions: [] as CustomFieldDefinition[], values: {} as Record<string, unknown> };
  }
}
