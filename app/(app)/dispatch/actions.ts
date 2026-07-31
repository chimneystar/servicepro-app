"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
// @ts-ignore -- shared JS module
import { isDoubleBookConflict } from "@/lib/core/db-errors.mjs";
import { notifyJobAssigned } from "@/lib/push";
import { assertAssignableToJob } from "./assignment-guard";

export type DispatchResult = { ok: boolean; error?: string };

async function dispatcher() {
  const profile = await requireProfile();
  assertRole(profile, ["owner", "office"]);
  return profile;
}

/**
 * Move a job to a technician, or back to Unassigned.
 *
 * Two defects lived here. The lead's `job_assignments` row was upserted but the
 * PREVIOUS lead's row was never removed — and moving to Unassigned removed
 * nothing at all — so the dispatch board went on rendering the old technician
 * as extra crew on a job they no longer had. And every failure collapsed into
 * one generic message, so the one failure the dispatcher can actually act on
 * (23P01: the technician is already booked over that time) was never said out
 * loud. `schedule/actions.ts` createJob already maps that code; this follows it.
 */
export async function moveDispatchJob(
  jobId: string,
  profileId: string | null,
): Promise<DispatchResult> {
  const profile = await dispatcher();
  const locale = await getLocale();
  const supabase = await createClient();
  if (profileId) {
    const { data: teammate } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", profileId)
      .eq("organization_id", profile.organization_id!)
      .maybeSingle();
    if (!teammate) return { ok: false, error: t(locale, "err.invalid") };
    // 6c.3 / 6c.11: is this person working that day, and certified for it? The
    // board previously knew neither, so a job could be dropped on somebody on
    // holiday or without the gas ticket and nothing objected.
    const assignable = await assertAssignableToJob(supabase, {
      organizationId: profile.organization_id!,
      jobId,
      profileId,
      locale,
    });
    if (!assignable.ok) return { ok: false, error: assignable.error ?? undefined };
  }
  const { error } = await supabase
    .from("jobs")
    .update({ assigned_to: profileId })
    .eq("id", jobId)
    .eq("organization_id", profile.organization_id!);
  if (error) {
    // 23P01 = exclusion_violation -> jobs_no_double_book refused the overlap.
    if (isDoubleBookConflict(error)) return { ok: false, error: t(locale, "sched.conflict") };
    return { ok: false, error: error.message };
  }
  // Retire the outgoing lead's row. This runs for the unassign case too, which
  // is exactly the case that used to leave a ghost technician on the card.
  const stale = supabase
    .from("job_assignments")
    .delete()
    .eq("organization_id", profile.organization_id!)
    .eq("job_id", jobId)
    .eq("is_lead", true);
  const { error: staleError } = await (profileId ? stale.neq("profile_id", profileId) : stale);
  if (staleError) return { ok: false, error: staleError.message };
  if (profileId) {
    const { error: leadError } = await supabase.from("job_assignments").upsert(
      {
        organization_id: profile.organization_id,
        job_id: jobId,
        profile_id: profileId,
        is_lead: true,
      },
      { onConflict: "job_id,profile_id" },
    );
    if (leadError) {
      if (isDoubleBookConflict(leadError)) return { ok: false, error: t(locale, "sched.conflict") };
      return { ok: false, error: leadError.message };
    }
    // The job is now theirs — tell their phone. Push enrolment existed with no
    // sender at all, so a technician could be given work and never hear about
    // it. Delivery failure is logged, never fatal to the assignment.
    await notifyJobAssigned({ organizationId: profile.organization_id!, jobId, profileId });
  }
  revalidatePath("/dispatch");
  return { ok: true };
}

export async function addJobTechnician(jobId: string, profileId: string): Promise<DispatchResult> {
  const profile = await dispatcher();
  const locale = await getLocale();
  const supabase = await createClient();
  const { data: teammate } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", profileId)
    .eq("organization_id", profile.organization_id!)
    .maybeSingle();
  if (!teammate) return { ok: false, error: t(locale, "err.invalid") };
  // Crew members get the same availability and certification test as the lead.
  // Migration 028 had to close exactly this gap for double-booking: a rule that
  // applies to the lead and not the crew is a rule with a documented bypass.
  const assignable = await assertAssignableToJob(supabase, {
    organizationId: profile.organization_id!,
    jobId,
    profileId,
    locale,
  });
  if (!assignable.ok) return { ok: false, error: assignable.error ?? undefined };
  const { error } = await supabase.from("job_assignments").upsert(
    {
      organization_id: profile.organization_id,
      job_id: jobId,
      profile_id: profileId,
      is_lead: false,
    },
    { onConflict: "job_id,profile_id" },
  );
  // Migration 028 raises 23P01 for crew overlaps, exactly as the lead-side
  // exclusion constraint does. Say which one it is.
  if (error)
    return {
      ok: false,
      error: isDoubleBookConflict(error) ? t(locale, "sched.conflict") : error.message,
    };
  await notifyJobAssigned({ organizationId: profile.organization_id!, jobId, profileId });
  revalidatePath("/dispatch");
  return { ok: true };
}

export async function removeJobTechnician(
  jobId: string,
  profileId: string,
): Promise<DispatchResult> {
  const profile = await dispatcher();
  const locale = await getLocale();
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("assigned_to")
    .eq("id", jobId)
    .eq("organization_id", profile.organization_id!)
    .maybeSingle();
  if (job?.assigned_to === profileId) return { ok: false, error: t(locale, "err.invalid") };
  const { error } = await supabase
    .from("job_assignments")
    .delete()
    .eq("organization_id", profile.organization_id!)
    .eq("job_id", jobId)
    .eq("profile_id", profileId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dispatch");
  return { ok: true };
}
