/**
 * The price book — the single most duplicated query in this codebase.
 *
 * The identical `select("id, name, description, price_minor, cost_minor,
 * taxable, image_path").order("name")` appeared inline on FIVE screens
 * (customer detail, estimate list, estimate edit, invoice list, invoice edit),
 * every one of them unpaged. A shop with more than 1000 catalogue lines showed
 * a different, silently truncated catalogue on each, and adding a column meant
 * finding all five.
 */

import type { ServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { readAll } from "./db";

/** What a line-item picker needs. */
const PICKER_COLUMNS = "id, name, description, price_minor, cost_minor, taxable, image_path";

/**
 * DERIVED FROM THE SCHEMA, NOT HAND-WRITTEN — and this file is why that rule
 * exists. The first draft declared `cost_minor: number | null`; the column is
 * `bigint not null default 0` (db/002_batch1.sql:15), so every consumer was
 * forced to write `?? 0` for a null the database cannot produce. A hand-written
 * row type is a second, unchecked copy of the schema, and it was wrong within
 * an hour of being written.
 */
export type PriceBookRow = Pick<
  Database["public"]["Tables"]["price_book"]["Row"],
  "id" | "name" | "description" | "price_minor" | "cost_minor" | "taxable" | "image_path"
>;

/** The whole catalogue, alphabetical, for a line-item picker. Paged. */
export function listForPicker(supabase: ServerClient): Promise<PriceBookRow[]> {
  return readAll("priceBook.listForPicker", () =>
    supabase.from("price_book").select(PICKER_COLUMNS).order("name"),
  );
}
