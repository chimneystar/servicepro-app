/**
 * Jobs — and the embed that returns HTTP 300 if you forget the hint.
 *
 * `jobs` has TWO foreign keys to `customers` (migration 014 added the composite
 * tenant-isolation key beside the plain one), so a bare `customers(...)` embed
 * is ambiguous and PostgREST refuses the whole request with PGRST201. Every
 * embed below therefore names its constraint: `customers!jobs_customer_id_fkey`
 * and `profiles!jobs_assigned_to_fkey`. This is the second reason the query
 * shapes belong in one file — the hint was applied to 49 call sites by hand,
 * and the next person to write `customers(name)` on a screen would have made it
 * 50.
 */

import type { ServerClient } from "@/lib/supabase/server";
import { readAll, readAtMost, readOne } from "./db";

const CUSTOMER = "customers!jobs_customer_id_fkey";
const ASSIGNEE = "profiles!jobs_assigned_to_fkey";

/** The dispatch board's row: everything the board draws, for one day. */
export function listForDispatchDay(supabase: ServerClient, date: string) {
  return readAll("jobs.listForDispatchDay", () =>
    supabase
      .from("jobs")
      .select(
        `id,service,status,scheduled_date,end_date,start_time,end_time,assigned_to,job_address,job_city,required_skills,${CUSTOMER}(name)`,
      )
      .lte("scheduled_date", date)
      .or(`end_date.gte.${date},end_date.is.null`)
      .is("deleted_at", null)
      .order("start_time"),
  );
}

/** The route sheet for one day — a technician's driving order. */
export function listForRouteDay(supabase: ServerClient, date: string) {
  return readAll("jobs.listForRouteDay", () =>
    supabase
      .from("jobs")
      .select(
        `id, service, status, price_minor, start_time, end_time, job_address, job_city, ${CUSTOMER}(name, address, city, phone), ${ASSIGNEE}(full_name)`,
      )
      .eq("scheduled_date", date)
      .is("deleted_at", null)
      .neq("status", "cancelled")
      .order("start_time"),
  );
}

/** Every job for one customer, newest first — the customer detail screen. */
export function listForCustomer(supabase: ServerClient, customerId: string) {
  return readAll("jobs.listForCustomer", () =>
    supabase
      .from("jobs")
      .select("id, service, scheduled_date, price_minor, status")
      .eq("customer_id", customerId)
      .is("deleted_at", null)
      .order("scheduled_date", { ascending: false }),
  );
}

/** Jobs in a date window, with the numbers the commission report divides. */
export function listForCommission(supabase: ServerClient, from: string, to: string) {
  return readAll("jobs.listForCommission", () =>
    supabase
      .from("jobs")
      .select("id, assigned_to, price_minor, job_expenses_minor, stage, status, scheduled_date")
      .is("deleted_at", null)
      .gte("scheduled_date", from)
      .lte("scheduled_date", to),
  );
}

/** A named set of jobs with their customer — for resolving ids to something readable. */
export function listByIdsWithCustomer(supabase: ServerClient, ids: string[]) {
  if (!ids.length) return Promise.resolve([]);
  return readAll("jobs.listByIdsWithCustomer", () =>
    supabase
      .from("jobs")
      .select(`id,service,scheduled_date,customer_id,${CUSTOMER}(name)`)
      .in("id", ids),
  );
}

/** One job, or null. Null means "no such job" OR "not yours" — see lib/data/db.ts. */
export function findById(supabase: ServerClient, id: string) {
  return readOne("jobs.findById", supabase.from("jobs").select("*").eq("id", id).maybeSingle());
}

// --- the things hanging off a job ----------------------------------------

/** Tasks on one job. */
export function listTasks(supabase: ServerClient, jobId: string) {
  return readAll("jobs.listTasks", () =>
    supabase.from("job_tasks").select("title,done").eq("job_id", jobId),
  );
}

/** Checklist items on one job. */
export function listChecklist(supabase: ServerClient, jobId: string) {
  return readAll("jobs.listChecklist", () =>
    supabase.from("job_checklist_items").select("label,checked").eq("job_id", jobId),
  );
}

