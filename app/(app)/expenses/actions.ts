"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
// @ts-ignore
import { parseAmountToMinor } from "@/lib/core/money.mjs";

export type ActionResult = { ok: boolean; error?: string };

export async function addExpense(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const locale = (await getLocale());
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }

  const category = String(formData.get("category") ?? "").trim();
  const date = String(formData.get("date") ?? "");
  if (!category || !date) return { ok: false, error: t(locale, "err.invalid") };
  let amount_minor = 0;
  try { amount_minor = parseAmountToMinor(String(formData.get("amount") ?? "0")); }
  catch { return { ok: false, error: t(locale, "err.invalid") }; }
  if (amount_minor <= 0) return { ok: false, error: t(locale, "err.invalid") };

  const supabase = await createClient();
  const { error } = await supabase.from("expenses").insert({
    organization_id: profile.organization_id,
    created_by: profile.id,
    expense_date: date,
    category,
    vendor: String(formData.get("vendor") ?? "").trim() || null,
    amount_minor,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/expenses");
  return { ok: true };
}

export async function deleteExpense(id: string): Promise<ActionResult> {
  const locale = (await getLocale());
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  const supabase = await createClient();
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/expenses");
  return { ok: true };
}
