"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";

export type ActionResult = { ok: boolean; error?: string };

export async function updateSettings(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile();
  const locale = getLocale();
  try {
    assertRole(profile, ["owner"]);
  } catch {
    return { ok: false, error: t(locale, "err.forbidden") };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: t(locale, "err.name_required") };

  const currency = String(formData.get("currency") ?? "USD");
  const lang = String(formData.get("locale") ?? "en");
  const taxLabel = String(formData.get("tax_label") ?? "Sales Tax").trim() || "Sales Tax";
  const taxPct = Number(formData.get("tax_rate") ?? 0);
  const tax_rate_bps = Number.isFinite(taxPct) ? Math.max(0, Math.min(100000, Math.round(taxPct * 100))) : 0;

  const supabase = createClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      name,
      tagline: String(formData.get("tagline") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      email: String(formData.get("email") ?? "").trim() || null,
      address: String(formData.get("address") ?? "").trim() || null,
      city: String(formData.get("city") ?? "").trim() || null,
      currency,
      locale: lang,
      tax_label: taxLabel,
      tax_rate_bps,
    })
    .eq("id", profile.organization_id!);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}
