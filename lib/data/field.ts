/**
 * Query shapes for the field-operations screens — jobs, dispatch, route,
 * schedule, fleet, inventory and the platform admin console — that no
 * existing repository covers exactly.
 *
 * EVERY FUNCTION HERE EXISTS BECAUSE A CALL SITE'S COLUMN LIST, FILTER OR
 * BOUND DIFFERED FROM THE NEAREST REPOSITORY FUNCTION. Bending the call site
 * to a near-match would have silently changed what the screen renders — a
 * worse outcome than a duplicate function. See lib/data/jobs.ts,
 * lib/data/technicians.ts, lib/data/profiles.ts, lib/data/customers.ts,
 * lib/data/operations.ts, lib/data/payments.ts and lib/data/invoices.ts for
 * the shapes that DID already exist and are reused as-is by these screens.
 *
 * EMBED HINTS. `jobs` carries two foreign keys each to `customers` and
 * `profiles` (migration 014's composite tenant keys), so every embed below
 * names its constraint exactly as the call site had it — see lib/data/jobs.ts
 * for why a bare `customers(...)` embed returns HTTP 300/PGRST201.
 */

import type { ServerClient } from "@/lib/supabase/server";
import type { AdminClient } from "@/lib/supabase/admin";
import { readAll, readAtMost } from "./db";

const CUSTOMER = "customers!jobs_customer_id_fkey";
const ASSIGNEE = "profiles!jobs_assigned_to_fkey";

// --- /jobs -------------------------------------------------------------

/**
 * The /jobs list screen's page of jobs, newest first. The limit is the
 * screen's own adjustable page size (`?show=`), never a default — see
 * app/(app)/jobs/page.tsx for the truncation banner this feeds.
 */
export function listPageForJobsScreen(supabase: ServerClient, limit: number) {
  return readAtMost(
    "field.listPageForJobsScreen",
    () =>
      supabase
        .from("jobs")
        .select(
          `id, service, stage, tags, price_minor, scheduled_date, start_time, stage_changed_at, ${CUSTOMER}(name, address, city), ${ASSIGNEE}(full_name)`,
        )
        .is("deleted_at", null)
        .order("scheduled_date", { ascending: false }),
    limit,
  );
}

/** Job statuses as the /jobs and job-detail screens render them (with the done/cancelled flags). */
export function listJobStatusesForBoard(supabase: ServerClient) {
  return readAll("field.listJobStatusesForBoard", () =>
    supabase.from("job_statuses").select("name, color, is_done, is_cancelled").order("sort"),
  );
}

/**
 * `{ id, full_name }` for the assignee pickers on /jobs and /schedule.
 *
 * Deliberately no `active` filter and no role filter — both screens list
 * every profile, unlike `profiles.listActive` (active only) or
 * `profiles.listAssignable` (role-restricted, and it also selects `role`).
 */
export function listAssigneeNames(supabase: ServerClient, limit: number) {
  return readAtMost(
    "field.listAssigneeNames",
    () => supabase.from("profiles").select("id, full_name").order("full_name"),
    limit,
  );
}

// --- job detail (app/(app)/jobs/[id]/actions.ts, page.tsx) -------------

/** Payment amounts against one invoice — the job page's "mark paid" recompute. */
export function listPaymentAmountsForInvoice(supabase: ServerClient, invoiceId: string) {
  return readAll("field.listPaymentAmountsForInvoice", () =>
    supabase.from("payments").select("amount_minor").eq("invoice_id", invoiceId),
  );
}

/** This user's open time entry on this job, if any — clock-out looks up the row to close. */
export function listOpenTimeEntryId(supabase: ServerClient, jobId: string, userId: string) {
  return readAtMost(
    "field.listOpenTimeEntryId",
    () =>
      supabase
        .from("job_time_entries")
        .select("id")
        .eq("job_id", jobId)
        .eq("user_id", userId)
        .is("ended_at", null)
        .order("started_at", { ascending: false }),
    1,
  );
}

/** Every photo on a job, in capture order — the Attachments tab. */
export function listPhotosForJob(supabase: ServerClient, jobId: string) {
  return readAll("field.listPhotosForJob", () =>
    supabase
      .from("job_photos")
      .select("id, storage_path, label, media_type, parent_photo_id, customer_visible")
      .eq("job_id", jobId)
      .order("created_at"),
  );
}

