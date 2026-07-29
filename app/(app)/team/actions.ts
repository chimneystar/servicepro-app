"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole, type Role } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";

export type ActionResult = { ok: boolean; error?: string };

function guardOwner() { return requireProfile().then((p) => { assertRole(p, ["owner"]); return p; }); }
const saveError = (locale: "en" | "he") => locale === "he" ? "לא הצלחנו לשמור את השינוי. נסו שוב בעוד רגע." : "We couldn't save the change. Please try again.";

/** Owner invites a teammate by email + role. They join on sign-up. */
export async function inviteMember(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const locale = (await getLocale());
  let profile;
  try { profile = await guardOwner(); } catch { return { ok: false, error: t(locale, "err.forbidden") }; }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "tech") as Role;
  if (!email || !email.includes("@")) return { ok: false, error: t(locale, "err.email_invalid") };
  if (!["owner", "office", "tech"].includes(role)) return { ok: false, error: t(locale, "err.invalid") };

  const supabase = await createClient();
  const { error } = await supabase.from("invitations").insert({
    organization_id: profile.organization_id,
    email,
    role,
    token: randomUUID(),
    invited_by: profile.id,
  });
  if (error) return { ok: false, error: saveError(locale) };
  revalidatePath("/team");
  return { ok: true };
}

export async function changeRole(memberId: string, role: string): Promise<ActionResult> {
  const locale = (await getLocale());
  try { await guardOwner(); } catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  if (!["owner", "office", "tech"].includes(role)) return { ok: false, error: t(locale, "err.invalid") };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", memberId);
  if (error) return { ok: false, error: saveError(locale) };
  if (role !== "office") await supabase.from("profile_payment_permissions").delete().eq("profile_id", memberId);
  revalidatePath("/team");
  return { ok: true };
}

export async function updatePaymentPermissions(
  memberId: string,
  permissions: { confirmManual: boolean; refund: boolean; overrideAchHold: boolean },
): Promise<ActionResult> {
  const locale = (await getLocale());
  let owner;
  try { owner = await guardOwner(); } catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  if (!memberId || memberId === owner.id) return { ok: false, error: t(locale, "err.invalid") };

  const supabase = await createClient();
  const { data: member } = await supabase.from("profiles").select("id, role").eq("id", memberId).maybeSingle();
  if (!member || member.role !== "office") return { ok: false, error: t(locale, "err.invalid") };

  const { error } = await supabase.from("profile_payment_permissions").upsert({
    profile_id: memberId,
    organization_id: owner.organization_id,
    can_confirm_manual_payments: !!permissions.confirmManual,
    can_refund_payments: !!permissions.refund,
    can_override_ach_holds: !!permissions.overrideAchHold,
    updated_by: owner.id,
  }, { onConflict: "profile_id" });
  if (error) return { ok: false, error: locale === "he" ? "לא הצלחנו לשמור את הרשאות התשלום." : "We couldn't save the payment permissions." };
  revalidatePath("/team");
  return { ok: true };
}

export async function removeMember(memberId: string): Promise<ActionResult> {
  const locale = (await getLocale());
  let profile;
  try { profile = await guardOwner(); } catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  if (memberId === profile.id) return { ok: false, error: t(locale, "err.invalid") };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").delete().eq("id", memberId);
  if (error) return { ok: false, error: saveError(locale) };
  revalidatePath("/team");
  return { ok: true };
}

export async function cancelInvite(id: string): Promise<ActionResult> {
  const locale = (await getLocale());
  try { await guardOwner(); } catch { return { ok: false, error: t(locale, "err.forbidden") }; }
  const supabase = await createClient();
  const { error } = await supabase.from("invitations").delete().eq("id", id);
  if (error) return { ok: false, error: saveError(locale) };
  revalidatePath("/team");
  return { ok: true };
}
