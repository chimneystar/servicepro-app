import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import JobsList, { type JobRow, type StageDef } from "@/components/JobsList";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const profile = await requireProfile();
  const supabase = createClient();
  const [{ data: jobs }, { data: stages }, { data: org }] = await Promise.all([
    supabase.from("jobs")
      .select("id, service, stage, tags, price_minor, scheduled_date, start_time, stage_changed_at, customers(name, address, city), profiles!jobs_assigned_to_fkey(full_name)")
      .is("deleted_at", null).order("scheduled_date", { ascending: false }).limit(500),
    supabase.from("job_statuses").select("name, color, is_done, is_cancelled").order("sort"),
    supabase.from("organizations").select("currency").single(),
  ]);

  const rows: JobRow[] = (jobs ?? []).map((j: any) => ({
    id: j.id, service: j.service, stage: j.stage ?? "Scheduled", tags: j.tags ?? [], price_minor: j.price_minor,
    scheduled_date: j.scheduled_date, start_time: j.start_time, stage_changed_at: j.stage_changed_at ?? j.scheduled_date,
    customer: j.customers?.name ?? "—", address: [j.customers?.address, j.customers?.city].filter(Boolean).join(", "), tech: j.profiles?.full_name ?? null,
  }));

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>Jobs</h1>
      <JobsList jobs={rows} stages={(stages ?? []) as StageDef[]} currency={org?.currency ?? "USD"} nowMs={Date.now()} />
    </div>
  );
}
