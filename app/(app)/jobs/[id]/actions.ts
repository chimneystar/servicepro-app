"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
// @ts-ignore
import { computeDocument, parseAmountToMinor, parseQtyToMilli } from "@/lib/core/money.mjs";
// @ts-ignore -- shared JS module
import { isUniqueViolation } from "@/lib/core/db-errors.mjs";
import { changeJobStatus } from "@/lib/job-status";
// @ts-ignore — transition rules, unit-tested in tests/scheduling.test.mjs
import { canTransition } from "@/lib/core/scheduling.mjs";
import { recordInventoryMovement } from "@/lib/inventory";
import { resolveDocumentTax } from "@/lib/documents";
// @ts-ignore — pure logic, proven both ways in tests/job-costing.test.mjs
import { labourInvoiceLine } from "@/lib/core/job-costing.mjs";
// @ts-ignore — pure logic, proven both ways in tests/appointments.test.mjs
import { tokenExpiryFor, normalizeEtaMinutes, confirmationSms } from "@/lib/core/appointments.mjs";
import { appUrl, providers, sendSms } from "@/lib/providers";
import * as jobsData from "@/lib/data/jobs";
import * as operationsData from "@/lib/data/operations";
import * as fieldData from "@/lib/data/field";

/**
 * The job's labour cost, through the security-definer RPC.
 *
 * The rate table is OWNER ONLY (it is payroll — see db/039 §1), so office staff
 * cannot read it directly. `job_labour_cost` returns money for ONE job and
 * never a person's rate, which is what lets an office user cost a job without
 * being handed the wage bill. A refusal is not fatal: it returns zeros and the
 * caller says the figure is incomplete rather than inventing one.
 */
async function readJobLabour(supabase: Awaited<ReturnType<typeof createClient>>, jobId: string) {
  const { data, error } = await supabase.rpc("job_labour_cost", { p_job: jobId });
  if (error || !data)
    return {
      minutes: 0,
      cost_minor: 0,
      unpriced_technicians: 0,
      open_entries: 0,
      available: false,
    };
  const row = data as any;
  return {
    minutes: Number(row.minutes ?? 0),
    cost_minor: Number(row.cost_minor ?? 0),
    unpriced_technicians: Number(row.unpriced_technicians ?? 0),
    open_entries: Number(row.open_entries ?? 0),
    available: true,
  };
}

/**
 * Snapshot the job's labour cost onto the job (6c.2).
 *
 * Stored rather than derived on every read, for the same reason an invoice
 * caches its total: a job costed in March must not silently re-cost itself when
 * the wage changes in June, and the reporting path must not have to re-read
 * timesheets it is not permitted to see.
 */
