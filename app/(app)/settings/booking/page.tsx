import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import BookingSettingsForm from "./BookingSettingsForm";

export const dynamic="force-dynamic";
export default async function BookingSettingsPage(){const profile=await requireProfile();if(profile.role!=="owner")redirect("/");const locale=await getLocale();const supabase=await createClient();const [{data:settings},{data:services},{data:jobTypes},{data:questions},{data:areas}]=await Promise.all([supabase.from("booking_settings").select("*").eq("organization_id",profile.organization_id!).maybeSingle(),supabase.from("booking_services").select("*").order("sort").order("name_en"),supabase.from("job_types").select("id,name,duration_min,default_price_minor,sort").order("sort").order("name"),supabase.from("booking_questions").select("*").eq("active",true).order("sort").order("created_at"),supabase.from("service_areas").select("id").eq("active",true)]);return <BookingSettingsForm locale={locale} orgId={profile.organization_id!} settings={settings??{}} services={services??[]} jobTypes={jobTypes??[]} questions={questions??[]} hasServiceAreas={(areas??[]).length>0}/>;}
