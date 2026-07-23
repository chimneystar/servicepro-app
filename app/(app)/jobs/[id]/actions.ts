"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

export type PhotoResult = { ok: boolean; error?: string };

/** Record a job photo row after the file has been uploaded to Storage. */
export async function recordPhoto(jobId: string, path: string, label: string): Promise<PhotoResult> {
  const profile = await requireProfile();
  const supabase = createClient();
  const { error } = await supabase.from("job_photos").insert({
    organization_id: profile.organization_id,
    job_id: jobId,
    storage_path: path,
    label: label || null,
    created_by: profile.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Delete a job photo (storage object + row). */
export async function deletePhoto(id: string, path: string, jobId: string): Promise<PhotoResult> {
  await requireProfile();
  const supabase = createClient();
  await supabase.storage.from("job-photos").remove([path]);
  const { error } = await supabase.from("job_photos").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Update a job's status from the detail page. */
export async function updateJobStatus(jobId: string, status: string): Promise<PhotoResult> {
  await requireProfile();
  const supabase = createClient();
  const { error } = await supabase.from("jobs").update({ status }).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
