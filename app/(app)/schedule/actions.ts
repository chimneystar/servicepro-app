"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
// @ts-ignore -- JS module with integer-safe money math
import { parseAmountToMinor } from "@/lib/core/money.mjs";

export type ActionResult = { ok: boolean; error?: string };

export async function createJob(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile();
  const locale = getLocale();

  const customer_id = String(formData.get("customer_id") ?? "");
  const service = String(formData.get("service") ?? "").trim();
  const scheduled_date = String(formData.get("date") ?? "");
  const assignedRaw = String(formData.get("assigned_to") ?? "");
  const assigned_to = assignedRaw ? assignedRaw : null;
  const start = String(formData.get("start") ?? "") || null;
  const end = String(formData.get("end") ?? "") || null;

  if (!customer_id || !service || !scheduled_date) return { ok: false, error: t(locale, "err.invalid") };
  if (start && end && end <= start) return { ok: false, error: t(locale, "err.invalid") };

  let price_minor = 0;
  try { price_minor = parseAmountToMinor(String(formData.get("price") ?? "0")); }
  catch { return { ok: false, error: t(locale, "err.invalid") }; }

  const supabase = createClient();
  const { error } = await supabase.from("jobs").insert({
    organization_id: profile.organization_id,
    created_by: profile.id,
    customer_id,
    assigned_to,
    service,
    price_minor,
    scheduled_date,
    start_time: start,
    end_time: end,
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

export async function setJobStatus(id: string, status: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = createClient();
  const { error } = await supabase.from("jobs").update({ status }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/schedule");
  return { ok: true };
}
