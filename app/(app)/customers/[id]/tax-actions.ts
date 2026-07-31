"use server";

import { revalidatePath } from "next/cache";
import { assertCapability, requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";

export type TaxExemptionResult = { ok: boolean; error?: string };

/**
 * Customer tax exemptions (ledger 5.16).
 *
 * `customer_tax_exemptions` was created by migration 022 and had no UI at all,
 * so an exempt customer — a school, a church, a reseller with a certificate —
 * could only be handled by marking every single line item non-taxable by hand.
 * A certificate recorded here is read by `resolveDocumentTax` and zeroes the tax
 * on documents raised for that customer while it is valid.
 *
 * Guarded by `payments.manage`, matching the RLS migration 022 put on the table:
 * anything looser here would only produce a silent empty result.
 */
async function guard() {
  const profile = await requireProfile();
  await assertCapability(profile, "payments.manage");
  return profile;
}

const failed = (he: boolean) => he ? "לא הצלחנו לשמור. בדקו את הפרטים ונסו שוב." : "We couldn't save this. Check the details and try again.";
const forbidden = (he: boolean) => he ? "אין לך הרשאה לנהל כספים." : "You don't have access to manage finance.";

export async function addTaxExemption(_previous: TaxExemptionResult, formData: FormData): Promise<TaxExemptionResult> {
  const locale = await getLocale(), he = locale === "he";
  const customerId = String(formData.get("customerId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const expires = String(formData.get("expiresOn") ?? "").trim();
  if (!customerId || !reason) return { ok: false, error: failed(he) };
  if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return { ok: false, error: failed(he) };

  try {
    const profile = await guard();
    const supabase = await createClient();
    const { error } = await supabase.from("customer_tax_exemptions").insert({
      organization_id: profile.organization_id,
      customer_id: customerId,
      certificate_number: String(formData.get("certificate") ?? "").trim() || null,
      reason,
      document_url: String(formData.get("documentUrl") ?? "").trim() || null,
      expires_on: expires || null,
      verified_by: profile.id,
      verified_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: failed(he) };
    revalidatePath(`/customers/${customerId}`);
    return { ok: true };
  } catch { return { ok: false, error: forbidden(he) }; }
}

/** Revoke (or restore) a certificate. Revoking makes the next document taxable again. */
export async function setTaxExemptionActive(id: string, customerId: string, active: boolean): Promise<TaxExemptionResult> {
  const locale = await getLocale(), he = locale === "he";
  try {
    const profile = await guard();
    const supabase = await createClient();
    const { error } = await supabase.from("customer_tax_exemptions")
      .update({ active }).eq("id", id).eq("organization_id", profile.organization_id!);
    if (error) return { ok: false, error: failed(he) };
    revalidatePath(`/customers/${customerId}`);
    return { ok: true };
  } catch { return { ok: false, error: forbidden(he) }; }
}
