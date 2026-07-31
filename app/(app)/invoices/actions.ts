"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import {
  createDocument, updateDocument, duplicateDocument, softDeleteDocument,
  voidDocument, issueCreditNote, cancelCreditNote, markDocumentSent,
  type ActionResult,
} from "@/lib/documents";

export async function createInvoice(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile();
  const res = await createDocument("invoice", formData, profile, (await getLocale()));
  if (res.ok) revalidatePath("/invoices");
  return res;
}

export async function updateInvoice(id: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile();
  const res = await updateDocument("invoice", id, formData, profile, (await getLocale()));
  if (res.ok) { revalidatePath("/invoices"); revalidatePath(`/invoices/${id}`); }
  return res;
}

export async function duplicateInvoice(id: string): Promise<{ ok: boolean; error?: string; newId?: string }> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: t((await getLocale()), "err.forbidden") }; }
  const res = await duplicateDocument("invoice", id, profile);
  if (res.ok) revalidatePath("/invoices");
  return res;
}

export async function deleteInvoice(id: string): Promise<ActionResult> {
  const locale = await getLocale();
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  const res = await softDeleteDocument("invoice", id, locale);
  if (res.ok) revalidatePath("/invoices");
  return res;
}

/**
 * Record that this invoice has gone to the customer (ledger 6a.5).
 *
 * From here the figures are locked, because the customer's public link shows
 * these same rows and an in-place edit would retroactively change what they
 * were sent. Corrections go through a credit note or a void.
 */
export async function markInvoiceSent(id: string): Promise<ActionResult> {
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: t((await getLocale()), "err.forbidden") }; }
  const res = await markDocumentSent("invoice", id);
  if (res.ok) { revalidatePath("/invoices"); revalidatePath(`/invoices/${id}`); }
  return res;
}

/** Void an invoice: cancel it, keep the document, keep the number (6a.1). */
export async function voidInvoice(id: string, reason: string): Promise<ActionResult> {
  const locale = await getLocale();
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  const res = await voidDocument("invoice", id, reason, profile, locale);
  if (res.ok) { revalidatePath("/invoices"); revalidatePath(`/invoices/${id}`); }
  return res;
}

/** Issue a credit note against an invoice (6a.1). */
export async function createCreditNote(
  invoiceId: string, amount: string, reason: string,
): Promise<ActionResult & { number?: number }> {
  const locale = await getLocale();
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  const res = await issueCreditNote(invoiceId, amount, reason, profile, locale);
  if (res.ok) { revalidatePath("/invoices"); revalidatePath(`/invoices/${invoiceId}`); }
  return res;
}

/** Cancel a credit note issued in error — recorded, never deleted (6a.1). */
export async function voidCreditNote(noteId: string, invoiceId: string, reason: string): Promise<ActionResult> {
  const locale = await getLocale();
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  const res = await cancelCreditNote(noteId, reason, profile, locale);
  if (res.ok) { revalidatePath("/invoices"); revalidatePath(`/invoices/${invoiceId}`); }
  return res;
}

/** Flip an invoice between paid and unpaid, and log/clear a payment row. */
export async function setInvoicePaid(invoiceId: string, paid: boolean): Promise<ActionResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }
  const supabase = await createClient();

  const { data: inv } = await supabase.from("invoices").select("id, total_minor").eq("id", invoiceId).single();
  if (!inv) return { ok: false, error: "not found" };

  const { error } = await supabase.from("invoices")
    .update({ status: paid ? "paid" : "unpaid", paid_at: paid ? new Date().toISOString() : null })
    .eq("id", invoiceId);
  if (error) return { ok: false, error: error.message };

  if (paid) {
    // Record a manual payment for the full balance (if none logged yet).
    const { data: existing } = await supabase.from("payments").select("id").eq("invoice_id", invoiceId).limit(1);
    if (!existing || existing.length === 0) {
      await supabase.from("payments").insert({
        organization_id: profile.organization_id, invoice_id: invoiceId,
        amount_minor: inv.total_minor, status: "paid", method: "manual",
        paid_at: new Date().toISOString(), created_by: profile.id,
      });
    }
  }
  revalidatePath("/invoices");
  return { ok: true };
}
