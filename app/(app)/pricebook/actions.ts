"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
// @ts-ignore
import { parseAmountToMinor } from "@/lib/core/money.mjs";

export type ActionResult = { ok: boolean; error?: string };

export async function savePriceItem(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const locale = getLocale();
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: t(locale, "err.name_required") };
  let price_minor = 0, cost_minor = 0;
  try {
    price_minor = parseAmountToMinor(String(formData.get("price") ?? "0"));
    cost_minor = parseAmountToMinor(String(formData.get("cost") ?? "0"));
  } catch { return { ok: false, error: t(locale, "err.invalid") }; }

  const row = {
    organization_id: profile.organization_id,
    name,
    category: String(formData.get("category") ?? "").trim() || null,
    unit: String(formData.get("unit") ?? "").trim() || "unit",
    price_minor,
    cost_minor,
  };
  const id = String(formData.get("id") ?? "");
  const supabase = createClient();
  const { error } = id
    ? await supabase.from("price_book").update(row).eq("id", id)
    : await supabase.from("price_book").insert(row);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/pricebook");
  return { ok: true };
}

export async function deletePriceItem(id: string): Promise<ActionResult> {
  const locale = getLocale();
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  const supabase = createClient();
  const { error } = await supabase.from("price_book").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/pricebook");
  return { ok: true };
}
