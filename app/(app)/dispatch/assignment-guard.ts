import { createClient } from "@/lib/supabase/server";
// @ts-ignore -- pure logic, proven both ways in tests/availability.test.mjs
import { isProfileOff, describeUnavailable } from "@/lib/core/availability.mjs";
// @ts-ignore -- pure logic, proven both ways in tests/skills.test.mjs
import { checkSkillMatch, describeSkillGap } from "@/lib/core/skills.mjs";
import * as techniciansData from "@/lib/data/technicians";

/**
 * The two questions every assignment path has to ask before it writes, and the
 * reason they live here rather than in one screen's action.
 *
 * 6c.3 — is this person actually working that day? The only availability
 * inputs the product had were the organisation's business hours and the jobs
 * already on the calendar, so dispatch would happily drop a job on somebody who
 * was on holiday and nobody found out until the morning.
 *
 * 6c.11 — are they certified for it? Dispatch could not know who is licensed
 * for gas, HVAC or electrical work. That is not a preference; it is a condition
 * of being allowed to do the work at all.
 *
 * THIS DOES NOT WEAKEN THE NO-DOUBLE-BOOK GUARANTEE. It only ever REFUSES an
 * assignment before it is attempted. `jobs_no_double_book` and the two triggers
 * from db/028_crew_double_book.sql still have the last word on overlap, and
 * nothing here writes to jobs, job_assignments or their times.
 */
export type AssignmentCheck = { ok: boolean; error?: string | null };

export async function assertAssignable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    organizationId: string;
    profileId: string;
    /** When the job's own row is not loaded yet, pass the intended slot. */
    date: string;
    startTime?: string | null;
    endTime?: string | null;
    requiredSkills?: string[] | null;
    locale?: "en" | "he";
  },
): Promise<AssignmentCheck> {
  const locale = input.locale ?? "en";
  if (!input.profileId || !/^\d{4}-\d{2}-\d{2}$/.test(String(input.date ?? "")))
    return { ok: true };

  const { data: person } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", input.profileId)
    .maybeSingle();
  const name = person?.full_name ?? "";

  // Time off. `profile_id is null` rows are business closures and apply to
  // everyone, so both are fetched in one query and separated by the pure rule.
  const timeOff = await techniciansData.listApprovedTimeOffFor(
    supabase,
    input.organizationId,
    input.profileId,
    input.date,
  );

  const off = isProfileOff(
    timeOff,
    input.profileId,
    input.date,
    input.startTime ?? null,
    input.endTime ?? null,
  );
  if (off.off) return { ok: false, error: describeUnavailable(off, { locale, name }) };

  // Certifications. An empty requirement list — the column default and every
  // job that exists today — means no restriction, so nothing that works before
  // this feature starts being refused after it.
  const required = (input.requiredSkills ?? []).filter(Boolean);
  if (!required.length) return { ok: true };

  const skills = await techniciansData.listSkillsFor(
    supabase,
    input.organizationId,
    input.profileId,
  );

  const match = checkSkillMatch({ required, skills, onDate: input.date });
  if (!match.ok) return { ok: false, error: describeSkillGap(match, { locale, name }) };
  return { ok: true };
}

/** Load the job's slot and requirements, then run the same check. */
export async function assertAssignableToJob(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: { organizationId: string; jobId: string; profileId: string; locale?: "en" | "he" },
): Promise<AssignmentCheck> {
  const { data: job } = await supabase
    .from("jobs")
    .select("scheduled_date,start_time,end_time,required_skills")
    .eq("id", input.jobId)
    .eq("organization_id", input.organizationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!job) return { ok: true }; // the caller's own update will refuse it
  return assertAssignable(supabase, {
    organizationId: input.organizationId,
    profileId: input.profileId,
    date: String(job.scheduled_date),
    startTime: job.start_time,
    endTime: job.end_time,
    requiredSkills: (job as any).required_skills ?? [],
    locale: input.locale,
  });
}