/** Invoices raised against one job — the job page's Invoices tab. */
export function listInvoicesForJobSummary(supabase: ServerClient, jobId: string) {
  return readAll("field.listInvoicesForJobSummary", () =>
    supabase
      .from("invoices")
      .select("id, number, total_minor, status, public_token")
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .order("number", { ascending: false }),
  );
}

/** Estimates for the job's customer — the job page's Estimates tab. */
export function listEstimatesForCustomerSummary(supabase: ServerClient, customerId: string) {
  return readAll("field.listEstimatesForCustomerSummary", () =>
    supabase
      .from("estimates")
      .select("id, number, total_minor, status, public_token")
      .eq("customer_id", customerId)
      .is("deleted_at", null)
      .order("number", { ascending: false }),
  );
}

/** Job items with their id — the job page's Items tab (jobs.listItems omits id and includes sort). */
export function listItemsWithIdForJob(supabase: ServerClient, jobId: string) {
  return readAll("field.listItemsWithIdForJob", () =>
    supabase
      .from("job_items")
      .select("id, description, qty_milli, unit_price_minor, cost_minor")
      .eq("job_id", jobId)
      .order("sort"),
  );
}

/** Job tasks with their id, oldest first — the job page's Tasks tab (jobs.listTasks omits both). */
export function listTasksWithIdForJob(supabase: ServerClient, jobId: string) {
  return readAll("field.listTasksWithIdForJob", () =>
    supabase.from("job_tasks").select("id, title, done").eq("job_id", jobId).order("created_at"),
  );
}

/** Checklist items with their id, oldest first — the job page's Checklists tab. */
export function listChecklistWithIdForJob(supabase: ServerClient, jobId: string) {
  return readAll("field.listChecklistWithIdForJob", () =>
    supabase
      .from("job_checklist_items")
      .select("id, label, checked")
      .eq("job_id", jobId)
      .order("created_at"),
  );
}

/** Equipment left with the customer for one job — the job page's Equipment tab. */
export function listEquipmentForJob(supabase: ServerClient, jobId: string) {
  return readAll("field.listEquipmentForJob", () =>
    supabase
      .from("job_equipment")
      .select("id, name, serial, notes")
      .eq("job_id", jobId)
      .order("created_at"),
  );
}

/** The price book, for the estimate/invoice creation form on the job page. */
export function listPriceBook(supabase: ServerClient) {
  return readAll("field.listPriceBook", () =>
    supabase
      .from("price_book")
      .select("id, name, description, price_minor, cost_minor, taxable, image_path")
      .order("name"),
  );
}

/** The most recent AI-summary drafts for one job. */
export function listRecentSummaryDrafts(supabase: ServerClient, jobId: string, limit: number) {
  return readAtMost(
    "field.listRecentSummaryDrafts",
    () =>
      supabase
        .from("job_summary_drafts")
        .select("id,summary,provider,model,status,created_at")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false }),
    limit,
  );
}

/** `{ id, full_name }` for owner/office/tech — the job page's history/warranty "team" picker. */
export function listTeamNamesForJob(supabase: ServerClient) {
  return readAll("field.listTeamNamesForJob", () =>
    supabase
      .from("profiles")
      .select("id,full_name")
      .in("role", ["owner", "office", "tech"])
      .order("full_name"),
  );
}

/** Warranty callbacks raised against one job, newest first. */
export function listWarrantyCallbacksForOriginalJob(supabase: ServerClient, jobId: string) {
  return readAll("field.listWarrantyCallbacksForOriginalJob", () =>
    supabase
      .from("warranty_callbacks")
      .select(
        "id,issue,priority,responsibility,status,scheduled_for,resolution,internal_cost_minor,callback_job_id,reported_at",
      )
      .eq("original_job_id", jobId)
      .order("reported_at", { ascending: false }),
  );
}

/** The parts picker on the job page's Items tab. */
export function listInventoryPickerForJob(supabase: ServerClient, limit: number) {
  return readAtMost(
    "field.listInventoryPickerForJob",
    () =>
      supabase
        .from("inventory_items")
        .select("id,name,unit,quantity_milli,cost_minor")
        .order("name"),
    limit,
  );
}

