"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";
// @ts-ignore
import { parseAmountToMinor } from "@/lib/core/money.mjs";

export type ActionResult = { ok: boolean; error?: string };

export async function saveJobType(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name required" };
  const color = String(formData.get("color") ?? "#2563eb");
  const duration_min = Math.max(0, Math.min(1440, parseInt(String(formData.get("duration") ?? "60"), 10) || 60));
  let default_price_minor = 0;
  try { default_price_minor = parseAmountToMinor(String(formData.get("price") ?? "0")); } catch { }

  const row = { organization_id: profile.organization_id, name, color, duration_min, default_price_minor };
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("job_types").update(row).eq("id", id)
    : await supabase.from("job_types").insert(row);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

export async function deleteJobType(id: string): Promise<ActionResult> {
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }
  const supabase = await createClient();
  const { error } = await supabase.from("job_types").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}