/** Photo labels on one job. */
export function listPhotoLabels(supabase: ServerClient, jobId: string) {
  return readAll("jobs.listPhotoLabels", () =>
    supabase.from("job_photos").select("id,label").eq("job_id", jobId),
  );
}

/** The photos a customer may see, in the order they were taken — the job report. */
export function listCustomerVisiblePhotos(supabase: ServerClient, jobId: string) {
  return readAll("jobs.listCustomerVisiblePhotos", () =>
    supabase
      .from("job_photos")
      .select("storage_path, label")
      .eq("job_id", jobId)
      .eq("customer_visible", true)
      .order("created_at"),
  );
}

/** Priced line items on one job. */
export function listItems(supabase: ServerClient, jobId: string) {
  return readAll("jobs.listItems", () =>
    supabase
      .from("job_items")
      .select("description, qty_milli, unit_price_minor, cost_minor, sort")
      .eq("job_id", jobId)
      .order("sort"),
  );
}

/** Time entries on one job, for the labour total. */
export function listTimeEntries(supabase: ServerClient, jobId: string) {
  return readAll("jobs.listTimeEntries", () =>
    supabase.from("job_time_entries").select("user_id, started_at, ended_at").eq("job_id", jobId),
  );
}

/**
 * Timesheet rows across a window.
 *
 * `jobs!job_time_entries_job_id_fkey` for the same reason as everything else
 * here: `job_time_entries` also gained a composite key to `jobs`.
 */
export function listTimesheetEntries(supabase: ServerClient, from: string, to: string) {
  return readAll("jobs.listTimesheetEntries", () =>
    supabase
      .from("job_time_entries")
      .select(
        "started_at, ended_at, profiles(full_name), jobs!job_time_entries_job_id_fkey(service)",
      )
      .gte("started_at", `${from}T00:00:00`)
      .lte("started_at", `${to}T23:59:59`)
      .order("started_at"),
  );
}

/** Who is on which job — the dispatch board's assignment map. */
export function listAssignments(supabase: ServerClient) {
  return readAll("jobs.listAssignments", () =>
    supabase.from("job_assignments").select("job_id,profile_id,is_lead"),
  );
}

/** The org's configurable job statuses, in display order. */
export function listStatuses(supabase: ServerClient) {
  return readAll("jobs.listStatuses", () =>
    supabase.from("job_statuses").select("name, color").order("sort"),
  );
}

/** Job statuses with everything the settings screen edits. */
export function listStatusesForSettings(supabase: ServerClient) {
  return readAll("jobs.listStatusesForSettings", () =>
    supabase
      .from("job_statuses")
      .select("id, name, color, sort, is_done, is_cancelled")
      .order("sort"),
  );
}

/** The org's job types, as the schedule and jobs screens render them. */
export function listTypes(supabase: ServerClient) {
  return readAll("jobs.listTypes", () =>
    supabase
      .from("job_types")
      .select("name, color, duration_min, default_price_minor")
      .order("sort")
      .order("name"),
  );
}

/** Job types with the ids the settings screen needs to edit them. */
export function listTypesForSettings(supabase: ServerClient) {
  return readAll("jobs.listTypesForSettings", () =>
    supabase
      .from("job_types")
      .select("id, name, color, duration_min, default_price_minor")
      .order("sort")
      .order("name"),
  );
}

/** Job types with both translations — the booking settings screen. */
export function listTypesForBooking(supabase: ServerClient) {
  return readAll("jobs.listTypesForBooking", () =>
    supabase
      .from("job_types")
      .select("id,name,name_en,name_he,duration_min,default_price_minor,sort")
      .order("sort")
      .order("name"),
  );
}

/** Recent jobs for a customer-facing lookup. The bound is explicit and required. */
export function listRecentForCustomer(supabase: ServerClient, customerId: string, limit: number) {
  return readAtMost(
    "jobs.listRecentForCustomer",
    () =>
      supabase
        .from("jobs")
        .select("id, service, scheduled_date, status")
        .eq("customer_id", customerId)
        .is("deleted_at", null)
        .order("scheduled_date", { ascending: false }),
    limit,
  );
}
