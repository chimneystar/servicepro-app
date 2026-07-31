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

  const [{ data: members }, { data: invites }, { data: paymentPermissions }, { data: capabilities }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role").order("role"),
    // delivery_status / sent_at (migration 034) are what let the screen say
    // whether anyone was actually emailed. Before that column existed, nobody
    // ever was, and the list still showed the invite as if they had been.
    supabase.from("invitations").select("id, email, role, delivery_status, delivery_error, sent_at").is("accepted_at", null).order("created_at", { ascending: false }),
    supabase.from("profile_payment_permissions").select("profile_id, can_confirm_manual_payments, can_refund_payments, can_override_ach_holds"),
    supabase.from("profile_capabilities").select("profile_id, can_view_customers, can_edit_customers, can_manage_schedule, can_edit_jobs, can_manage_estimates, can_manage_invoices, can_manage_payments, can_view_reports, can_manage_purchasing, can_manage_automations, can_manage_settings, can_manage_team"),
  ]);

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>{t(locale, "team.title")}</h1>
      <TeamClient locale={locale} members={members ?? []} invites={invites ?? []} paymentPermissions={paymentPermissions ?? []} capabilities={capabilities ?? []} myId={profile.id} />
    </div>
  );
}
