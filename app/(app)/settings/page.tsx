import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import SettingsForm from "./SettingsForm";
import JobTypesEditor from "@/components/JobTypesEditor";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "owner") redirect("/");
  const locale = getLocale();
  const supabase = createClient();
  const [{ data: org }, { data: jobTypes }] = await Promise.all([
    supabase.from("organizations")
      .select("name, tagline, phone, email, address, city, currency, locale, tax_label, tax_rate_bps, invoice_counter, estimate_counter")
      .eq("id", profile.organization_id!).single(),
    supabase.from("job_types").select("id, name, color, duration_min, default_price_minor").order("sort").order("name"),
  ]);

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 18 }}>{t(locale, "set.title")}</h1>
      <SettingsForm locale={locale} org={org ?? {}} />
      <JobTypesEditor types={jobTypes ?? []} currency={org?.currency ?? "USD"} />
    </div>
  );
}
