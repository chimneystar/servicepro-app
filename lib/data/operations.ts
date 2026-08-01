/**
 * The smaller operational aggregates: expenses, leads, recurring plans,
 * custom fields, booking configuration, message templates and inventory.
 *
 * They are grouped rather than given a file each because each is two or three
 * query shapes; a directory of eleven four-line modules costs more to navigate
 * than it repays. The grouping is by SCREEN AREA, not by convenience — every
 * function here belongs to operations rather than to the money path.
 */

import type { ServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { readAll, readAtMost } from "./db";

/**
 * The entity types custom fields can be attached to.
 *
 * Taken from the generated schema, not retyped: `custom_field_definitions.
 * entity_type` carries a CHECK constraint, so this is `"job" | "customer"` and
 * the database is what says so. Declaring the parameter `string` compiled
 * against the old untyped client and would have let a typo reach a query that
 * silently matched nothing.
 */
export type CustomFieldEntity =
  Database["public"]["Tables"]["custom_field_definitions"]["Row"]["entity_type"];

// --- expenses --------------------------------------------------------------

/** Expense amounts in a window — what the reports subtract. */
export function listExpenseAmountsInWindow(supabase: ServerClient, start: string, end: string) {
  return readAll("operations.listExpenseAmountsInWindow", () =>
    supabase
      .from("expenses")
      .select("amount_minor")
      .gte("expense_date", start)
      .lte("expense_date", end),
  );
}

/** Expenses in a window with their category — the custom report's breakdown. */
export function listExpensesInWindow(supabase: ServerClient, start: string, end: string) {
  return readAll("operations.listExpensesInWindow", () =>
    supabase
      .from("expenses")
      .select("amount_minor, category, expense_date")
      .gte("expense_date", start)
      .lte("expense_date", end),
  );
}

/** Expenses in a window for the accounting export. */
export function listExpensesForExport(supabase: ServerClient, from: string, to: string) {
  return readAll("operations.listExpensesForExport", () =>
    supabase
      .from("expenses")
      .select("id, expense_date, category, vendor, amount_minor, notes")
      .gte("expense_date", from)
      .lte("expense_date", to)
      .order("expense_date"),
  );
}

// --- leads -----------------------------------------------------------------

/** The lead inbox, newest first. */
export function listLeads(supabase: ServerClient) {
  return readAll("operations.listLeads", () =>
    supabase
      .from("leads")
      .select(
        "id, name, phone, email, address, city, service, notes, status, source, preferred_date, created_at",
      )
      .order("created_at", { ascending: false }),
  );
}

// --- recurring plans -------------------------------------------------------

/** Recurring plans with their customer — the /recurring screen. */
export function listRecurringPlans(supabase: ServerClient) {
  return readAll("operations.listRecurringPlans", () =>
    supabase
      .from("recurring_plans")
      .select(
        "id, customer_id, service, interval_months, price_minor, next_due, assigned_to, customers!recurring_plans_customer_id_fkey(name)",
      )
      .order("next_due"),
  );
}

/**
 * Active plans that are due — the generator's work list.
 *
 * Paged, and this one has teeth: the generator CREATES A JOB per row it reads.
 * Truncated at 1000, the plans past the cap simply never generate, and the
 * symptom is a customer whose quarterly service quietly stopped happening.
 */
export function listDueRecurringPlans(supabase: ServerClient, today: string) {
  return readAll("operations.listDueRecurringPlans", () =>
    supabase.from("recurring_plans").select("*").eq("active", true).lte("next_due", today),
  );
}

// --- custom fields ---------------------------------------------------------

/** The active definitions for one entity type, in display order. */
export function listCustomFieldDefinitions(supabase: ServerClient, entityType: CustomFieldEntity) {
  return readAll("operations.listCustomFieldDefinitions", () =>
    supabase
      .from("custom_field_definitions")
      .select("id, label, entity_type, field_type, options_json, required, active, sort")
      .eq("entity_type", entityType)
      .eq("active", true)
      .order("sort")
      .order("label"),
  );
}

/** The same, with the organisation column the validating action needs. */
export function listCustomFieldDefinitionsForValidation(
  supabase: ServerClient,
  entityType: CustomFieldEntity,
) {
  return readAll("operations.listCustomFieldDefinitionsForValidation", () =>
    supabase
      .from("custom_field_definitions")
      .select("id, organization_id, entity_type, label, field_type, options_json, required, active")
      .eq("entity_type", entityType)
      .eq("active", true)
      .order("sort")
      .order("label"),
  );
}

/** Every definition, active or not — the settings screen. */
export function listAllCustomFieldDefinitions(supabase: ServerClient) {
  return readAll("operations.listAllCustomFieldDefinitions", () =>
    supabase
      .from("custom_field_definitions")
      .select("id, label, entity_type, field_type, options_json, required, active, sort")
      .order("sort")
      .order("label"),
  );
}

/** The values stored against one record. */
export function listCustomFieldValues(
  supabase: ServerClient,
  entityType: CustomFieldEntity,
  entityId: string,
) {
  return readAll("operations.listCustomFieldValues", () =>
    supabase
      .from("custom_field_values")
      .select("definition_id, value_json")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId),
  );
}

