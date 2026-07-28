"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";
// @ts-ignore
import { parseAmountToMinor } from "@/lib/core/money.mjs";

export type ActionResult = { ok: boolean; error?: string; created?: number };

function addMonths(iso: string, months: number) {
  const d = new Date(iso + "T00:00:00"); d.setMonth(d.getMonth() + months); return d.toISOString().slice(0, 10);
}

export async function savePlan(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }
  const customer_id = String(formData.get("customer_id") ?? "");
  const service = String(formData.get("service") ?? "").trim();
  if (!customer_id || !service) return { ok: false, error: "Customer and service required" };
  let price_minor = 0;
  try { price_minor = parseAmountToMinor(String(formData.get("price") ?? "0")); } catch { }
  const row = {
    organization_id: profile.organization_id, customer_id, service, price_minor,
    interval_months: Math.max(1, Math.min(60, parseInt(String(formData.get("interval") ?? "12"), 10) || 12)),
    assigned_to: String(formData.get("assigned_to") ?? "") || null,
    next_due: String(formData.get("next_due") ?? "") || new Date().toISOString().slice(0, 10),
    active: true, created_by: profile.id, updated_at: new Date().toISOString(),
  };
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const { error } = id ? await supabase.from("recurring_plans").update(row).eq("id", id) : await supabase.from("recurring_plans").insert(row);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/recurring");
  return { ok: true };
}

export async function deletePlan(id: string): Promise<ActionResult> {
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }
  const supabase = await createClient();
  const { error } = await supabase.from("recurring_plans").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/recurring");
  return { ok: true };
}

/** Create jobs for every plan that's due, and roll its next date forward. */
export async function generateDuePlans(): Promise<ActionResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: due } = await supabase.from("recurring_plans").select("*").eq("active", true).lte("next_due", today);
  let created = 0;
  for (const p of due ?? []) {
    const { error } = await supabase.from("jobs").insert({
      organization_id: profile.organization_id, created_by: profile.id, customer_id: p.customer_id,
      assigned_to: p.assigned_to, service: p.service, price_minor: p.price_minor,
      scheduled_date: p.next_due, source: "Maintenance plan",
    });
    if (!error) { created++; await supabase.from("recurring_plans").update({ next_due: addMonths(p.next_due, p.interval_months), updated_at: new Date().toISOString() }).eq("id", p.id); }
  }
  revalidatePath("/recurring"); revalidatePath("/schedule");
  return { ok: true, created };
}
