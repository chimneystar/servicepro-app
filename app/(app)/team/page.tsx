import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { redirect } from "next/navigation";
import TeamClient from "./TeamClient";
import TeamWorkforce, { type WorkforceSkill, type WorkforceTimeOff, type WorkforceRate } from "./TeamWorkforce";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const profile = await requireProfile();
  if (profile.role !== "owner") redirect("/");
  const locale = (await getLocale());
  const supabase = await createClient();
  // Server-rendered request timestamp; deliberately fixed for this response.
  // eslint-disable-next-line react-hooks/purity
  const timeOffFrom = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  const [
    { data: members }, { data: invites }, { data: paymentPermissions }, { data: capabilities },
    { data: skills }, { data: timeOff }, { data: rates }, { data: org },
  ] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role").order("role"),
    // delivery_status / sent_at (migration 034) are what let the screen say
    // whether anyone was actually emailed. Before that column existed, nobody
    // ever was, and the list still showed the invite as if they had been.
    supabase.from("invitations").select("id, email, role, delivery_status, delivery_error, sent_at").is("accepted_at", null).order("created_at", { ascending: false }),
    supabase.from("profile_payment_permissions").select("profile_id, can_confirm_manual_payments, can_refund_payments, can_override_ach_holds"),
    supabase.from("profile_capabilities").select("profile_id, can_view_customers, can_edit_customers, can_manage_schedule, can_edit_jobs, can_manage_estimates, can_manage_invoices, can_manage_payments, can_view_reports, can_manage_purchasing, can_manage_automations, can_manage_settings, can_manage_team"),
    // 6c.11 certifications, 6c.3 time off, 6c.2 labour cost rates. The rate
    // table is owner-only at the database, so this select returns rows only
    // because this page has already refused anybody who is not the owner.
    supabase.from("technician_skills").select("id, profile_id, skill_code, label, certification_number, issued_on, expires_on").order("skill_code"),
    supabase.from("technician_time_off").select("id, profile_id, starts_on, ends_on, start_time, end_time, kind, note")
      .gte("ends_on", timeOffFrom).order("starts_on"),
    supabase.from("technician_pay_rates").select("profile_id, cost_rate_minor, effective_from").order("effective_from", { ascending: false }),
    supabase.from("organizations").select("currency").single(),
  ]);

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>{t(locale, "team.title")}</h1>
      {/* Permission changes are now recorded (migration 038 §3). This is where
          somebody who has just changed a role goes to check what was recorded. */}
      <p style={{ marginBottom: 16, fontSize: 12.5 }}>
        <Link href="/settings/security">{locale === "he" ? "יומן שינויי הרשאות ואבטחת חשבון →" : "Permission history & account security →"}</Link>
      </p>
      <TeamClient locale={locale} members={members ?? []} invites={invites ?? []} paymentPermissions={paymentPermissions ?? []} capabilities={capabilities ?? []} myId={profile.id} />
      <TeamWorkforce
        locale={locale} currency={org?.currency ?? "USD"} members={members ?? []}
        skills={(skills ?? []) as WorkforceSkill[]} timeOff={(timeOff ?? []) as WorkforceTimeOff[]}
        rates={(rates ?? []) as WorkforceRate[]} canSeePay={profile.role === "owner"}
      />
    </div>
  );
}
