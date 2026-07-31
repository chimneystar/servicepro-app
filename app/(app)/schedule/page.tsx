import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { todayISO } from "@/lib/format";
import JobForm from "./JobForm";
import Calendar, { type CalJob } from "@/components/Calendar";
// @ts-ignore — pure date-window arithmetic, unit-tested by node:test.
import { fetchWindow, toIsoDate, isTruncated } from "@/lib/core/query-window.mjs";

export const dynamic = "force-dynamic";

// A single month plus two weeks of padding is far more than any calendar view
// shows, so this ceiling exists only to stop a pathological month (a bulk
// import gone wrong) from becoming an unbounded response. If it is ever hit the
// calendar says so rather than quietly dropping appointments.
const JOB_CEILING = 2000;

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; anchor?: string }>;
}) {
  const search = await searchParams;
  await requireProfile();
  const locale = await getLocale();
  const supabase = await createClient();

  // THE BUG: this selected EVERY non-deleted job in the organisation, with no
  // date filter and no limit, and components/Calendar.tsx then discarded all but
  // the visible week in JavaScript. The calendar shows at most six weeks at a
  // time, so the query is now scoped to the period actually on screen. The
  // anchor comes from the calendar itself when the user pages out of the loaded
  // window — see the refetch in components/Calendar.tsx.
  const anchor: string = toIsoDate(search.anchor, todayISO());
  const window: { from: string; to: string } = fetchWindow(anchor);

  const [{ data: jobs }, { data: customers }, { data: profiles }, { data: jobTypes }] =
    await Promise.all([
      supabase
        .from("jobs")
        .select(
          "id, service, status, scheduled_date, start_time, end_time, customers(name), profiles!jobs_assigned_to_fkey(full_name)",
        )
        .is("deleted_at", null)
        .gte("scheduled_date", window.from)
        .lte("scheduled_date", window.to)
        .order("scheduled_date")
        .limit(JOB_CEILING),
      supabase
        .from("customers")
        .select("id, name")
        .is("deleted_at", null)
        .order("name")
        .limit(1000),
      supabase.from("profiles").select("id, full_name").order("full_name").limit(200),
      supabase
        .from("job_types")
        .select("name, color, duration_min, default_price_minor")
        .order("sort")
        .order("name"),
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
  const typeColors: Record<string, string> = Object.fromEntries(
    (jobTypes ?? []).map((tp: any) => [tp.name, tp.color]),
  );
  const truncated: boolean = isTruncated(calJobs.length, JOB_CEILING);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800 }}>{t(locale, "sched.title")}</h1>
        <JobForm
          locale={locale}
          customers={custOpts}
          techs={techOpts}
          jobTypes={jobTypes ?? undefined}
          initialOpen={search.new === "1"}
        />
      </div>
      <Calendar
        jobs={calJobs}
        he={locale === "he"}
        typeColors={typeColors}
        rangeFrom={window.from}
        rangeTo={window.to}
        truncated={truncated}
      />
    </div>
  );
}
