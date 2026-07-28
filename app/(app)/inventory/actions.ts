"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";
// @ts-ignore
import { parseAmountToMinor } from "@/lib/core/money.mjs";

export type ActionResult = { ok: boolean; error?: string };

export async function saveInventoryItem(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name required" };
  let cost_minor = 0;
  try { cost_minor = parseAmountToMinor(String(formData.get("cost") ?? "0")); } catch { }
  const row = {
    organization_id: profile.organization_id, name,
    sku: String(formData.get("sku") ?? "").trim() || null,
    unit: String(formData.get("unit") ?? "unit").trim() || "unit",
    quantity: Math.max(0, parseInt(String(formData.get("quantity") ?? "0"), 10) || 0),
    low_stock_threshold: Math.max(0, parseInt(String(formData.get("low") ?? "0"), 10) || 0),
    cost_minor,
    updated_at: new Date().toISOString(),
  };
  const id = String(formData.get("id") ?? "");
  const supabase = createClient();
  const { error } = id ? await supabase.from("inventory_items").update(row).eq("id", id) : await supabase.from("inventory_items").insert(row);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/inventory");
  return { ok: true };
}

export async function adjustQuantity(id: string, delta: number): Promise<ActionResult> {
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }
  const supabase = createClient();
  const { data: it } = await supabase.from("inventory_items").select("quantity").eq("id", id).single();
  if (!it) return { ok: false, error: "not found" };
  const q = Math.max(0, (it.quantity ?? 0) + delta);
  const { error } = await supabase.from("inventory_items").update({ quantity: q, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/inventory");
  return { ok: true };
}

export async function deleteInventoryItem(id: string): Promise<ActionResult> {
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }
  const supabase = createClient();
  const { error } = await supabase.from("inventory_items").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/inventory");
  return { ok: true };
}
