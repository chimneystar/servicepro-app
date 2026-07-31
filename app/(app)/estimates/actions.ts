"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { createDocument, updateDocument, duplicateDocument, softDeleteDocument, type ActionResult } from "@/lib/documents";

export async function createEstimate(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile();
  const res = await createDocument("estimate", formData, profile, (await getLocale()));
  if (res.ok) revalidatePath("/estimates");
  return res;
}

export async function updateEstimate(id: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile();
  const res = await updateDocument("estimate", id, formData, profile, (await getLocale()));
  if (res.ok) { revalidatePath("/estimates"); revalidatePath(`/estimates/${id}`); }
  return res;
}

export async function duplicateEstimate(id: string): Promise<{ ok: boolean; error?: string; newId?: string }> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: t((await getLocale()), "err.forbidden") }; }
  const res = await duplicateDocument("estimate", id, profile);
  if (res.ok) revalidatePath("/estimates");
  return res;
}

export async function deleteEstimate(id: string): Promise<ActionResult> {
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: t((await getLocale()), "err.forbidden") }; }
  const res = await softDeleteDocument("estimate", id);
  if (res.ok) revalidatePath("/estimates");
  return res;
}

/** Set an estimate's status (sent / approved / rejected / draft). */
export async function setEstimateStatus(id: string, status: string): Promise<ActionResult> {
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: t((await getLocale()), "err.forbidden") }; }
  if (!["draft", "sent", "approved", "rejected"].includes(status)) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.from("estimates").update({ status }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/estimates"); revalidatePath(`/estimates/${id}`);
  return { ok: true };
}

type ConvertResult = { ok: boolean; error?: string; invoiceNumber?: number };

/** Create an invoice from an existing estimate (copies items, cost, tax, photos). */
export async function convertEstimateToInvoice(estimateId: string): Promise<ConvertResult> {
  const locale = (await getLocale());
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }

  const supabase = await createClient();
  const { data: est } = await supabase
    .from("estimates").select("*").eq("id", estimateId).is("deleted_at", null).maybeSingle();
  if (!est) return { ok: false, error: t(locale, "err.invalid") };

  // Idempotency: the button is hidden client-side once the estimate is
  // approved, but the server action accepted any repeat call and minted a
  // second invoice with a second document number. A double-click or a stale
  // tab sent the customer two invoices for one job.
  const { data: existing } = await supabase
    .from("invoices").select("number").eq("estimate_id", estimateId).is("deleted_at", null).maybeSingle();
  if (existing) return { ok: true, invoiceNumber: existing.number as number };

  const { data: items } = await supabase.from("estimate_items").select("*").eq("estimate_id", estimateId).order("sort");
  const { data: number, error: numErr } = await supabase.rpc("next_document_number", { p_org: profile.organization_id, p_kind: "invoice" });
  if (numErr) return { ok: false, error: numErr.message };

  const { data: inv, error } = await supabase.from("invoices").insert({
    organization_id: profile.organization_id, created_by: profile.id, number,
    customer_id: est.customer_id, status: "unpaid",
    discount_minor: est.discount_minor, tax_rate_bps: est.tax_rate_bps, total_minor: est.total_minor,
    notes: est.notes,
    // Load-bearing: deposits are recorded against payments.estimate_id. Without
    // this link the open balance ignores a paid deposit and the customer is
    // billed the full amount a second time. See db/024_deposit_credit.sql.
    estimate_id: est.id,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };

  if (items && items.length) {
    await supabase.from("invoice_items").insert(items.map((it: any, idx: number) => ({
      organization_id: profile.organization_id, invoice_id: inv.id,
      title: it.title, description: it.description, qty_milli: it.qty_milli, unit_price_minor: it.unit_price_minor,
      cost_minor: it.cost_minor ?? 0, taxable: it.taxable ?? true, image_path: it.image_path ?? null, sort: idx,
    })));
  }
  await supabase.from("estimates").update({ status: "approved" }).eq("id", estimateId);
  revalidatePath("/estimates"); revalidatePath("/invoices");
  return { ok: true, invoiceNumber: number as number };
}
