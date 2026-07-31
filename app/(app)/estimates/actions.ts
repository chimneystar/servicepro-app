"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { createDocument, updateDocument, duplicateDocument, softDeleteDocument, type ActionResult } from "@/lib/documents";
// @ts-ignore -- integer-safe maths, tested in tests/money.test.mjs
import { parseAmountToMinor, parseQtyToMilli } from "@/lib/core/money.mjs";
// @ts-ignore -- pure logic, proven both ways in tests/estimate-options.test.mjs
import { isTier, tierRank, conversionReadiness } from "@/lib/core/estimate-options.mjs";

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

// =====================================================================
// 6c.4 — GOOD / BETTER / BEST OPTIONS.
//
// An option is a named bundle of line items belonging to ONE estimate. Choosing
// one COPIES its lines into `estimate_items` and recomputes the estimate's
// total. It is deliberately not a parallel document, because two things must
// survive:
//
//   * DEPOSITS. `db/024_deposit_credit.sql` credits a paid deposit through
//     `invoices.estimate_id` -> `payments.estimate_id`. The estimate row is the
//     same row before and after a choice, so that chain is untouched.
//   * CONVERSION. `convertEstimateToInvoice` reads `estimate_items`, so the
//     CHOSEN option is what converts — with no new branch and no second
//     document path that could drift.
// =====================================================================
export async function addEstimateOption(estimateId: string, values: {
  tier: string; title?: string; description?: string; recommended?: boolean; depositMinor?: number;
}): Promise<ActionResult> {
  const locale = await getLocale();
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  if (!isTier(values.tier)) return { ok: false, error: t(locale, "err.invalid") };

  const supabase = await createClient();
  const { data: est } = await supabase.from("estimates").select("id, signed_at").eq("id", estimateId).is("deleted_at", null).maybeSingle();
  if (!est) return { ok: false, error: t(locale, "err.invalid") };
  // A signed estimate cannot grow new prices underneath its signature — the
  // same rule migration 023 §6 gave approve_document.
  if (est.signed_at) return { ok: false, error: locale === "he" ? "ההצעה כבר נחתמה ואי אפשר לשנות אותה." : "This estimate is signed and can no longer be re-priced." };

  const { error } = await supabase.from("estimate_options").upsert({
    organization_id: profile.organization_id, estimate_id: estimateId,
    tier: values.tier, title: (values.title ?? "").trim().slice(0, 120),
    description: (values.description ?? "").trim().slice(0, 1000) || null,
    recommended: values.recommended === true,
    deposit_minor: Math.max(0, Math.trunc(Number(values.depositMinor ?? 0)) || 0),
    sort: tierRank(values.tier) as number, created_by: profile.id,
  }, { onConflict: "estimate_id,tier" });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/estimates/${estimateId}`);
  return { ok: true };
}

export async function deleteEstimateOption(optionId: string, estimateId: string): Promise<ActionResult> {
  const locale = await getLocale();
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  const supabase = await createClient();
  const { error } = await supabase.from("estimate_options").delete().eq("id", optionId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/estimates/${estimateId}`);
  return { ok: true };
}

export async function addEstimateOptionItem(optionId: string, estimateId: string, formData: FormData): Promise<ActionResult> {
  const locale = await getLocale();
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { ok: false, error: t(locale, "err.invalid") };
  let qty_milli = 1000, unit_price_minor = 0, cost_minor = 0;
  try {
    qty_milli = parseQtyToMilli(String(formData.get("qty") ?? "1"));
    unit_price_minor = parseAmountToMinor(String(formData.get("price") ?? "0"));
    cost_minor = parseAmountToMinor(String(formData.get("cost") ?? "0"));
  } catch { return { ok: false, error: t(locale, "err.invalid") }; }

  const supabase = await createClient();
  // The option must belong to this organisation AND this estimate: an id posted
  // in a form body is an assertion, not a fact.
  const { data: option } = await supabase.from("estimate_options")
    .select("id").eq("id", optionId).eq("estimate_id", estimateId).eq("organization_id", profile.organization_id!).maybeSingle();
  if (!option) return { ok: false, error: t(locale, "err.invalid") };

  const { error } = await supabase.from("estimate_option_items").insert({
    organization_id: profile.organization_id, option_id: optionId,
    title: String(formData.get("title") ?? "").trim().slice(0, 120) || null,
    description, qty_milli, unit_price_minor, cost_minor,
    taxable: String(formData.get("taxable") ?? "true") !== "false",
    sort: Number(formData.get("sort") ?? 0) || 0,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/estimates/${estimateId}`);
  return { ok: true };
}

export async function deleteEstimateOptionItem(itemId: string, estimateId: string): Promise<ActionResult> {
  const locale = await getLocale();
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  const supabase = await createClient();
  const { error } = await supabase.from("estimate_option_items").delete().eq("id", itemId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/estimates/${estimateId}`);
  return { ok: true };
}

/**
 * Choose an option on the customer's behalf (they rang instead of clicking).
 *
 * Goes through the SAME `select_estimate_option` RPC the public page calls, so
 * there is one implementation of "what a choice does" rather than an office
 * version and a customer version that can disagree about the total.
 */
export async function chooseEstimateOption(estimateId: string, optionId: string): Promise<ActionResult> {
  const locale = await getLocale();
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  const supabase = await createClient();
  const { data: est } = await supabase.from("estimates").select("public_token").eq("id", estimateId).is("deleted_at", null).maybeSingle();
  if (!est) return { ok: false, error: t(locale, "err.invalid") };
  const { data, error } = await supabase.rpc("select_estimate_option", {
    p_token: est.public_token, p_option: optionId, p_by: profile.full_name || "Office",
  });
  if (error) return { ok: false, error: error.message };
  const result = data as any;
  if (!result?.ok) {
    return { ok: false, error: result?.error === "already_signed"
      ? (locale === "he" ? "ההצעה כבר נחתמה." : "This estimate is already signed.")
      : t(locale, "err.invalid") };
  }
  revalidatePath(`/estimates/${estimateId}`); revalidatePath("/estimates");
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

  // 6c.4 — an estimate that OFFERS options must not convert until one is
  // CHOSEN. `estimate_items` at that moment is whatever was last written, so
  // converting would invoice a price the customer never picked. This guard is
  // what makes "the chosen option is what converts" true rather than likely.
  const { count: optionCount } = await supabase.from("estimate_options")
    .select("id", { count: "exact", head: true }).eq("estimate_id", estimateId);
  const readiness = conversionReadiness({ optionCount: optionCount ?? 0, selectedOptionId: est.selected_option_id }) as { ok: boolean; reason: string };
  if (!readiness.ok) {
    return { ok: false, error: locale === "he"
      ? "הצעת המחיר מציעה כמה חלופות ואף אחת לא נבחרה. בחרו חלופה לפני ההמרה לחשבונית."
      : "This estimate offers options and none has been chosen. Pick the option the customer agreed to before invoicing." };
  }

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
