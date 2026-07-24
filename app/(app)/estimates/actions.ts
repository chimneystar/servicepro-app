"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { createDocument, type ActionResult } from "@/lib/documents";

export type { ActionResult };

export async function createEstimate(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile();
  const res = await createDocument("estimate", formData, profile, getLocale());
  if (res.ok) revalidatePath("/estimates");
  return res;
}

/** Create an invoice from an existing estimate (copies items, cost, tax). */
export async function convertEstimateToInvoice(estimateId: string): Promise<ActionResult> {
  const locale = getLocale();
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }

  const supabase = createClient();
  const { data: est } = await supabase.from("estimates").select("*").eq("id", estimateId).single();
  if (!est) return { ok: false, error: t(locale, "err.invalid") };

  const { data: items } = await supabase.from("estimate_items").select("*").eq("estimate_id", estimateId);
  const { data: number, error: numErr } = await supabase.rpc("next_document_number", { p_org: profile.organization_id, p_kind: "invoice" });
  if (numErr) return { ok: false, error: numErr.message };

  const { data: inv, error } = await supabase.from("invoices").insert({
    organization_id: profile.organization_id, created_by: profile.id, number,
    customer_id: est.customer_id, status: "unpaid",
    discount_minor: est.discount_minor, tax_rate_bps: est.tax_rate_bps, total_minor: est.total_minor,
    notes: est.notes,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };

  if (items && items.length) {
    await supabase.from("invoice_items").insert(items.map((it: any, idx: number) => ({
      organization_id: profile.organization_id, invoice_id: inv.id,
      description: it.description, qty_milli: it.qty_milli, unit_price_minor: it.unit_price_minor,
      cost_minor: it.cost_minor ?? 0, sort: idx,
    })));
  }
  await supabase.from("estimates").update({ status: "approved" }).eq("id", estimateId);
  revalidatePath("/estimates"); revalidatePath("/invoices");
  return { ok: true };
}
