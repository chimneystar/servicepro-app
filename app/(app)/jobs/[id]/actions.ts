"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";
// @ts-ignore
import { computeDocument } from "@/lib/core/money.mjs";

export type PhotoResult = { ok: boolean; error?: string };

/** Create an invoice from a job (single line: the service at the job price). */
export async function createInvoiceFromJob(jobId: string): Promise<PhotoResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }
  const supabase = createClient();
  const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single();
  if (!job) return { ok: false, error: "not found" };
  const { data: org } = await supabase.from("organizations").select("tax_rate_bps").eq("id", profile.organization_id!).single();
  const taxRateBps = org?.tax_rate_bps ?? 0;
  const totals = computeDocument({ items: [{ qtyMilli: 1000, unitPriceMinor: job.price_minor }], discountMinor: 0, taxRateBps });
  const { data: number, error: nErr } = await supabase.rpc("next_document_number", { p_org: profile.organization_id, p_kind: "invoice" });
  if (nErr) return { ok: false, error: nErr.message };
  const { data: inv, error } = await supabase.from("invoices").insert({
    organization_id: profile.organization_id, created_by: profile.id, number,
    customer_id: job.customer_id, job_id: jobId, status: "unpaid",
    tax_rate_bps: taxRateBps, total_minor: totals.totalMinor, discount_minor: 0,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  await supabase.from("invoice_items").insert({
    organization_id: profile.organization_id, invoice_id: inv.id,
    description: job.service, qty_milli: 1000, unit_price_minor: job.price_minor, cost_minor: 0, sort: 0,
  });
  revalidatePath("/invoices");
  return { ok: true };
}

/** Record a job photo row after the file has been uploaded to Storage. */
export async function recordPhoto(jobId: string, path: string, label: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = createClient();
  const { error } = await supabase.from("job_photos").insert({
    organization_id: profile.organization_id,
    job_id: jobId,
    storage_path: path,
    label: label || null,
    created_by: profile.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Delete a job photo (storage object + row). */
export async function deletePhoto(id: string, path: string, jobId: string): Promise<PhotoResult> {
  await requireProfile();
  const supabase = createClient();
  await supabase.storage.from("job-photos").remove([path]);
  const { error } = await supabase.from("job_photos").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Update a job's status from the detail page. */
export async function updateJobStatus(jobId: string, status: string): Promise<PhotoResult> {
  await requireProfile();
  const supabase = createClient();
  const { error } = await supabase.from("jobs").update({ status }).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