// --- /schedule -----------------------------------------------------------

/** Calendar jobs in one visible window — see app/(app)/schedule/page.tsx for the window arithmetic. */
export function listForCalendarWindow(
  supabase: ServerClient,
  from: string,
  to: string,
  limit: number,
) {
  return readAtMost(
    "field.listForCalendarWindow",
    () =>
      supabase
        .from("jobs")
        .select(
          `id, service, status, scheduled_date, start_time, end_time, ${CUSTOMER}(name), ${ASSIGNEE}(full_name)`,
        )
        .is("deleted_at", null)
        .gte("scheduled_date", from)
        .lte("scheduled_date", to)
        .order("scheduled_date"),
    limit,
  );
}

/**
 * `{ id, name }` for every non-deleted customer, INCLUDING archived ones.
 *
 * Unlike `customers.listPickable`, which excludes archived customers — the
 * schedule screen's inline "new job" customer picker never applied that
 * filter, so it is preserved here rather than silently narrowed.
 */
export function listCustomerNamesIncludingArchived(supabase: ServerClient, limit: number) {
  return readAtMost(
    "field.listCustomerNamesIncludingArchived",
    () => supabase.from("customers").select("id, name").is("deleted_at", null).order("name"),
    limit,
  );
}

// --- /fleet ----------------------------------------------------------------

/** `{ id, full_name, role }` for technicians only — the fleet map's roster. */
export function listTechProfiles(supabase: ServerClient) {
  return readAll("field.listTechProfiles", () =>
    supabase.from("profiles").select("id,full_name,role").eq("role", "tech").order("full_name"),
  );
}

/** The most recent location pings, newest first — the fleet screen derives "latest per technician" from this. */
export function listLatestTechLocations(supabase: ServerClient, limit: number) {
  return readAtMost(
    "field.listLatestTechLocations",
    () =>
      supabase
        .from("technician_locations")
        .select("profile_id,latitude,longitude,accuracy_m,recorded_at")
        .order("recorded_at", { ascending: false }),
    limit,
  );
}

// --- /inventory --------------------------------------------------------

/** Every inventory item with the full column set the /inventory list renders. */
export function listInventoryItemsFull(supabase: ServerClient) {
  return readAll("field.listInventoryItemsFull", () =>
    supabase
      .from("inventory_items")
      .select("id, name, sku, unit, quantity, quantity_milli, low_stock_threshold, cost_minor")
      .order("name"),
  );
}

/** The stock ledger, most recent first — /inventory/movements. */
export function listRecentInventoryMovements(supabase: ServerClient, limit: number) {
  return readAtMost(
    "field.listRecentInventoryMovements",
    () =>
      supabase
        .from("inventory_movements")
        .select(
          "id, kind, qty_milli, unit_cost_minor, reason, allow_negative, created_at, job_id, item_id, created_by",
        )
        .order("created_at", { ascending: false }),
    limit,
  );
}

/** Items for the stock-movement form's picker — narrower columns than the /inventory list. */
export function listInventoryItemsForPicker(supabase: ServerClient) {
  return readAll("field.listInventoryItemsForPicker", () =>
    supabase
      .from("inventory_items")
      .select("id, name, unit, quantity_milli, cost_minor")
      .order("name"),
  );
}

/** Open purchase orders, most recently created first — the receiving screen. */
export function listOpenPurchaseOrders(supabase: ServerClient, limit: number) {
  return readAtMost(
    "field.listOpenPurchaseOrders",
    () =>
      supabase
        .from("purchase_orders")
        .select("id, po_number, status, total_minor, expected_date, vendors(name)")
        .in("status", ["draft", "ordered", "partially_received"])
        .order("created_at", { ascending: false }),
    limit,
  );
}

/** `{ id, name, unit }` for every item — the receiving screen's line picker. */
export function listInventoryNamesUnitOnly(supabase: ServerClient) {
  return readAll("field.listInventoryNamesUnitOnly", () =>
    supabase.from("inventory_items").select("id, name, unit").order("name"),
  );
}

// --- /admin (platform console; service-role client) ------------------------

