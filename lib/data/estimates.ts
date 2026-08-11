/**
 * Estimates, their line items, and the tiered options.
 *
 * `estimate_option_items` is the sharpest paging risk in this file: it was read
 * with no filter at all — every option line in the whole organisation, to
 * render ONE estimate. Past 1000 lines the screen silently started dropping
 * tiers from estimates it had nothing to do with. Both the paging and the
 * missing `option_id` filter are fixed here.
 */

import type { ServerClient } from "@/lib/supabase/server";
import { readAll, readOne } from "./db";

/** The visible lines on one estimate, in document order. */
export function listItems(supabase: ServerClient, estimateId: string) {
  return readAll("estimates.listItems", () =>
    supabase
      .from("estimate_items")
      .select("title, description, qty_milli, unit_price_minor, taxable, image_path")
      .eq("estimate_id", estimateId)
      .order("sort"),
  );
}

/** The lines on one estimate including cost — the editor. */
export function listItemsWithCost(supabase: ServerClient, estimateId: string) {
  return readAll("estimates.listItemsWithCost", () =>
    supabase
      .from("estimate_items")
      .select("title, description, qty_milli, unit_price_minor, cost_minor, taxable, image_path")
      .eq("estimate_id", estimateId)
      .order("sort"),
  );
}

/** Every column of every line on one estimate — the conversion path copies them all. */
export function listItemsFull(supabase: ServerClient, estimateId: string) {
  return readAll("estimates.listItemsFull", () =>
    supabase.from("estimate_items").select("*").eq("estimate_id", estimateId).order("sort"),
  );
}

/** The good/better/best tiers offered on one estimate. */
export function listOptions(supabase: ServerClient, estimateId: string) {
  return readAll("estimates.listOptions", () =>
    supabase
      .from("estimate_options")
      .select("id, tier, title, description, recommended, deposit_minor, total_minor, sort")
      .eq("estimate_id", estimateId)
      .order("sort"),
  );
}

/**
 * The lines belonging to a set of options.
 *
 * Takes the option ids rather than reading the table unfiltered, which is what
 * the screen did: `select(...).order("sort")` with no `where` at all.
 */
export function listOptionItems(supabase: ServerClient, optionIds: string[]) {
  if (!optionIds.length) return Promise.resolve([]);
  return readAll("estimates.listOptionItems", () =>
    supabase
      .from("estimate_option_items")
      .select("id, option_id, title, description, qty_milli, unit_price_minor, cost_minor, taxable")
      .in("option_id", optionIds)
      .order("sort"),
  );
}

/** Estimate ids raised for one customer — the customer screen's count. */
export function listIdsForCustomer(supabase: ServerClient, customerId: string) {
  return readAll("estimates.listIdsForCustomer", () =>
    supabase.from("estimates").select("id").eq("customer_id", customerId).is("deleted_at", null),
  );
}

/** One estimate, or null. */
export function findById(supabase: ServerClient, id: string) {
  return readOne(
    "estimates.findById",
    supabase.from("estimates").select("*").eq("id", id).maybeSingle(),
  );
}
