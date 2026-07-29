import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import DispatchBoard, { type DispatchJob, type DispatchTech, type DispatchAssignment } from "@/components/DispatchBoard";

export const dynamic = "force-dynamic";

export default async function DispatchPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/tech");
  const locale = await getLocale();
  const requested = (await searchParams).date;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested ?? "") ? requested! : new Date().toISOString().slice(0, 10);
  const supabase = await createClient();
  const [{ data: jobs }, { data: techs }, { data: assignments }] = await Promise.all([
    supabase.from("jobs").select("id,service,status,scheduled_date,end_date,start_time,end_time,assigned_to,job_address,job_city,customers(name)").lte("scheduled_date", date).or(`end_date.gte.${date},end_date.is.null`).is("deleted_at", null).order("start_time"),
    supabase.from("profiles").select("id,full_name,role").in("role", ["tech", "office", "owner"]).order("full_name"),
    supabase.from("job_assignments").select("job_id,profile_id,is_lead"),
  ]);
  const normalized = (jobs ?? []).map((job) => ({ ...job, customers: Array.isArray(job.customers) ? (job.customers[0] ?? null) : job.customers }));
  return <DispatchBoard locale={locale} date={date} jobs={normalized as DispatchJob[]} techs={(techs ?? []) as DispatchTech[]} assignments={(assignments ?? []) as DispatchAssignment[]} />;
}