/** Every organisation on the platform, newest first — the admin console's org list. */
export function listAllOrganizationsForAdmin(admin: AdminClient) {
  return readAll("field.listAllOrganizationsForAdmin", () =>
    admin
      .from("organizations")
      .select("id,name,locale,created_at")
      .order("created_at", { ascending: false }),
  );
}

/** Every active profile across the platform, for the admin console's per-org member counts. */
export function listActiveProfilesForAdmin(admin: AdminClient) {
  return readAll("field.listActiveProfilesForAdmin", () =>
    admin.from("profiles").select("organization_id,id").eq("active", true),
  );
}

/** Privacy-settings readiness per organisation — the admin console's coverage column. */
export function listPrivacySettingsForAdmin(admin: AdminClient) {
  return readAll("field.listPrivacySettingsForAdmin", () =>
    admin.from("organization_privacy_settings").select("organization_id,privacy_email"),
  );
}

/** Merchant connection status per organisation — the admin console's payments column. */
export function listMerchantConnectionsForAdmin(admin: AdminClient) {
  return readAll("field.listMerchantConnectionsForAdmin", () =>
    admin.from("merchant_connections").select("organization_id,status"),
  );
}

/** Support cases, most recently opened first — the admin console's support tab. */
export function listSupportCasesForAdmin(admin: AdminClient, limit: number) {
  return readAtMost(
    "field.listSupportCasesForAdmin",
    () =>
      admin
        .from("support_cases")
        .select(
          "id,case_number,organization_id,subject,status,severity,created_at,organizations(name)",
        )
        .order("created_at", { ascending: false }),
    limit,
  );
}

/** Support access sessions, most recently opened first — the admin console's support tab. */
export function listSupportSessionsForAdmin(admin: AdminClient, limit: number) {
  return readAtMost(
    "field.listSupportSessionsForAdmin",
    () =>
      admin
        .from("support_sessions")
        .select(
          "id,case_id,organization_id,reason,access_level,expires_at,revoked_at,organizations(name)",
        )
        .order("created_at", { ascending: false }),
    limit,
  );
}

/** Every feature flag, alphabetical — the admin console's flags tab. */
export function listFeatureFlagsForAdmin(admin: AdminClient) {
  return readAll("field.listFeatureFlagsForAdmin", () =>
    admin.from("feature_flags").select("id,key,description,enabled,rollout_percent").order("key"),
  );
}

/** Every release record, newest first — the admin console's releases tab. */
export function listReleaseRecordsForAdmin(admin: AdminClient) {
  return readAll("field.listReleaseRecordsForAdmin", () =>
    admin
      .from("release_records")
      .select(
        "id,version,title,status,risk_level,git_sha,deployment_url,regression_checklist,created_at",
      )
      .order("created_at", { ascending: false }),
  );
}

/** Recent audit-log activity for one organisation — the business-snapshot panel. */
export function listAuditLogForOrganization(
  admin: AdminClient,
  organizationId: string,
  limit: number,
) {
  return readAtMost(
    "field.listAuditLogForOrganization",
    () =>
      admin
        .from("audit_log")
        .select("table_name, action, at")
        .eq("organization_id", organizationId)
        .order("at", { ascending: false }),
    limit,
  );
}

/**
 * Every stored merchant secret's key version, for the rotation-status readout.
 *
 * Unbounded on purpose: a truncated read here would report the encryption
 * keyring as healthier than it is, hiding organisations still on a
 * superseded key.
 */
export function listMerchantSecretVersions(admin: AdminClient) {
  return readAll("field.listMerchantSecretVersions", () =>
    admin.from("merchant_secrets").select("organization_id, key_version"),
  );
}

/**
 * Every stored merchant secret's payload and key version, for the rotation
 * job itself.
 *
 * Unbounded on purpose, and separately from `listMerchantSecretVersions`
 * (different columns): a truncated read here means some organisations'
 * tokens are silently never re-encrypted, and the rotation would report
 * success without having touched them.
 */
export function listMerchantSecretsForRotation(admin: AdminClient) {
  return readAll("field.listMerchantSecretsForRotation", () =>
    admin.from("merchant_secrets").select("organization_id, encrypted_api_token, key_version"),
  );
}
