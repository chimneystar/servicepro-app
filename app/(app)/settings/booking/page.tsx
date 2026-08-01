import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { asJsonRecord } from "@/lib/validation";
import { getLocale } from "@/lib/locale-server";
import BookingSettingsForm from "./BookingSettingsForm";
import { serviceAreaEnforcementGaps, type ServiceArea } from "@/lib/booking";

export const dynamic = "force-dynamic";
export default async function BookingSettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "owner") redirect("/");
  const locale = await getLocale();
  const supabase = await createClient();
  const [
    { data: settings },
    { data: services },
    { data: jobTypes },
    { data: questions },
    { data: areas },
  ] = await Promise.all([
    supabase
      .from("booking_settings")
      .select("*")
      .eq("organization_id", profile.organization_id!)
      .maybeSingle(),
    supabase.from("booking_services").select("*").order("sort").order("name_en"),
    supabase
      .from("job_types")
      .select("id,name,name_en,name_he,duration_min,default_price_minor,sort")
      .order("sort")
      .order("name"),
    supabase
      .from("booking_questions")
      .select("*")
      .eq("active", true)
      .order("sort")
      .order("created_at"),
    supabase.from("service_areas").select("id,area_type,active").eq("active", true),
  ]);
  // Polygon areas cannot be evaluated at booking time (no geocoding anywhere in
  // this product), so the form has to say so rather than let the enforcement
  // toggle imply a check that never runs. See docs/REMEDIATION-PLAN.md item 4.8.
  const areaEnforcement = serviceAreaEnforcementGaps((areas ?? []) as unknown as ServiceArea[]);
  return (
    <BookingSettingsForm
      locale={locale}
      orgId={profile.organization_id!}
      // `hours_json` and `options_json` are jsonb columns, so the generated
      // type is `Json`. The form indexes into both, so the shape is checked
      // here rather than asserted inside the component.
      settings={
        settings
          ? {
              ...settings,
              hours_json: asJsonRecord<[string, string] | null>(settings.hours_json) ?? undefined,
            }
          : {}
      }
      services={services ?? []}
      jobTypes={jobTypes ?? []}
      questions={(questions ?? []).map((q) => ({
        ...q,
        options_json: Array.isArray(q.options_json) ? q.options_json.map(String) : undefined,
      }))}
      hasServiceAreas={(areas ?? []).length > 0}
      areaEnforcement={areaEnforcement}
    />
  );
}
