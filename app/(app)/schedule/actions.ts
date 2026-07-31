"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
// @ts-ignore -- JS module with integer-safe money math
import { parseAmountToMinor } from "@/lib/core/money.mjs";
import { changeJobStatus } from "@/lib/job-status";

export type ActionResult = { ok: boolean; error?: string };

export async function createJob(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile();
  const locale = (await getLocale());

  let customer_id = String(formData.get("customer_id") ?? "");
  const service = String(formData.get("service") ?? "").trim();
  const scheduled_date = String(formData.get("date") ?? "");
  const end_date = String(formData.get("end_date") ?? "") || scheduled_date;
  const assignedRaw = String(formData.get("assigned_to") ?? "");
  const assigned_to = assignedRaw ? assignedRaw : null;
  const start = String(formData.get("start") ?? "") || null;
  const end = String(formData.get("end") ?? "") || null;

  if (!service || !scheduled_date || end_date < scheduled_date) return { ok: false, error: t(locale, "err.invalid") };
  if (start && end && end <= start) return { ok: false, error: t(locale, "err.invalid") };

  let price_minor = 0;
  try { price_minor = parseAmountToMinor(String(formData.get("price") ?? "0")); }
  catch { return { ok: false, error: t(locale, "err.invalid") }; }

  const supabase = await createClient();

  // Inline new client: create the customer on the fly, then use it for the job.
  if (customer_id === "__new__" || !customer_id) {
    const name = String(formData.get("new_name") ?? "").trim();
    if (!name) return { ok: false, error: t(locale, "err.name_required") };
    const { data: c, error: cErr } = await supabase.from("customers").insert({
      organization_id: profile.organization_id,
      created_by: profile.id,
      name,
      phone: String(formData.get("new_phone") ?? "").trim() || "—",
      email: String(formData.get("new_email") ?? "").trim() || null,
      address: String(formData.get("new_address") ?? "").trim() || null,
      city: String(formData.get("new_city") ?? "").trim() || null,
    }).select("id").single();
    if (cErr) return { ok: false, error: cErr.message };
    customer_id = c.id;
    revalidatePath("/customers");
  }

  const { error } = await supabase.from("jobs").insert({
    organization_id: profile.organization_id,
    created_by: profile.id,
    customer_id,
    assigned_to,
    service,
    price_minor,
    scheduled_date,
    end_date,
    start_time: start,
    end_time: end,
    job_address: String(formData.get("job_address") ?? "").trim() || null,
    job_city: String(formData.get("job_city") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });

  if (error) {
    // 23P01 = exclusion_violation -> the DB blocked a double-booking
    if ((error as any).code === "23P01") return { ok: false, error: t(locale, "sched.conflict") };
    return { ok: false, error: error.message };
  }

  revalidatePath("/schedule");
  return { ok: true };
}

/**
 * Change a job's status.
 *
 * Previously this accepted ANY string, wrote it straight to the column, and
 * checked only that the caller was signed in — so a technician could close any
 * job they could see, reopen a completed one, or write a status no screen
 * understands. It is routed through the guarded path now; the legal transitions
 * have been defined and tested in lib/core/scheduling.mjs all along and were
 * never called.
 */
export async function setJobStatus(id: string, status: string): Promise<ActionResult> {
  const result = await changeJobStatus(id, status);
  if (!result.ok) return result;
  revalidatePath("/schedule");
  revalidatePath("/dispatch");
  return { ok: true };
}
