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
import { readAll } from "./db";

/** What a line-item picker needs. */
const PICKER_COLUMNS = "id, name, description, price_minor, cost_minor, taxable, image_path";

export type PriceBookRow = {
  id: string;
  name: string;
  description: string | null;
  price_minor: number;
  cost_minor: number | null;
  taxable: boolean;
  image_path: string | null;
};

/** The whole catalogue, alphabetical, for a line-item picker. Paged. */
export function listForPicker(supabase: ServerClient): Promise<PriceBookRow[]> {
  return readAll("priceBook.listForPicker", () =>
    supabase.from("price_book").select(PICKER_COLUMNS).order("name"),
  );
}
