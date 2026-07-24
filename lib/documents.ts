import { createClient } from "@/lib/supabase/server";
import { t, type Locale } from "@/lib/i18n";
import type { Profile } from "@/lib/auth";
// @ts-ignore -- integer-safe money engine (JS module, unit-tested)
import { computeDocument, parseQtyToMilli, parseAmountToMinor } from "@/lib/core/money.mjs";

export type ActionResult = { ok: boolean; error?: string };

type LineItem = {
  title: string; description: string; qtyMilli: number; unitPriceMinor: number;
  costMinor: number; taxable: boolean; imagePath: string | null;
};

/**
 * Create an estimate or invoice. The total is ALWAYS recomputed here on the
 * server from the line items using the tested money engine (with per-item tax)
 * — the client can never submit a total we didn't calculate. Each item is also
 * saved to the reusable item library (price_book) so it can be picked next time.
 */
export async function createDocument(
  kind: "estimate" | "invoice",
  formData: FormData,
  profile: Profile,
  locale: Locale
): Promise<ActionResult> {
  const customer_id = String(formData.get("customer_id") ?? "");
  if (!customer_id) return { ok: false, error: t(locale, "err.invalid") };

  // Parallel arrays, one entry per line item row.
  const titles = formData.getAll("title").map(String);
  const descs = formData.getAll("desc").map(String);
  const qtys = formData.getAll("qty").map(String);
  const prices = formData.getAll("price").map(String);
  const costs = formData.getAll("cost").map(String);
  const taxables = formData.getAll("taxable").map(String);
  const images = formData.getAll("image_path").map(String);

  const items: LineItem[] = [];
  try {
    for (let i = 0; i < Math.max(titles.length, descs.length); i++) {
      const title = (titles[i] ?? "").trim();
      const description = (descs[i] ?? "").trim();
      if (!title && !description) continue; // skip empty rows
      items.push({
        title: title || description,
        description,
        qtyMilli: parseQtyToMilli(qtys[i] ?? "0"),
        unitPriceMinor: parseAmountToMinor(prices[i] ?? "0"),
        costMinor: parseAmountToMinor(costs[i] ?? "0"),
        taxable: (taxables[i] ?? "1") !== "0",
        imagePath: (images[i] ?? "").trim() || null,
      });
    }
  } catch {
    return { ok: false, error: t(locale, "err.invalid") };
  }
  if (items.length === 0) return { ok: false, error: t(locale, "err.invalid") };

  let discountMinor = 0;
  try { discountMinor = parseAmountToMinor(String(formData.get("discount") ?? "0")); }
  catch { return { ok: false, error: t(locale, "err.invalid") }; }

  const supabase = createClient();
  const { data: org } = await supabase
    .from("organizations").select("tax_rate_bps").eq("id", profile.organization_id!).single();
  const taxRateBps = org?.tax_rate_bps ?? 0;

  const totals = computeDocument({
    items: items.map((i) => ({ qtyMilli: i.qtyMilli, unitPriceMinor: i.unitPriceMinor, taxable: i.taxable })),
    discountMinor, taxRateBps,
  });

  const { data: number, error: numErr } = await supabase.rpc("next_document_number", {
    p_org: profile.organization_id, p_kind: kind,
  });
  if (numErr) return { ok: false, error: numErr.message };

  const table = kind === "invoice" ? "invoices" : "estimates";
  const { data: doc, error: docErr } = await supabase.from(table).insert({
    organization_id: profile.organization_id,
    created_by: profile.id,
    number,
    customer_id,
    status: kind === "invoice" ? "unpaid" : "draft",
    discount_minor: totals.discountMinor,
    tax_rate_bps: taxRateBps,
    total_minor: totals.totalMinor,
    notes: String(formData.get("notes") ?? "").trim() || null,
  }).select("id").single();
  if (docErr) return { ok: false, error: docErr.message };

  const itemsTable = kind === "invoice" ? "invoice_items" : "estimate_items";
  const parentKey = kind === "invoice" ? "invoice_id" : "estimate_id";
  const { error: itErr } = await supabase.from(itemsTable).insert(
    items.map((it, idx) => ({
      organization_id: profile.organization_id,
      [parentKey]: doc.id,
      title: it.title,
      description: it.description || it.title,
      qty_milli: it.qtyMilli,
      unit_price_minor: it.unitPriceMinor,
      cost_minor: it.costMinor,
      taxable: it.taxable,
      image_path: it.imagePath,
      sort: idx,
    }))
  );
  if (itErr) return { ok: false, error: itErr.message };

  // Save each item to the reusable library (dedupe by name, case-insensitive).
  await saveItemsToLibrary(supabase, profile.organization_id!, items);

  return { ok: true };
}

async function saveItemsToLibrary(supabase: any, orgId: string, items: LineItem[]) {
  try {
    const { data: existing } = await supabase.from("price_book").select("name").eq("organization_id", orgId);
    const have = new Set((existing ?? []).map((r: any) => String(r.name ?? "").trim().toLowerCase()));
    const seen = new Set<string>();
    const toAdd = items
      .filter((it) => {
        const k = it.title.trim().toLowerCase();
        if (!k || have.has(k) || seen.has(k)) return false;
        seen.add(k); return true;
      })
      .map((it) => ({
        organization_id: orgId, name: it.title, description: it.description || null,
        price_minor: it.unitPriceMinor, cost_minor: it.costMinor, taxable: it.taxable, image_path: it.imagePath,
      }));
    if (toAdd.length) await supabase.from("price_book").insert(toAdd);
  } catch { /* library save is best-effort; never blocks the document */ }
}
