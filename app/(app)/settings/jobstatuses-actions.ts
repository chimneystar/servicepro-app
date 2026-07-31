"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";

export type ActionResult = { ok: boolean; error?: string };

export async function saveJobStatus(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let profile;
  try {
    profile = await requireProfile();
    assertRole(profile, ["owner", "office"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name required" };
  const kind = String(formData.get("kind") ?? "open");
  const row = {
    organization_id: profile.organization_id,
    name,
    color: String(formData.get("color") ?? "#2563eb"),
    sort: Math.max(0, parseInt(String(formData.get("sort") ?? "50"), 10) || 50),
    is_done: kind === "done",
    is_cancelled: kind === "cancelled",
  };
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("job_statuses").update(row).eq("id", id)
    : await supabase.from("job_statuses").insert(row);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

export async function deleteJobStatus(id: string): Promise<ActionResult> {
  try {
    const p = await requireProfile();
    assertRole(p, ["owner", "office"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("job_statuses").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}
