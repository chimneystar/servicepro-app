import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import JobsList, { type JobRow, type StageDef } from "@/components/JobsList";
import JobForm from "@/app/(app)/schedule/JobForm";
// @ts-ignore — pure helpers, unit-tested by node:test.
import { clampLimit, isTruncated } from "@/lib/core/query-window.mjs";

export const dynamic = "force-dynamic";

// THE BUG: `.limit(500)` with no pagination and NO indication of truncation.
// Past 500 jobs the status tab counts and the search box silently described a
// different business than the one on file — the numbers were confidently wrong,
// which is worse than a slow page. The limit stays (it has to), but it is now
// adjustable and, more importantly, VISIBLE.
const DEFAULT_PAGE = 500;
const MAX_PAGE = 5000;

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const profile = await requireProfile();
  const locale = (await getLocale());
  const search = await searchParams;
  const pageSize: number = clampLimit(search.show, DEFAULT_PAGE, MAX_PAGE);
  const supabase = await createClient();
  const [{ data: jobs }, { count: totalJobs }, { data: stages }, { data: org }, { data: custs }, { data: techs }, { data: jobTypes }] = await Promise.all([
    supabase.from("jobs")
      .select("id, service, stage, tags, price_minor, scheduled_date, start_time, stage_changed_at, customers(name, address, city), profiles!jobs_assigned_to_fkey(full_name)")
      .is("deleted_at", null).order("scheduled_date", { ascending: false }).limit(pageSize),
    // Counted at the database so the banner can state the real total rather
    // than the size of the page we happened to load.
    supabase.from("jobs").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("job_statuses").select("name, color, is_done, is_cancelled").order("sort"),
    supabase.from("organizations").select("currency").single(),
    supabase.from("customers").select("id, name").is("deleted_at", null).eq("archived", false).order("name").limit(1000),
    supabase.from("profiles").select("id, full_name").order("full_name").limit(200),
    supabase.from("job_types").select("name, color, duration_min, default_price_minor").order("sort").order("name"),
  ]);

  const rows: JobRow[] = (jobs ?? []).map((j: any) => ({
    id: j.id, service: j.service, stage: j.stage ?? "Scheduled", tags: j.tags ?? [], price_minor: j.price_minor,
    scheduled_date: j.scheduled_date, start_time: j.start_time, stage_changed_at: j.stage_changed_at ?? j.scheduled_date,
    customer: j.customers?.name ?? "—", address: [j.customers?.address, j.customers?.city].filter(Boolean).join(", "), tech: j.profiles?.full_name ?? null,
  }));

  const canEdit = profile.role !== "tech";
  const truncated: boolean = isTruncated(rows.length, pageSize) && (totalJobs ?? 0) > rows.length;
  // Server request time is intentionally captured once for stable aging labels.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800 }}>Jobs</h1>
        {canEdit && <JobForm locale={locale} customers={(custs ?? []).map((c) => ({ id: c.id, label: c.name }))} techs={(techs ?? []).map((p) => ({ id: p.id, label: p.full_name || "—" }))} jobTypes={jobTypes ?? undefined} />}
      </div>
      <JobsList
        jobs={rows}
        stages={(stages ?? []) as StageDef[]}
        currency={org?.currency ?? "USD"}
        nowMs={nowMs}
        truncated={truncated}
        loadedCount={rows.length}
        totalCount={totalJobs ?? rows.length}
        loadMoreHref={pageSize < MAX_PAGE ? `/jobs?show=${Math.min(pageSize * 2, MAX_PAGE)}` : null}
      />
    </div>
  );
}
