import { createClient } from "@/lib/supabase/server";
import { t, type Locale } from "@/lib/i18n";
import type { Profile } from "@/lib/auth";
// @ts-ignore -- integer-safe money engine (JS module, unit-tested)
import { computeDocument, parseQtyToMilli, parseAmountToMinor } from "@/lib/core/money.mjs";

export type ActionResult = { ok: boolean; error?: string };

/**
 * Create an estimate or invoice. The total is ALWAYS recomputed here on the
 * server from the line items using the tested money engine — the client can
 * never submit a total we didn't calculate.
 */
export async function createDocument(
  kind: "estimate" | "invoice",
  formData: FormData,
  profile: Profile,
  locale: Locale
): Promise<ActionResult> {
  const customer_id = String(formData.get("customer_id") ?? "");
  if (!customer_id) return { ok: false, error: t(locale, "err.invalid") };

  // Parse line items (parallel arrays desc[], qty[], price[]).
  const descs = formData.getAll("desc").map(String);
  const qtys = formData.getAll("qty").map(String);
  const prices = formData.getAll("price").map(String);
  const costs = formData.getAll("cost").map(String);

  const items: { desc: string; qtyMilli: number; unitPriceMinor: number; costMinor: number }[] = [];
  try {
    for (let i = 0; i < descs.length; i++) {
      const d = descs[i].trim();
      if (!d) continue;
      items.push({
        desc: d,
        qtyMilli: parseQtyToMilli(qtys[i] ?? "0"),
        unitPriceMinor: parseAmountToMinor(prices[i] ?? "0"),
        costMinor: parseAmountToMinor(costs[i] ?? "0"),
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

  const totals = computeDocument({ items: items.map((i) => ({ qtyMilli: i.qtyMilli, unitPriceMinor: i.unitPriceMinor })), discountMinor, taxRateBps });

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
      description: it.desc,
      qty_milli: it.qtyMilli,
      unit_price_minor: it.unitPriceMinor,
      cost_minor: it.costMinor,
      sort: idx,
    }))
  );
  if (itErr) return { ok: false, error: itErr.message };

  return { ok: true };
}
