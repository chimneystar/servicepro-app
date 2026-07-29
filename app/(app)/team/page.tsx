import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { redirect } from "next/navigation";
import TeamClient from "./TeamClient";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const profile = await requireProfile();
  if (profile.role !== "owner") redirect("/");
  const locale = (await getLocale());
  const supabase = await createClient();

  const [{ data: members }, { data: invites }, { data: paymentPermissions }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role").order("role"),
    supabase.from("invitations").select("id, email, role").is("accepted_at", null).order("created_at", { ascending: false }),
    supabase.from("profile_payment_permissions").select("profile_id, can_confirm_manual_payments, can_refund_payments, can_override_ach_holds"),
  ]);

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>{t(locale, "team.title")}</h1>
      <TeamClient locale={locale} members={members ?? []} invites={invites ?? []} paymentPermissions={paymentPermissions ?? []} myId={profile.id} />
    </div>
  );
}
