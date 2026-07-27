import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import SettingsForm from "./SettingsForm";
import JobTypesEditor from "@/components/JobTypesEditor";
import JobStatusesEditor, { type JobStatus } from "@/components/JobStatusesEditor";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "owner") redirect("/");
  const locale = getLocale();
  const supabase = createClient();
  const [{ data: org }, { data: jobTypes }] = await Promise.all([
    supabase.from("organizations")
      .select("name, tagline, phone, email, address, city, currency, locale, tax_label, tax_rate_bps, invoice_counter, estimate_counter, accent_color, estimate_terms, invoice_terms, document_footer, review_url")
      .eq("id", profile.organization_id!).single(),
    supabase.from("job_types").select("id, name, color, duration_min, default_price_minor").order("sort").order("name"),
  ]);
  const { data: jobStatuses } = await supabase.from("job_statuses").select("id, name, color, sort, is_done, is_cancelled").order("sort");

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 18 }}>{t(locale, "set.title")}</h1>
      <SettingsForm locale={locale} org={org ?? {}} />
      <JobTypesEditor types={jobTypes ?? []} currency={org?.currency ?? "USD"} />
      <JobStatusesEditor statuses={(jobStatuses ?? []) as JobStatus[]} />

      <SettingsLink href="/settings/integrations" icon="🔌" title="Integrations" description="Connect Gmail, a local business text number, and Stripe payments." />
      <SettingsLink href="/team" icon="🛠️" title="Team" description="Invite technicians and office staff and set their roles." />
      <SettingsLink href="/settings/messages" icon="💬" title="Client messages" description="Customize the texts sent when a job is booked, the day before, and when the tech is on the way." />
    </div>
  );
}

function SettingsLink({ href, icon, title, description }: { href: string; icon: string; title: string; description: string }) {
  return <Link href={href} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 16, marginBottom: 16, textDecoration: "none", color: "#0b1524", boxShadow: "0 6px 18px rgba(15,42,94,.06)" }}>
    <span style={{ fontSize: 22 }}>{icon}</span>
    <div style={{ flex: 1 }}><div style={{ fontWeight: 800, fontSize: 15 }}>{title}</div><div style={{ fontSize: 12.5, color: "#5c6675" }}>{description}</div></div>
    <span style={{ color: "#b6bfcc", fontSize: 18 }}>›</span>
  </Link>;
}
