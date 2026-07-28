"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { createDocument, updateDocument, duplicateDocument, softDeleteDocument, type ActionResult } from "@/lib/documents";

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
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: t((await getLocale()), "err.forbidden") }; }
  const res = await softDeleteDocument("invoice", id);
  if (res.ok) revalidatePath("/invoices");
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
