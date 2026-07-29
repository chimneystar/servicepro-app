"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

async function dispatcher() {
  const profile = await requireProfile();
  assertRole(profile, ["owner", "office"]);
  return profile;
}

export async function moveDispatchJob(jobId: string, profileId: string | null) {
  const profile = await dispatcher();
  const supabase = await createClient();
  if (profileId) {
    const { data: teammate } = await supabase.from("profiles").select("id").eq("id", profileId).eq("organization_id", profile.organization_id!).maybeSingle();
    if (!teammate) return { ok: false };
  }
  const { error } = await supabase.from("jobs").update({ assigned_to: profileId }).eq("id", jobId).eq("organization_id", profile.organization_id!);
  if (error) return { ok: false };
  if (profileId) await supabase.from("job_assignments").upsert({ organization_id: profile.organization_id, job_id: jobId, profile_id: profileId, is_lead: true }, { onConflict: "job_id,profile_id" });
  revalidatePath("/dispatch");
  return { ok: true };
}

export async function addJobTechnician(jobId: string, profileId: string) {
  const profile = await dispatcher();
  const supabase = await createClient();
  const { data: teammate } = await supabase.from("profiles").select("id").eq("id", profileId).eq("organization_id", profile.organization_id!).maybeSingle();
  if (!teammate) return { ok: false };
  const { error } = await supabase.from("job_assignments").upsert({ organization_id: profile.organization_id, job_id: jobId, profile_id: profileId, is_lead: false }, { onConflict: "job_id,profile_id" });
  revalidatePath("/dispatch");
  return { ok: !error };
}

export async function removeJobTechnician(jobId: string, profileId: string) {
  const profile = await dispatcher();
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("assigned_to").eq("id", jobId).eq("organization_id", profile.organization_id!).maybeSingle();
  if (job?.assigned_to === profileId) return { ok: false };
  const { error } = await supabase.from("job_assignments").delete().eq("job_id", jobId).eq("profile_id", profileId);
  revalidatePath("/dispatch");
  return { ok: !error };
}
