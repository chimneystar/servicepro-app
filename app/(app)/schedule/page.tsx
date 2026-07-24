import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import JobForm from "./JobForm";
import Calendar, { type CalJob } from "@/components/Calendar";

export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  await requireProfile();
  const locale = getLocale();
  const supabase = createClient();

  const [{ data: jobs }, { data: customers }, { data: profiles }, { data: org }] = await Promise.all([
    supabase.from("jobs")
      .select("id, service, status, scheduled_date, start_time, end_time, customers(name), profiles!jobs_assigned_to_fkey(full_name)")
      .is("deleted_at", null),
    supabase.from("customers").select("id, name").is("deleted_at", null).order("name"),
    supabase.from("profiles").select("id, full_name").order("full_name"),
    supabase.from("organizations").select("job_types").single(),
  ]);

  const calJobs: CalJob[] = (jobs ?? []).map((j: any) => ({
    id: j.id,
    title: j.customers?.name ?? "—",
    service: j.service,
    status: j.status,
    date: j.scheduled_date,
    start: j.start_time,
    end: j.end_time,
    tech: j.profiles?.full_name ?? "",
  }));

  const custOpts = (customers ?? []).map((c) => ({ id: c.id, label: c.name }));
  const techOpts = (profiles ?? []).map((p) => ({ id: p.id, label: p.full_name || "—" }));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>{t(locale, "sched.title")}</h1>
        <JobForm locale={locale} customers={custOpts} techs={techOpts} services={org?.job_types ?? undefined} />
      </div>
      <Calendar jobs={calJobs} he={locale === "he"} />
    </div>
  );
}
