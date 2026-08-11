"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isOneOf } from "@/lib/validation";
import { requireProfile, assertRole } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { cookies } from "next/headers";

export type ActionResult = { ok: boolean; error?: string };

export async function updateSettings(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const profile = await requireProfile();
  const locale = await getLocale();
  try {
    assertRole(profile, ["owner"]);
  } catch {
    return { ok: false, error: t(locale, "err.forbidden") };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: t(locale, "err.name_required") };

  // USD only, enforced server-side: the form is not the boundary. The payment
  // layer refuses non-USD (Helcim) or violates a CHECK constraint (manual), so
  // any other value produces a business that cannot take payment at all.
  const currency = "USD";
  // `organizations.locale` is CHECK-constrained to 'en' and 'he'. This value
  // was written UNVALIDATED — the `lang === "en" || lang === "he"` test below
  // runs AFTER the update and only gates the cookie, so it has never protected
  // the column. Anything else was refused by Postgres and surfaced as a raw
  // constraint-violation message.
  const langRaw = String(formData.get("locale") ?? "en");
  const lang = isOneOf(["en", "he"], langRaw) ? langRaw : "en";
  const taxLabel = String(formData.get("tax_label") ?? "Sales Tax").trim() || "Sales Tax";
  const taxPct = Number(formData.get("tax_rate") ?? 0);
  const tax_rate_bps = Number.isFinite(taxPct)
    ? Math.max(0, Math.min(100000, Math.round(taxPct * 100)))
    : 0;

  const invNext = parseInt(String(formData.get("invoice_next") ?? ""), 10);
  const estNext = parseInt(String(formData.get("estimate_next") ?? ""), 10);

  const accent = String(formData.get("accent_color") ?? "").trim();
  // Built in one expression rather than assigned into afterwards: a
  // `Record<string, unknown>` matches every column name and every value, so it
  // checked nothing about what this write actually sets.
  const update = {
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
    accent_color: /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#2563eb",
    estimate_terms: String(formData.get("estimate_terms") ?? "").trim() || null,
    invoice_terms: String(formData.get("invoice_terms") ?? "").trim() || null,
    document_footer: String(formData.get("document_footer") ?? "").trim() || null,
    review_url: String(formData.get("review_url") ?? "").trim() || null,
    ...(Number.isFinite(invNext) && invNext > 0 ? { invoice_counter: invNext - 1 } : {}),
    ...(Number.isFinite(estNext) && estNext > 0 ? { estimate_counter: estNext - 1 } : {}),
  };

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update(update)
    .eq("id", profile.organization_id!);

  if (error) return { ok: false, error: error.message };
  (await cookies()).set("locale", lang, { path: "/", maxAge: 31536000, sameSite: "lax" });
  revalidatePath("/settings");
  return { ok: true };
}