// --- booking configuration -------------------------------------------------

/** The services offered on the public booking page. */
export function listBookingServices(supabase: ServerClient) {
  return readAll("operations.listBookingServices", () =>
    supabase.from("booking_services").select("*").order("sort").order("name_en"),
  );
}

/** The questions asked at booking time. */
export function listBookingQuestions(supabase: ServerClient) {
  return readAll("operations.listBookingQuestions", () =>
    supabase
      .from("booking_questions")
      .select("*")
      .eq("active", true)
      .order("sort")
      .order("created_at"),
  );
}

/** The active service areas. */
export function listServiceAreas(supabase: ServerClient) {
  return readAll("operations.listServiceAreas", () =>
    supabase.from("service_areas").select("id,area_type,active").eq("active", true),
  );
}

// --- messaging -------------------------------------------------------------

/** The org's message templates, one per trigger. */
export function listMessageTemplates(supabase: ServerClient) {
  return readAll("operations.listMessageTemplates", () =>
    supabase.from("message_templates").select("trigger, enabled, body"),
  );
}

// --- inventory -------------------------------------------------------------

/** Stock movements recorded against one job line, for costing. */
export function listMovementsForJobItem(supabase: ServerClient, jobItemId: string) {
  return readAll("operations.listMovementsForJobItem", () =>
    supabase
      .from("inventory_movements")
      .select("item_id, qty_milli, unit_cost_minor")
      .eq("job_item_id", jobItemId),
  );
}

/** The lines on a set of purchase orders — the receiving screen. */
export function listPurchaseOrderItems(supabase: ServerClient, purchaseOrderIds: string[]) {
  if (!purchaseOrderIds.length) return Promise.resolve([]);
  return readAll("operations.listPurchaseOrderItems", () =>
    supabase
      .from("purchase_order_items")
      .select(
        "id, purchase_order_id, description, qty_milli, received_qty_milli, unit_cost_minor, inventory_item_id",
      )
      .in("purchase_order_id", purchaseOrderIds)
      .order("sort"),
  );
}

// --- calendar feed ---------------------------------------------------------

/** The live calendar-feed tokens the owner has issued. */
export function listCalendarFeedTokens(supabase: ServerClient) {
  return readAll("operations.listCalendarFeedTokens", () =>
    supabase
      .from("calendar_feed_tokens")
      .select("id, token, label, scope, expires_at, last_accessed_at, created_at")
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
  );
}

// --- push ------------------------------------------------------------------

/**
 * Device subscriptions to notify.
 *
 * An explicit bound, because this is a fan-out: every row read becomes an HTTP
 * request to a push service. "All of them" is a decision the caller must make
 * deliberately, so it states the number.
 */
export function listDeviceSubscriptions(supabase: ServerClient, profileId: string, limit: number) {
  return readAtMost(
    "operations.listDeviceSubscriptions",
    () =>
      supabase
        .from("device_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("profile_id", profileId),
    limit,
  );
}
