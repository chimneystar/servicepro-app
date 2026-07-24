"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";
import { customerSchema } from "@/lib/validation";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";

export type ActionResult = { ok: boolean; error?: string };

function parse(formData: FormData) {
  return customerSchema.safeParse({
    name: formData.get("name") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    address: formData.get("address") ?? "",
    city: formData.get("city") ?? "",
    billing_address: formData.get("billing_address") ?? "",
    billing_city: formData.get("billing_city") ?? "",
    source: formData.get("source") ?? "",
    notes: formData.get("notes") ?? "",
  });
}

/** Create a customer. Server-validated; org comes from the session, never the client. */
export async function createCustomer(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile();
  const locale = getLocale();
  const parsed = parse(formData);
  if (!parsed.success) {
    const key = parsed.error.issues[0]?.message ?? "err.invalid";
    return { ok: false, error: t(locale, key) };
  }

  const supabase = createClient();
  const { error } = await supabase.from("customers").insert({
    organization_id: profile.organization_id,
    created_by: profile.id,
    ...parsed.data,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/customers");
  return { ok: true };
}

/** Update a customer (RLS also guarantees it belongs to this org). */
export async function updateCustomer(id: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireProfile();
  const locale = getLocale();
  const parsed = parse(formData);
  if (!parsed.success) {
    const key = parsed.error.issues[0]?.message ?? "err.invalid";
    return { ok: false, error: t(locale, key) };
  }
  const supabase = createClient();
  const { error } = await supabase.from("customers").update(parsed.data).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/customers");
  return { ok: true };
}

/** Delete a customer. Restricted to owner/office in the app AND by RLS. */
export async function deleteCustomer(id: string): Promise<ActionResult> {
  const profile = await requireProfile();
  const locale = getLocale();
  try {
    assertRole(profile, ["owner", "office"]);
  } catch {
    return { ok: false, error: t(locale, "err.forbidden") };
  }
  const supabase = createClient();
  const { error } = await supabase.from("customers").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/customers");
  return { ok: true };
}
