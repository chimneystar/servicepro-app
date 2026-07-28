import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import JobsList, { type JobRow, type StageDef } from "@/components/JobsList";
import JobForm from "@/app/(app)/schedule/JobForm";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const profile = await requireProfile();
  const locale = getLocale();
  const supabase = createClient();
  const [{ data: jobs }, { data: stages }, { data: org }, { data: custs }, { data: techs }, { data: jobTypes }] = await Promise.all([
    supabase.from("jobs")
      .select("id, service, stage, tags, price_minor, scheduled_date, start_time, stage_changed_at, customers(name, address, city), profiles!jobs_assigned_to_fkey(full_name)")
      .is("deleted_at", null).order("scheduled_date", { ascending: false }).limit(500),
    supabase.from("job_statuses").select("name, color, is_done, is_cancelled").order("sort"),
    supabase.from("organizations").select("currency").single(),
    supabase.from("customers").select("id, name").is("deleted_at", null).eq("archived", false).order("name"),
    supabase.from("profiles").select("id, full_name").order("full_name"),
    supabase.from("job_types").select("name, color, duration_min, default_price_minor").order("sort").order("name"),
  ]);

  const rows: JobRow[] = (jobs ?? []).map((j: any) => ({
    id: j.id, service: j.service, stage: j.stage ?? "Scheduled", tags: j.tags ?? [], price_minor: j.price_minor,
    scheduled_date: j.scheduled_date, start_time: j.start_time, stage_changed_at: j.stage_changed_at ?? j.scheduled_date,
    customer: j.customers?.name ?? "—", address: [j.customers?.address, j.customers?.city].filter(Boolean).join(", "), tech: j.profiles?.full_name ?? null,
  }));

  const canEdit = profile.role !== "tech";
  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>Jobs</h1>
        {canEdit && <JobForm locale={locale} customers={(custs ?? []).map((c) => ({ id: c.id, label: c.name }))} techs={(techs ?? []).map((p) => ({ id: p.id, label: p.full_name || "—" }))} jobTypes={jobTypes ?? undefined} />}
      </div>
      <JobsList jobs={rows} stages={(stages ?? []) as StageDef[]} currency={org?.currency ?? "USD"} nowMs={Date.now()} />
    </div>
  );
}
