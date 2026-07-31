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
  const locale = (await getLocale());
  const parsed = parse(formData);
  if (!parsed.success) {
    const key = parsed.error.issues[0]?.message ?? "err.invalid";
    return { ok: false, error: t(locale, key) };
  }

  const supabase = await createClient();
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
  const locale = (await getLocale());
  const parsed = parse(formData);
  if (!parsed.success) {
    const key = parsed.error.issues[0]?.message ?? "err.invalid";
    return { ok: false, error: t(locale, key) };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("customers").update(parsed.data).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/customers");
  return { ok: true };
}

/** Delete a customer. Restricted to owner/office in the app AND by RLS. */
export async function deleteCustomer(id: string): Promise<ActionResult> {
  const profile = await requireProfile();
  const locale = (await getLocale());
  try {
    assertRole(profile, ["owner", "office"]);
  } catch {
    return { ok: false, error: t(locale, "err.forbidden") };
  }
  const supabase = await createClient();

  // SOFT delete. This was a hard `.delete()`, which permanently destroyed the
  // customer row: no trash, no restore, and no way to recover from a mis-click.
  // `jobs.customer_id` is `on delete restrict`, so it happened to fail for
  // customers WITH jobs and silently destroyed everyone else — the newest
  // customers, the ones most likely to have been added by mistake.
  //
  // Every list already filters `deleted_at is null`, so the visible behaviour is
  // unchanged; the difference is that /trash can now bring it back. Legal
  // erasure remains a separate path (the privacy anonymiser), which overwrites
  // the PII rather than hiding the row.
  const { error } = await supabase
    .from("customers")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/customers");
  revalidatePath("/trash");
  return { ok: true };
}
