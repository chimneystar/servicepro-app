/**
 * Customers — the query shapes the screens need, in one place.
 *
 * See `lib/data/db.ts` for why nothing here applies its own range, and for how
 * errors and row-level security are handled.
 */

import type { ServerClient } from "@/lib/supabase/server";
import { readAll, readAtMost, readOne, type Page, readPage } from "./db";
import { orIlike } from "@/lib/core/postgrest-filter.mjs";

/** The columns the list screens render. */
const LIST_COLUMNS = "id, name, phone, city, address, email, source";

export type CustomerListRow = {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  address: string | null;
  email: string | null;
  source: string | null;
};

/** Live customers, alphabetical — the /customers screen. Paged, so a business past 1000 sees all of them. */
export function listActive(supabase: ServerClient): Promise<CustomerListRow[]> {
  return readAll("customers.listActive", () =>
    supabase
      .from("customers")
      .select(LIST_COLUMNS)
      .is("deleted_at", null)
      .eq("archived", false)
      .order("name", { ascending: true }),
  );
}

/** One visible page of live customers, for a screen that paginates rather than loading everything. */
export function pageActive(
  supabase: ServerClient,
  opts: { page: number; size: number },
): Promise<Page<CustomerListRow>> {
  return readPage(
    "customers.pageActive",
    () =>
      supabase
        .from("customers")
        .select(LIST_COLUMNS)
        .is("deleted_at", null)
        .eq("archived", false)
        .order("name", { ascending: true }),
    opts,
  );
}

/** Archived (not deleted) customers — the /archive screen. */
export function listArchived(supabase: ServerClient) {
  return readAll("customers.listArchived", () =>
    supabase
      .from("customers")
      .select("id, name, phone, email, address, city, legacy_note")
      .is("deleted_at", null)
      .eq("archived", true)
      .order("name"),
  );
}

/**
 * Live, unarchived customers as `{ id, name }` — the picker every document
 * editor renders.
 *
 * Four screens each built this identical query inline (estimate edit, invoice
 * edit, recurring, and the bulk bars). That is the second half of what this
 * ledger item is about: one shape, one place, so a filter added here reaches
 * all four instead of three.
 */
export function listPickable(supabase: ServerClient) {
  return readAll("customers.listPickable", () =>
    supabase
      .from("customers")
      .select("id, name")
      .is("deleted_at", null)
      .eq("archived", false)
      .order("name"),
  );
}

/** Named customers by id — for resolving a selection back to labels. */
export function listByIds(supabase: ServerClient, ids: string[]) {
  if (!ids.length) return Promise.resolve([]);
  return readAll("customers.listByIds", () =>
    supabase.from("customers").select("id, name").in("id", ids).is("deleted_at", null),
  );
}

/** Customers with contact details, for messaging and outreach. */
export function listContactable(supabase: ServerClient) {
  return readAll("customers.listContactable", () =>
    supabase
      .from("customers")
      .select("id, name, phone, email, sms_opt_out, email_opt_out")
      .is("deleted_at", null)
      .order("name", { ascending: true }),
  );
}

/** Tax-exemption certificates held for one customer. */
export function listTaxExemptions(supabase: ServerClient, customerId: string) {
  return readAll("customers.listTaxExemptions", () =>
    supabase
      .from("customer_tax_exemptions")
      .select("id, certificate_number, reason, document_url, expires_on, active")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false }),
  );
}

/** Reviews left for one customer, most recent first. */
export function listReviews(supabase: ServerClient, customerId: string) {
  return readAll("customers.listReviews", () =>
    supabase
      .from("reviews")
      .select("id, rating, body, review_date")
      .eq("customer_id", customerId)
      .order("review_date", { ascending: false }),
  );
}

/** One customer by id, or null. Null means "no such customer" OR "not yours" — see db.ts. */
export function findById(supabase: ServerClient, id: string) {
  return readOne(
    "customers.findById",
    supabase.from("customers").select("*").eq("id", id).maybeSingle(),
  );
}

/**
 * Free-text search across the fields the /search screen offers.
 *
 * The term goes through `orIlike`, which quotes it: interpolating it raw let a
 * comma terminate the filter and append another condition (see
 * lib/core/postgrest-filter.mjs). `limit` is required by `readAtMost` — a
 * search box has no business reading an unbounded result set.
 */
export function search(supabase: ServerClient, term: string, limit: number) {
  return readAtMost(
    "customers.search",
    () =>
      supabase
        .from("customers")
        .select("id, name, phone, email, city")
        .is("deleted_at", null)
        .or(orIlike(["name", "phone", "email", "city"], term))
        .order("name", { ascending: true }),
    limit,
  );
}

/** Match an inbound phone number to a customer. At most one is used, but the number is not unique. */
export function findByPhone(supabase: ServerClient, phone: string, limit: number) {
  return readAtMost(
    "customers.findByPhone",
    () => supabase.from("customers").select("id, name, phone").eq("phone", phone),
    limit,
  );
}
