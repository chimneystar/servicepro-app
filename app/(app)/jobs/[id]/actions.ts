"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";
// @ts-ignore
import { computeDocument, parseAmountToMinor, parseQtyToMilli } from "@/lib/core/money.mjs";

export type PhotoResult = { ok: boolean; error?: string };

/**
 * Create an invoice from a job. If the job has line items (Items tab), the
 * invoice is built from those; otherwise it falls back to a single line
 * (the service at the job price). Totals always come from the tested engine.
 */
export async function createInvoiceFromJob(jobId: string): Promise<PhotoResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single();
  if (!job) return { ok: false, error: "not found" };
  const { data: org } = await supabase.from("organizations").select("tax_rate_bps").eq("id", profile.organization_id!).single();
  const taxRateBps = org?.tax_rate_bps ?? 0;

  const { data: jobItems } = await supabase.from("job_items")
    .select("description, qty_milli, unit_price_minor, cost_minor, sort").eq("job_id", jobId).order("sort");

  const lines = (jobItems && jobItems.length)
    ? jobItems.map((it: any) => ({ description: it.description, qty_milli: it.qty_milli, unit_price_minor: it.unit_price_minor, cost_minor: it.cost_minor ?? 0 }))
    : [{ description: job.service, qty_milli: 1000, unit_price_minor: job.price_minor, cost_minor: 0 }];

  const totals = computeDocument({ items: lines.map((l) => ({ qtyMilli: l.qty_milli, unitPriceMinor: l.unit_price_minor })), discountMinor: 0, taxRateBps });
  const { data: number, error: nErr } = await supabase.rpc("next_document_number", { p_org: profile.organization_id, p_kind: "invoice" });
  if (nErr) return { ok: false, error: nErr.message };
  const { data: inv, error } = await supabase.from("invoices").insert({
    organization_id: profile.organization_id, created_by: profile.id, number,
    customer_id: job.customer_id, job_id: jobId, status: "unpaid",
    tax_rate_bps: taxRateBps, total_minor: totals.totalMinor, discount_minor: 0,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  await supabase.from("invoice_items").insert(lines.map((l, idx) => ({
    organization_id: profile.organization_id, invoice_id: inv.id,
    description: l.description, qty_milli: l.qty_milli, unit_price_minor: l.unit_price_minor, cost_minor: l.cost_minor, sort: idx,
  })));
  revalidatePath("/invoices");
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Save the job's service address. */
export async function updateJobAddress(jobId: string, formData: FormData): Promise<PhotoResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({
    job_address: String(formData.get("job_address") ?? "").trim() || null,
    job_city: String(formData.get("job_city") ?? "").trim() || null,
  }).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

// ---- Items ----------------------------------------------------------
export async function addJobItem(jobId: string, formData: FormData): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { ok: false, error: "Description required" };
  let qty_milli = 1000, unit_price_minor = 0, cost_minor = 0;
  try {
    qty_milli = parseQtyToMilli(String(formData.get("qty") ?? "1"));
    unit_price_minor = parseAmountToMinor(String(formData.get("price") ?? "0"));
    cost_minor = parseAmountToMinor(String(formData.get("cost") ?? "0"));
  } catch { return { ok: false, error: "Invalid number" }; }
  const { error } = await supabase.from("job_items").insert({
    organization_id: profile.organization_id, job_id: jobId, description, qty_milli, unit_price_minor, cost_minor,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
export async function deleteJobItem(id: string, jobId: string): Promise<PhotoResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("job_items").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

// ---- Tasks ----------------------------------------------------------
export async function addJobTask(jobId: string, title: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  if (!title.trim()) return { ok: false, error: "Empty" };
  const supabase = await createClient();
  const { error } = await supabase.from("job_tasks").insert({ organization_id: profile.organization_id, job_id: jobId, title: title.trim() });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
export async function toggleJobTask(id: string, done: boolean, jobId: string): Promise<PhotoResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("job_tasks").update({ done }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
export async function deleteJobTask(id: string, jobId: string): Promise<PhotoResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("job_tasks").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

// ---- Checklist ------------------------------------------------------
export async function addChecklistItem(jobId: string, label: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  if (!label.trim()) return { ok: false, error: "Empty" };
  const supabase = await createClient();
  const { error } = await supabase.from("job_checklist_items").insert({ organization_id: profile.organization_id, job_id: jobId, label: label.trim() });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
export async function toggleChecklistItem(id: string, checked: boolean, jobId: string): Promise<PhotoResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("job_checklist_items").update({ checked }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
export async function deleteChecklistItem(id: string, jobId: string): Promise<PhotoResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("job_checklist_items").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

// ---- Equipment ------------------------------------------------------
export async function addEquipment(jobId: string, formData: FormData): Promise<PhotoResult> {
  const profile = await requireProfile();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name required" };
  const supabase = await createClient();
  const { error } = await supabase.from("job_equipment").insert({
    organization_id: profile.organization_id, job_id: jobId, name,
    serial: String(formData.get("serial") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
export async function deleteEquipment(id: string, jobId: string): Promise<PhotoResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("job_equipment").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

// ---- Payments -------------------------------------------------------
/** Record a payment against an invoice; marks it paid once fully covered. */
export async function recordJobPayment(invoiceId: string, jobId: string, amountStr: string, method: string, reference?: string): Promise<PhotoResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }
  const supabase = await createClient();
  let amount_minor = 0;
  try { amount_minor = parseAmountToMinor(amountStr); } catch { return { ok: false, error: "Invalid amount" }; }
  if (amount_minor <= 0) return { ok: false, error: "Amount must be greater than 0" };

  // Non-card methods should carry a reference (check #, Zelle #, transfer #).
  const needsRef = ["Check", "Zelle", "Bank transfer"].includes(method);
  if (needsRef && !(reference ?? "").trim()) return { ok: false, error: `Please enter the ${method} reference number` };

  const { data: inv } = await supabase.from("invoices").select("id, total_minor").eq("id", invoiceId).single();
  if (!inv) return { ok: false, error: "Invoice not found" };

  const { error: pErr } = await supabase.from("payments").insert({
    organization_id: profile.organization_id, invoice_id: invoiceId,
    amount_minor, status: "paid", method: method || "manual", reference: (reference ?? "").trim() || null,
    paid_at: new Date().toISOString(), created_by: profile.id,
  });
  if (pErr) return { ok: false, error: pErr.message };

  // Recompute paid total; mark invoice paid if fully covered.
  const { data: pays } = await supabase.from("payments").select("amount_minor").eq("invoice_id", invoiceId);
  const paid = (pays ?? []).reduce((s: number, p: any) => s + p.amount_minor, 0);
  if (paid >= inv.total_minor) {
    await supabase.from("invoices").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", invoiceId);
  }
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/invoices");
  return { ok: true };
}

/** Record a job photo row after the file has been uploaded to Storage. */
export async function recordPhoto(jobId: string, path: string, label: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
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
  const supabase = await createClient();
  await supabase.storage.from("job-photos").remove([path]);
  const { error } = await supabase.from("job_photos").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Update a job's status from the detail page. */
export async function updateJobStatus(jobId: string, status: string): Promise<PhotoResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ status }).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

// ---- Tech field tools ----------------------------------------------
/** Mark the technician en route (records time; SMS fires if messaging is configured). */
export async function setOnMyWay(jobId: string): Promise<PhotoResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ on_my_way_at: new Date().toISOString() }).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  // Best-effort: notify the client if an SMS provider is connected.
  try {
    const { notifyOnMyWay } = await import("@/lib/notify");
    await notifyOnMyWay(jobId);
  } catch { /* messaging optional */ }
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Clock in: open a time entry and start the job. */
export async function clockIn(jobId: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data: open } = await supabase.from("job_time_entries")
    .select("id").eq("job_id", jobId).eq("user_id", profile.id).is("ended_at", null).limit(1);
  if (open && open.length) return { ok: true }; // already clocked in
  const { error } = await supabase.from("job_time_entries").insert({
    organization_id: profile.organization_id, job_id: jobId, user_id: profile.id,
  });
  if (error) return { ok: false, error: error.message };
  await supabase.from("jobs").update({ status: "in_progress", started_at: new Date().toISOString() }).eq("id", jobId).is("started_at", null);
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Clock out: close this user's open time entry. */
export async function clockOut(jobId: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data: open } = await supabase.from("job_time_entries")
    .select("id").eq("job_id", jobId).eq("user_id", profile.id).is("ended_at", null).order("started_at", { ascending: false }).limit(1);
  if (!open || !open.length) return { ok: true };
  const { error } = await supabase.from("job_time_entries").update({ ended_at: new Date().toISOString() }).eq("id", open[0].id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Complete the job with an optional customer signature. Closes any open timer. */
export async function completeJob(jobId: string, signature: string, signedBy: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  await supabase.from("job_time_entries").update({ ended_at: new Date().toISOString() })
    .eq("job_id", jobId).eq("user_id", profile.id).is("ended_at", null);
  const { error } = await supabase.from("jobs").update({
    status: "done", completed_at: new Date().toISOString(),
    completion_signature: (signature || "").slice(0, 400000) || null,
    completion_signed_by: (signedBy || "").trim().slice(0, 120) || null,
  }).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  // Best-effort: auto-send a review request if messaging + a review link are set up.
  try { const { sendReviewRequest } = await import("@/lib/notify"); await sendReviewRequest(jobId); } catch { /* optional */ }
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Set a job's custom pipeline stage; keeps the legacy enum status in sync for
 *  the double-book constraint & reports, and records when the stage changed. */
export async function setJobStage(jobId: string, stage: string): Promise<PhotoResult> {
  await requireProfile();
  const supabase = await createClient();
  const { data: st } = await supabase.from("job_statuses").select("is_done, is_cancelled").eq("name", stage).maybeSingle();
  const enumStatus = st?.is_cancelled ? "cancelled" : st?.is_done ? "done" : /progress/i.test(stage) ? "in_progress" : "scheduled";
  const { error } = await supabase.from("jobs").update({ stage, status: enumStatus, stage_changed_at: new Date().toISOString() }).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`); revalidatePath("/jobs"); revalidatePath("/schedule");
  return { ok: true };
}

/** Add/remove tags on a job (free-form labels like "Follow up", "Waiting for payment"). */
export async function setJobTags(jobId: string, tags: string[]): Promise<PhotoResult> {
  await requireProfile();
  const clean = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean))).slice(0, 20);
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ tags: clean }).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`); revalidatePath("/jobs");
  return { ok: true };
}

/** Set the manually-entered job costs used by the commission report. */
export async function setJobExpenses(jobId: string, amountStr: string): Promise<PhotoResult> {
  await requireProfile();
  const supabase = await createClient();
  let cents = 0;
  try { cents = parseAmountToMinor(amountStr); } catch { return { ok: false, error: "Invalid amount" }; }
  const { error } = await supabase.from("jobs").update({ job_expenses_minor: Math.max(0, cents) }).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Manually send a review request. Returns whether it auto-sent + fallback contact info. */
export async function requestReview(jobId: string): Promise<{ ok: boolean; sent: boolean; reviewUrl: string | null; phone: string | null; email: string | null; error?: string }> {
  await requireProfile();
  const { sendReviewRequest } = await import("@/lib/notify");
  const r = await sendReviewRequest(jobId);
  if (!r.reviewUrl) return { ok: false, sent: false, reviewUrl: null, phone: r.phone, email: r.email, error: "Add your Google review link in Settings first." };
  return { ok: true, ...r };
}
