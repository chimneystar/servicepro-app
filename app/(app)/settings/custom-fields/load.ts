import { createClient } from "@/lib/supabase/server";
import * as operationsRepo from "@/lib/data/operations";

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
    const definitions = (await operationsRepo.listCustomFieldDefinitions(
      supabase,
      entityType,
    )) as CustomFieldDefinition[];
    if (definitions.length === 0) return { definitions, values: {} as Record<string, unknown> };

    const rows = await operationsRepo.listCustomFieldValues(supabase, entityType, entityId);
    const values: Record<string, unknown> = {};
    for (const row of rows) values[row.definition_id] = row.value_json;
    return { definitions, values };
  } catch {
    return { definitions: [] as CustomFieldDefinition[], values: {} as Record<string, unknown> };
  }
}