export async function recomputeJobLabourCost(jobId: string): Promise<PhotoResult> {
  let profile;
  try {
    profile = await requireProfile();
    assertRole(profile, ["owner", "office"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = await createClient();
  const labour = await readJobLabour(supabase, jobId);
  if (!labour.available)
    return { ok: false, error: "Job costing is unavailable — run migration 039." };
  const { error } = await supabase
    .from("jobs")
    .update({
      labour_minutes: labour.minutes,
      labour_cost_minor: labour.cost_minor,
      labour_costed_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("organization_id", profile.organization_id!);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

export type PhotoResult = {
  ok: boolean;
  error?: string;
  /** "insufficient_stock" — the caller may offer the deliberate override. */
  code?: string;
  availableMilli?: number;
};

/**
 * A technician may only act on a job assigned to them. Owner and office are
 * unrestricted.
 *
 * WHY THIS EXISTS. Nine write actions in this file were gated by
 * `await requireProfile()` with the result DISCARDED — that authenticates the
 * caller and authorises nothing. Any signed-in technician could toggle another
 * technician's checklist, mark someone else's job as arrived, retag it, rewrite
 * its expenses, or delete its tasks and equipment. Row-level security did not
 * help: these rows belong to the same organisation, which is exactly what RLS
 * checks.
 *
 * The rule is not invented here — `setJobStage` already enforced it. These
 * actions simply never got it. Deliberately scoped to jobs: it removes nothing
 * from anyone who legitimately had it, because a technician acting on their own
 * job still passes.
 */
async function assertJobAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profile: { id: string; role: string },
  jobId: string,
): Promise<PhotoResult | null> {
  if (profile.role !== "tech") return null;
  const { data: job } = await supabase
    .from("jobs")
    .select("assigned_to")
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!job) return { ok: false, error: "Job not found." };
  if (job.assigned_to !== profile.id)
    return { ok: false, error: "This job is not assigned to you." };
  return null;
}

export async function generateJobSummary(jobId: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  const locale = await getLocale();
  const he = locale === "he";
  const supabase = await createClient();
  const [{ data: job }, tasks, checks, photos] = await Promise.all([
    supabase
      .from("jobs")
      .select("id,service,status,notes,assigned_to,customers!jobs_customer_org_fk(name)")
      .eq("id", jobId)
      .maybeSingle(),
    jobsData.listTasks(supabase, jobId),
    jobsData.listChecklist(supabase, jobId),
    jobsData.listPhotoLabels(supabase, jobId),
  ]);
  if (!job || (profile.role === "tech" && job.assigned_to !== profile.id))
    return { ok: false, error: "forbidden" };
  const customer = Array.isArray(job.customers) ? job.customers[0]?.name : null;
  const sources = {
    service: job.service,
    customer,
    status: job.status,
    notes: job.notes ?? "",
    completedTasks: tasks.filter((row) => row.done).map((row) => row.title),
    openTasks: tasks.filter((row) => !row.done).map((row) => row.title),
    checklist: checks.filter((row) => row.checked).map((row) => row.label),
    photoLabels: photos.map((row) => row.label).filter(Boolean),
  };
  let summary = he
    ? `${job.service}${customer ? ` עבור ${customer}` : ""}. ${job.notes ? `לפי הערות הטכנאי: ${job.notes}` : "לא נוספו הערות טכנאי."} הושלמו ${sources.completedTasks.length} משימות ו-${sources.checklist.length} סעיפים ברשימת הבדיקה. ${sources.openTasks.length ? `נשארו לטיפול: ${sources.openTasks.join(", ")}.` : "לא נשארו משימות פתוחות."}`
    : `${job.service}${customer ? ` for ${customer}` : ""}. ${job.notes ? `Technician notes: ${job.notes}` : "No technician notes were added."} ${sources.completedTasks.length} tasks and ${sources.checklist.length} checklist items were completed. ${sources.openTasks.length ? `Still needs attention: ${sources.openTasks.join(", ")}.` : "No open tasks remain."}`;
  let provider = "ServicePro structured summary";
  let model: string | null = null;
  const endpoint = process.env.AI_SUMMARY_ENDPOINT;
  const key = process.env.AI_SUMMARY_API_KEY;
  if (endpoint && key) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ locale, sources }),
      });
      const payload = await response.json();
      if (response.ok && typeof payload.summary === "string" && payload.summary.trim()) {
        summary = payload.summary.trim().slice(0, 8000);
        provider = "configured AI provider";
        model = typeof payload.model === "string" ? payload.model.slice(0, 120) : null;
      }
    } catch {
      /* Keep the safe local draft. */
    }
  }
  const { error } = await supabase.from("job_summary_drafts").insert({
    organization_id: profile.organization_id,
    job_id: jobId,
    summary,
    source_refs: {
      taskCount: tasks.length,
      checklistCount: checks.length,
      photoIds: photos.map((row) => row.id),
    },
    provider,
    model,
    created_by: profile.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

export async function approveJobSummary(summaryId: string, jobId: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase
    .from("job_summary_drafts")
    .update({ status: "approved", approved_by: profile.id, approved_at: new Date().toISOString() })
    .eq("id", summaryId)
    .eq("job_id", jobId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/**
 * Create an invoice from a job. If the job has line items (Items tab), the
 * invoice is built from those; otherwise it falls back to a single line
 * (the service at the job price). Totals always come from the tested engine.
 */
export async function createInvoiceFromJob(jobId: string): Promise<PhotoResult> {
  let profile;
  try {
    profile = await requireProfile();
    assertRole(profile, ["owner", "office"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single();
  if (!job) return { ok: false, error: "not found" };
  // Invoicing from a job is a second document-creation path that never went
  // through lib/documents.ts. It reads the same tax resolution, so a jurisdiction
  // rate or an exemption certificate cannot apply on one route and not the other.
  const tax = await resolveDocumentTax(
    supabase,
    profile.organization_id!,
    job.customer_id,
    new Date().toISOString().slice(0, 10),
  );

  const jobItems = await jobsData.listItems(supabase, jobId);

  const lines: {
    description: string;
    qty_milli: number;
    unit_price_minor: number;
    cost_minor: number;
    taxable?: boolean;
  }[] = jobItems.length
    ? jobItems.map((it: any) => ({
        description: it.description,
        qty_milli: it.qty_milli,
        unit_price_minor: it.unit_price_minor,
        cost_minor: it.cost_minor ?? 0,
      }))
    : [
        {
          description: job.service,
          qty_milli: 1000,
          unit_price_minor: job.price_minor,
          cost_minor: 0,
        },
      ];

  // 6c.2 — THE LABOUR COST FINALLY REACHES A PROFIT FIGURE.
  //
  // /reports derives gross profit from `invoice_items.cost_minor` and nothing
  // else. Materials got there in 5.11; labour never did, so every margin the
  // owner has ever seen counted the technician's time as free. This is the one
  // place it can land without inventing a second reporting path.
  //
  // The line is priced at ZERO — the labour is already inside the service price
  // and the customer is not charged twice — and carries the cost, so
  // qty(1) x cost = the labour cost exactly. When the job has no item lines the
  // service line carries it instead, so no extra row appears on a simple
  // invoice at all.
  const labour = await readJobLabour(supabase, jobId);
  if (labour.cost_minor > 0) {
    if (jobItems && jobItems.length) {
      const line = labourInvoiceLine({ minutes: labour.minutes, costMinor: labour.cost_minor }) as {
        description: string;
        qty_milli: number;
        unit_price_minor: number;
        cost_minor: number;
        taxable: boolean;
      } | null;
      if (line) lines.push(line);
    } else {
      lines[0].cost_minor = labour.cost_minor;
    }
    await supabase
      .from("jobs")
      .update({
        labour_minutes: labour.minutes,
        labour_cost_minor: labour.cost_minor,
        labour_costed_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("organization_id", profile.organization_id!);
  }

  const totals = computeDocument({
    items: lines.map((l) => ({ qtyMilli: l.qty_milli, unitPriceMinor: l.unit_price_minor })),
    discountMinor: 0,
    taxRateBps: tax.taxRateBps,
    taxExempt: tax.taxExempt,
  });
  const { data: number, error: nErr } = await supabase.rpc("next_document_number", {
    p_org: profile.organization_id,
    p_kind: "invoice",
  });
  if (nErr) return { ok: false, error: nErr.message };
  const { data: inv, error } = await supabase
    .from("invoices")
    .insert({
      organization_id: profile.organization_id,
      created_by: profile.id,
      number,
      customer_id: job.customer_id,
      job_id: jobId,
      status: "unpaid",
      tax_rate_bps: totals.taxRateBps,
      total_minor: totals.totalMinor,
      discount_minor: 0,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  await supabase.from("invoice_items").insert(
    lines.map((l, idx) => ({
      organization_id: profile.organization_id,
      invoice_id: inv.id,
      description: l.description,
      qty_milli: l.qty_milli,
      unit_price_minor: l.unit_price_minor,
      cost_minor: l.cost_minor,
      taxable: l.taxable ?? true,
      sort: idx,
    })),
  );
  revalidatePath("/invoices");
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Save the job's service address. */
export async function updateJobAddress(jobId: string, formData: FormData): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const denied = await assertJobAccess(supabase, profile, jobId);
  if (denied) return denied;
  const { error } = await supabase
    .from("jobs")
    .update({
      job_address: String(formData.get("job_address") ?? "").trim() || null,
      job_city: String(formData.get("job_city") ?? "").trim() || null,
    })
    .eq("id", jobId);
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
  let qty_milli = 1000,
    unit_price_minor = 0,
    cost_minor = 0;
  try {
    qty_milli = parseQtyToMilli(String(formData.get("qty") ?? "1"));
    unit_price_minor = parseAmountToMinor(String(formData.get("price") ?? "0"));
    cost_minor = parseAmountToMinor(String(formData.get("cost") ?? "0"));
  } catch {
    return { ok: false, error: "Invalid number" };
  }
  const { error } = await supabase.from("job_items").insert({
    organization_id: profile.organization_id,
    job_id: jobId,
    description,
    qty_milli,
    unit_price_minor,
    cost_minor,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
/**
 * Fit a part from stock onto this job.
 *
 * THE GAP THIS CLOSES (remediation plan 5.11). `grep -n inventory` over this
 * file returned NOTHING: a technician could add "3 × thermocouple" to a job and
 * the warehouse count did not move, so inventory drifted out of true within a
 * week — and because the line carried no cost, the job's margin pretended the
 * materials were free.
 *
 * Two writes, no transaction across PostgREST, so the order matters: the job
 * line is written first and REMOVED again if the stock movement is refused.
 * The other order — consume, then fail to write the line — would take stock
 * off the shelf for a job that never records having used it, which is the
 * failure that cannot be spotted afterwards.
 */
export async function addJobPart(jobId: string, formData: FormData): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const itemId = String(formData.get("inventoryItemId") ?? "").trim();
  if (!itemId) return { ok: false, error: "Choose a part" };
  const allowNegative = String(formData.get("allowNegative") ?? "") === "true";

  let qtyMilli = 0;
  try {
    qtyMilli = parseQtyToMilli(String(formData.get("qty") ?? "1"));
  } catch {
    return { ok: false, error: "Invalid quantity" };
  }
  if (qtyMilli <= 0) return { ok: false, error: "Enter a quantity" };

  const { data: part } = await supabase
    .from("inventory_items")
    .select("id, name, unit, cost_minor, quantity_milli")
    .eq("id", itemId)
    .maybeSingle();
  if (!part) return { ok: false, error: "Part not found" };

  let unitPriceMinor = 0;
  const priceRaw = String(formData.get("price") ?? "").trim();
  try {
    unitPriceMinor = priceRaw ? parseAmountToMinor(priceRaw) : (part.cost_minor ?? 0);
  } catch {
    return { ok: false, error: "Invalid price" };
  }

  const description = String(formData.get("description") ?? "").trim() || part.name;

  const { data: line, error } = await supabase
    .from("job_items")
    .insert({
      organization_id: profile.organization_id,
      job_id: jobId,
      description,
      qty_milli: qtyMilli,
      unit_price_minor: unitPriceMinor,
      // The cost the business actually bore. This is what makes job costing
      // include materials at all.
      cost_minor: part.cost_minor ?? 0,
    })
    .select("id")
    .single();
  if (error || !line) return { ok: false, error: error?.message ?? "Could not add the part" };

  const moved = await recordInventoryMovement(profile.organization_id!, profile.id, {
    itemId,
    kind: "consumption",
    qtyMilli: -qtyMilli,
    reason: `Fitted on job`,
    unitCostMinor: part.cost_minor ?? 0,
    jobId,
    jobItemId: line.id,
    allowNegative,
  });
  if (!moved.ok) {
    // Compensate: the line must not survive a refused consumption, or the job
    // would claim a part that stock never gave up.
    await supabase.from("job_items").delete().eq("id", line.id);
    return {
      ok: false,
      error: moved.error,
      code: moved.code,
      availableMilli: moved.availableMilli,
    };
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/inventory");
  return { ok: true };
}

/**
 * Remove a job line. If the line consumed stock, the stock goes back — as a new
 * movement, never by deleting the old one: the ledger is append-only, so the
 * history shows it was taken and returned rather than pretending it never left.
 */
export async function deleteJobItem(id: string, jobId: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const consumed = await operationsData.listMovementsForJobItem(supabase, id);

  const { error } = await supabase.from("job_items").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  for (const m of consumed) {
    if (m.qty_milli >= 0) continue;
    await recordInventoryMovement(profile.organization_id!, profile.id, {
      itemId: m.item_id,
      kind: "adjustment",
      qtyMilli: -m.qty_milli,
      reason: "Returned to stock: job line removed",
      unitCostMinor: m.unit_cost_minor,
      jobId,
    });
  }

  revalidatePath(`/jobs/${jobId}`);
  if (consumed.length) revalidatePath("/inventory");
  return { ok: true };
}

// ---- Tasks ----------------------------------------------------------
export async function addJobTask(jobId: string, title: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  if (!title.trim()) return { ok: false, error: "Empty" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("job_tasks")
    .insert({ organization_id: profile.organization_id, job_id: jobId, title: title.trim() });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
export async function toggleJobTask(
  id: string,
  done: boolean,
  jobId: string,
): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const denied = await assertJobAccess(supabase, profile, jobId);
  if (denied) return denied;
  const { error } = await supabase.from("job_tasks").update({ done }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
export async function deleteJobTask(id: string, jobId: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const denied = await assertJobAccess(supabase, profile, jobId);
  if (denied) return denied;
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
  const { error } = await supabase
    .from("job_checklist_items")
    .insert({ organization_id: profile.organization_id, job_id: jobId, label: label.trim() });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
export async function toggleChecklistItem(
  id: string,
  checked: boolean,
  jobId: string,
): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const denied = await assertJobAccess(supabase, profile, jobId);
  if (denied) return denied;
  const { error } = await supabase.from("job_checklist_items").update({ checked }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
export async function deleteChecklistItem(id: string, jobId: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const denied = await assertJobAccess(supabase, profile, jobId);
  if (denied) return denied;
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
    organization_id: profile.organization_id,
    job_id: jobId,
    name,
    serial: String(formData.get("serial") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
export async function deleteEquipment(id: string, jobId: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const denied = await assertJobAccess(supabase, profile, jobId);
  if (denied) return denied;
  const { error } = await supabase.from("job_equipment").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

// ---- Payments -------------------------------------------------------
/** Record a payment against an invoice; marks it paid once fully covered. */
export async function recordJobPayment(
  invoiceId: string,
  jobId: string,
  amountStr: string,
  method: string,
  reference?: string,
): Promise<PhotoResult> {
  let profile;
  try {
    profile = await requireProfile();
    assertRole(profile, ["owner", "office"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = await createClient();
  let amount_minor = 0;
  try {
    amount_minor = parseAmountToMinor(amountStr);
  } catch {
    return { ok: false, error: "Invalid amount" };
  }
  if (amount_minor <= 0) return { ok: false, error: "Amount must be greater than 0" };

  // Non-card methods should carry a reference (check #, Zelle #, transfer #).
  const needsRef = ["Check", "Zelle", "Bank transfer"].includes(method);
  if (needsRef && !(reference ?? "").trim())
    return { ok: false, error: `Please enter the ${method} reference number` };

  const { data: inv } = await supabase
    .from("invoices")
    .select("id, total_minor")
    .eq("id", invoiceId)
    .single();
  if (!inv) return { ok: false, error: "Invoice not found" };

  const { error: pErr } = await supabase.from("payments").insert({
    organization_id: profile.organization_id,
    invoice_id: invoiceId,
    amount_minor,
    status: "paid",
    method: method || "manual",
    reference: (reference ?? "").trim() || null,
    paid_at: new Date().toISOString(),
    created_by: profile.id,
  });
  if (pErr) return { ok: false, error: pErr.message };

  // Recompute paid total; mark invoice paid if fully covered.
  const pays = await fieldData.listPaymentAmountsForInvoice(supabase, invoiceId);
  const paid = pays.reduce((s: number, p: any) => s + p.amount_minor, 0);
  if (paid >= inv.total_minor) {
    await supabase
      .from("invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", invoiceId);
  }
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/invoices");
  return { ok: true };
}

/** Record a job photo row after the file has been uploaded to Storage. */
export async function recordPhoto(
  jobId: string,
  path: string,
  label: string,
  mediaType: "image" | "video" = "image",
  parentPhotoId?: string,
): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("job_photos").insert({
    organization_id: profile.organization_id,
    job_id: jobId,
    storage_path: path,
    label: label || null,
    media_type: mediaType,
    parent_photo_id: parentPhotoId || null,
    created_by: profile.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/**
 * Show or hide a photo on the customer's job report.
 *
 * job_photos.customer_visible has existed since migration 019 (default true),
 * was selected and passed to the component, and NOTHING could change it and
 * nothing read it — so every photo, including internal evidence shots, appeared
 * on the report handed to the customer. This is the missing half.
 */
export async function setPhotoCustomerVisible(
  photoId: string,
  visible: boolean,
  jobId: string,
): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: photo } = await supabase
    .from("job_photos")
    .select("id, organization_id")
    .eq("id", photoId)
    .maybeSingle();
  if (!photo) return { ok: false, error: "not_found" };
  if (photo.organization_id !== profile.organization_id) return { ok: false, error: "forbidden" };

  const { error } = await supabase
    .from("job_photos")
    .update({ customer_visible: visible })
    .eq("id", photo.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/report`);
  return { ok: true };
}

/**
 * Delete a job photo (row + storage object).
 *
 * SECURITY: the storage path is derived from the row, never taken from the
 * caller. It previously accepted a client-supplied `path` and removed it before
 * checking anything, so any signed-in user could delete any object in the
 * bucket — and the file was gone even when the row delete then failed.
 * The `path` parameter is retained for call-site compatibility and ignored.
 */
export async function deletePhoto(id: string, _path: string, jobId: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();

  // Read first: RLS scopes this to the caller's organisation.
  const { data: photo } = await supabase
    .from("job_photos")
    .select("id, storage_path, job_id, organization_id")
    .eq("id", id)
    .maybeSingle();
  if (!photo) return { ok: false, error: "not_found" };
  if (photo.organization_id !== profile.organization_id) return { ok: false, error: "forbidden" };

  // Delete the row first. If that is refused, the file must survive.
  const { error } = await supabase.from("job_photos").delete().eq("id", photo.id);
  if (error) return { ok: false, error: error.message };

  if (photo.storage_path) {
    const { error: storageError } = await supabase.storage
      .from("job-photos")
      .remove([photo.storage_path]);
    if (storageError)
      console.error(
        `[deletePhoto] row ${photo.id} deleted but object ${photo.storage_path} remains:`,
        storageError.message,
      );
  }

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Update a job's status from the detail page. */
/** See setJobStatus in schedule/actions.ts — same guard, same reasoning. */
export async function updateJobStatus(jobId: string, status: string): Promise<PhotoResult> {
  const result = await changeJobStatus(jobId, status);
  if (!result.ok) return result;
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

// ---- Appointment confirmation + arrival tracking (6c.8) -------------
/**
 * Mint (or re-mint) the customer's appointment link.
 *
 * THE TOKEN RULES ARE 023 §10's RULES, applied from the start rather than
 * retrofitted: it EXPIRES (`expires_at` is NOT NULL, tied to the appointment
 * rather than to a fixed window from issue), it is REVOCABLE, and it exposes
 * only this one appointment through `public_appointment` — no price, no
 * document token, no other job, no address. Re-issuing REVOKES the previous
 * link rather than leaving two live links in two text messages.
 */
async function mintAppointmentToken(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  jobId: string,
  scheduledDate: string,
  actorId: string,
): Promise<string | null> {
  const { data: live } = await supabase
    .from("appointment_tokens")
    .select("id, token, expires_at")
    .eq("job_id", jobId)
    .is("revoked_at", null)
    .maybeSingle();
  const expiresAt = tokenExpiryFor(scheduledDate) as string;
  if (live) {
    // Same link, refreshed deadline: the customer may already have it in a text.
    await supabase.from("appointment_tokens").update({ expires_at: expiresAt }).eq("id", live.id);
    return live.token as string;
  }
  const { data: created, error } = await supabase
    .from("appointment_tokens")
    .insert({
      organization_id: organizationId,
      job_id: jobId,
      expires_at: expiresAt,
      created_by: actorId,
    })
    .select("token")
    .single();
  if (error || !created) return null;
  return created.token as string;
}

export type AppointmentLinkResult = {
  ok: boolean;
  error?: string;
  url?: string;
  sent?: boolean;
  notice?: string;
};

/** Issue the link and, if SMS is connected, text it to the customer. */
export async function sendAppointmentConfirmation(jobId: string): Promise<AppointmentLinkResult> {
  let profile;
  try {
    profile = await requireProfile();
    assertRole(profile, ["owner", "office"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const locale = await getLocale();
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, service, scheduled_date, start_time, organization_id, customers!jobs_customer_org_fk(name, phone, sms_opt_in)",
    )
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!job) return { ok: false, error: "not_found" };

  const token = await mintAppointmentToken(
    supabase,
    profile.organization_id!,
    jobId,
    String(job.scheduled_date),
    profile.id,
  );
  if (!token) return { ok: false, error: "Could not create the link — run migration 039." };

  const base = appUrl();
  const url = base ? `${base.replace(/\/$/, "")}/p/${token}/visit` : `/p/${token}/visit`;

  const customer: any = Array.isArray(job.customers) ? job.customers[0] : job.customers;
  const phone = customer?.phone && customer.phone !== "—" ? customer.phone : null;
  // Consent is enforced here exactly as the reminder loops enforce it: an UNSET
  // opt-in is refused as well as a false one, because a query that forgot the
  // column would otherwise look like universal consent.
  if (customer?.sms_opt_in !== true) {
    return {
      ok: true,
      url,
      sent: false,
      notice:
        locale === "he"
          ? "הקישור נוצר. הלקוח לא אישר קבלת SMS, לכן לא נשלחה הודעה."
          : "Link created. This customer has not opted in to SMS, so nothing was sent — share the link yourself.",
    };
  }
  if (!providers.sms() || !phone || !base) {
    return {
      ok: true,
      url,
      sent: false,
      notice:
        locale === "he"
          ? "הקישור נוצר אך לא נשלח: שירות ה-SMS או כתובת האפליקציה אינם מוגדרים."
          : "Link created but NOT sent: SMS or the app URL is not configured. Send the link yourself.",
    };
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", job.organization_id)
    .single();
  const body = confirmationSms({
    businessName: org?.name ?? "",
    service: job.service ?? "",
    date: job.scheduled_date,
    time: job.start_time,
    url,
    locale,
  }) as string;
  try {
    const sid = await sendSms(phone, body);
    await supabase.from("sms_messages").insert({
      organization_id: job.organization_id,
      job_id: jobId,
      to_phone: phone,
      body,
      provider: "twilio",
      provider_message_id: sid,
      status: "sent",
      sent_at: new Date().toISOString(),
    });
    revalidatePath(`/jobs/${jobId}`);
    return { ok: true, url, sent: true };
  } catch (cause: any) {
    await supabase.from("sms_messages").insert({
      organization_id: job.organization_id,
      job_id: jobId,
      to_phone: phone,
      body,
      provider: "twilio",
      status: "failed",
      error: String(cause?.message ?? cause).slice(0, 500),
    });
    return {
      ok: true,
      url,
      sent: false,
      notice:
        locale === "he"
          ? "הקישור נוצר אך שליחת ה-SMS נכשלה."
          : "Link created but the SMS failed to send. Share the link yourself.",
    };
  }
}

/** Revoke the customer's link immediately. Revocation is checked before expiry. */
export async function revokeAppointmentLink(jobId: string): Promise<PhotoResult> {
  let profile;
  try {
    profile = await requireProfile();
    assertRole(profile, ["owner", "office"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("appointment_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("job_id", jobId)
    .eq("organization_id", profile.organization_id!)
    .is("revoked_at", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

// ---- Tech field tools ----------------------------------------------
/**
 * Mark the technician en route.
 *
 * The "on my way" text used to point at nothing at all — it was the message
 * every business sends and the one that generates the "where are they?" call it
 * was supposed to prevent. It now carries an ETA and a live arrival page.
 */
export async function setOnMyWay(
  jobId: string,
  etaMinutes?: number | string,
): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const eta = normalizeEtaMinutes(etaMinutes) as number | null;
  const { error } = await supabase
    .from("jobs")
    .update({ on_my_way_at: new Date().toISOString(), on_my_way_eta_minutes: eta })
    .eq("id", jobId);
  if (error) return { ok: false, error: error.message };

  // The tracking link rides on the existing template SMS rather than becoming a
  // second text: two messages for one event is how a business trains its
  // customers to ignore both.
  let trackUrl: string | null = null;
  const { data: job } = await supabase
    .from("jobs")
    .select("scheduled_date, organization_id")
    .eq("id", jobId)
    .maybeSingle();
  if (job) {
    const token = await mintAppointmentToken(
      supabase,
      job.organization_id,
      jobId,
      String(job.scheduled_date),
      profile.id,
    );
    const base = appUrl();
    if (token && base) trackUrl = `${base.replace(/\/$/, "")}/p/${token}/visit`;
  }
  try {
    const { notifyOnMyWay } = await import("@/lib/notify");
    await notifyOnMyWay(jobId, { trackUrl, etaMinutes: eta });
  } catch {
    /* messaging optional */
  }
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Record the arrival, so the customer's page stops saying "on the way". */
export async function markArrived(jobId: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const denied = await assertJobAccess(supabase, profile, jobId);
  if (denied) return denied;
  const { error } = await supabase
    .from("jobs")
    .update({ arrived_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/**
 * Clock in: open a time entry and start the job.
 *
 * This used to read the open entries and then insert — a race that a
 * double-tap, or a phone and a tablet, would both win, leaving two open entries
 * and a job page double-counting elapsed hours. The insert is now the only
 * check: `uq_job_time_entries_one_open` (migration 023) is unique on
 * (job_id, user_id) where ended_at is null, so the second writer loses at the
 * database and is told, correctly, that they are already clocked in.
 */
export async function clockIn(jobId: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("job_time_entries").insert({
    organization_id: profile.organization_id,
    job_id: jobId,
    user_id: profile.id,
  });
  // 23505 = the open-entry unique index: already clocked in, which is what the
  // technician wanted. Anything else is a real failure and must surface.
  if (error && !isUniqueViolation(error)) return { ok: false, error: error.message };
  // Only move the job forward if that is a legal transition. `.is("started_at",
  // null)` alone would restart a job that was completed and never clocked.
  await supabase
    .from("jobs")
    .update({ status: "in_progress", started_at: new Date().toISOString() })
    .eq("id", jobId)
    .is("started_at", null)
    .in("status", ["scheduled", "in_progress"]);
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Clock out: close this user's open time entry. */
export async function clockOut(jobId: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const open = await fieldData.listOpenTimeEntryId(supabase, jobId, profile.id);
  if (!open.length) return { ok: true };
  const { error } = await supabase
    .from("job_time_entries")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", open[0].id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Complete the job with an optional customer signature. Closes any open timer. */
export async function completeJob(
  jobId: string,
  signature: string,
  signedBy: string,
): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  await supabase
    .from("job_time_entries")
    .update({ ended_at: new Date().toISOString() })
    .eq("job_id", jobId)
    .eq("user_id", profile.id)
    .is("ended_at", null);
  const { error } = await supabase
    .from("jobs")
    .update({
      status: "done",
      completed_at: new Date().toISOString(),
      completion_signature: (signature || "").slice(0, 400000) || null,
      completion_signed_by: (signedBy || "").trim().slice(0, 120) || null,
    })
    .eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  // Best-effort: auto-send a review request if messaging + a review link are set up.
  try {
    const { sendReviewRequest } = await import("@/lib/notify");
    await sendReviewRequest(jobId);
  } catch {
    /* optional */
  }
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Set a job's custom pipeline stage; keeps the legacy enum status in sync for
 *  the double-book constraint & reports, and records when the stage changed. */
export async function setJobStage(jobId: string, stage: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data: st } = await supabase
    .from("job_statuses")
    .select("is_done, is_cancelled")
    .eq("name", stage)
    .maybeSingle();
  const enumStatus = st?.is_cancelled
    ? "cancelled"
    : st?.is_done
      ? "done"
      : /progress/i.test(stage)
        ? "in_progress"
        : "scheduled";

  // The transition guard has to apply HERE, not only on the two status actions.
  // This is the live path — it is what the stage dropdown calls — and it derives
  // the enum status from the stage and wrote it straight to the column. Moving a
  // completed job back to an earlier stage silently REOPENED it, defeating the
  // terminal-status rule that lib/core/scheduling.mjs has always defined.
  const { data: current } = await supabase
    .from("jobs")
    .select("status, assigned_to")
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!current) return { ok: false, error: "Job not found." };
  if (profile.role === "tech" && current.assigned_to !== profile.id) {
    return { ok: false, error: "This job is not assigned to you." };
  }
  const from = String(current.status ?? "scheduled");
  if (from !== enumStatus && !canTransition(from, enumStatus)) {
    return {
      ok: false,
      error:
        from === "done" || from === "cancelled"
          ? `This job is already ${from} and cannot be moved back. Create a new job instead.`
          : `A job cannot go from ${from} to ${enumStatus}.`,
    };
  }

  const { error } = await supabase
    .from("jobs")
    .update({ stage, status: enumStatus, stage_changed_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/schedule");
  return { ok: true };
}

/** Add/remove tags on a job (free-form labels like "Follow up", "Waiting for payment"). */
export async function setJobTags(jobId: string, tags: string[]): Promise<PhotoResult> {
  const profile = await requireProfile();
  const clean = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean))).slice(0, 20);
  const supabase = await createClient();
  const denied = await assertJobAccess(supabase, profile, jobId);
  if (denied) return denied;
  const { error } = await supabase.from("jobs").update({ tags: clean }).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  return { ok: true };
}

/** Set the manually-entered job costs used by the commission report. */
export async function setJobExpenses(jobId: string, amountStr: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const denied = await assertJobAccess(supabase, profile, jobId);
  if (denied) return denied;
  let cents = 0;
  try {
    cents = parseAmountToMinor(amountStr);
  } catch {
    return { ok: false, error: "Invalid amount" };
  }
  const { error } = await supabase
    .from("jobs")
    .update({ job_expenses_minor: Math.max(0, cents) })
    .eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Manually send a review request. Returns whether it auto-sent + fallback contact info. */
export async function requestReview(jobId: string): Promise<{
  ok: boolean;
  sent: boolean;
  reviewUrl: string | null;
  phone: string | null;
  email: string | null;
  error?: string;
}> {
  await requireProfile();
  const { sendReviewRequest } = await import("@/lib/notify");
  const r = await sendReviewRequest(jobId);
  if (!r.reviewUrl)
    return {
      ok: false,
      sent: false,
      reviewUrl: null,
      phone: r.phone,
      email: r.email,
      error: "Add your Google review link in Settings first.",
    };
  return { ok: true, ...r };
}
