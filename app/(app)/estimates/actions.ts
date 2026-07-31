"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import {
  createDocument, updateDocument, duplicateDocument, softDeleteDocument,
  voidDocument, reopenEstimate as reopenEstimateDocument, markDocumentSent,
  type ActionResult,
} from "@/lib/documents";
// @ts-ignore -- document integrity rules (JS module, unit-tested)
import { documentLock } from "@/lib/core/documents.mjs";

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
  const locale = await getLocale();
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  const res = await softDeleteDocument("estimate", id, locale);
  if (res.ok) revalidatePath("/estimates");
  return res;
}

/**
 * Set an estimate's status (sent / approved / rejected / draft).
 *
 * Moving BACK to draft used to be a silent unlock: it cleared the 'sent' or
 * 'approved' state that is the whole basis of the edit lock, with no record
 * that it had happened. Migration 036 refuses that update outright, so rather
 * than let the user meet a database error, the dropdown says what to use
 * instead. Marking an estimate 'sent' also stamps sent_at, which is what
 * actually locks the figures (ledger 6a.5).
 */
export async function setEstimateStatus(id: string, status: string): Promise<ActionResult> {
  const locale = await getLocale();
  const he = locale === "he";
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  if (!["draft", "sent", "approved", "rejected"].includes(status)) return { ok: false, error: "invalid" };
  const supabase = await createClient();

  const { data: current } = await supabase.from("estimates")
    .select("id, status, version, signed_at, sent_at, voided_at, deleted_at").eq("id", id).maybeSingle();
  if (!current || current.deleted_at) return { ok: false, error: t(locale, "err.invalid") };

  if (status === "draft" && documentLock("estimate", current).locked) {
    return {
      ok: false,
      error: he
        ? "הצעת המחיר כבר יצאה ללקוח. כדי לחזור לטיוטה ולערוך אותה, צריך להשתמש ב״פתיחה מחדש״ ולציין סיבה — הפעולה נרשמת."
        : "This estimate has already gone to the customer. To take it back to draft and edit it, use Reopen and give a reason — that is recorded.",
    };
  }

  const { error } = await supabase.from("estimates").update({
    status,
    ...(status === "sent" && !current.sent_at ? { sent_at: new Date().toISOString() } : {}),
  }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/estimates"); revalidatePath(`/estimates/${id}`);
  return { ok: true };
}

/** Record that this estimate has gone to the customer (ledger 6a.5). */
export async function markEstimateSent(id: string): Promise<ActionResult> {
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: t((await getLocale()), "err.forbidden") }; }
  const res = await markDocumentSent("estimate", id);
  if (res.ok) { revalidatePath("/estimates"); revalidatePath(`/estimates/${id}`); }
  return res;
}

/** Void an estimate: cancel it, keep the document, keep the number (6a.1). */
export async function voidEstimate(id: string, reason: string): Promise<ActionResult> {
  const locale = await getLocale();
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  const res = await voidDocument("estimate", id, reason, profile, locale);
  if (res.ok) { revalidatePath("/estimates"); revalidatePath(`/estimates/${id}`); }
  return res;
}

/** Reopen a sent/approved/rejected estimate for re-quoting — recorded (6a.5). */
export async function reopenEstimate(id: string, reason: string): Promise<ActionResult> {
  const locale = await getLocale();
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  const res = await reopenEstimateDocument(id, reason, profile, locale);
  if (res.ok) { revalidatePath("/estimates"); revalidatePath(`/estimates/${id}`); }
  return res;
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
  // A voided estimate is cancelled, not merely finished: billing from it would
  // put a live invoice behind a document the customer was told was withdrawn.
  if (est.voided_at) {
    return {
      ok: false,
      error: locale === "he"
        ? "הצעת המחיר בוטלה, ולכן לא ניתן להפיק ממנה חשבונית."
        : "This estimate was voided, so it cannot be turned into an invoice.",
    };
  }

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
