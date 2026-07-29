import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import TechnicianWorkspace, { type TechJob } from "@/components/TechnicianWorkspace";

export const dynamic = "force-dynamic";

export default async function TechnicianPage() {
  const profile = await requireProfile();
  if (profile.role !== "tech") redirect("/jobs");
  const locale = await getLocale();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: jobs } = await supabase.from("jobs")
    .select("id, service, status, scheduled_date, start_time, end_time, job_address, job_city, customers(name, phone, address, city)")
    .eq("assigned_to", profile.id).gte("scheduled_date", today).is("deleted_at", null)
    .order("scheduled_date").order("start_time").limit(40);
  const techJobs: TechJob[] = (jobs ?? []).map((job) => ({
    ...job,
    customers: Array.isArray(job.customers) ? (job.customers[0] ?? null) : job.customers,
  }));
  return <TechnicianWorkspace locale={locale} jobs={techJobs} vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />;
}
