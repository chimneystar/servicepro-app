"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
// @ts-ignore -- shared JS module, proven both ways in tests/scheduled-reports.test.mjs
import { isDigestFrequency } from "@/lib/core/digest.mjs";

export type ActionResult = { ok: boolean; error?: string };

/**
 * Scheduled report management (ledger 6c.9).
 *
 * Owner only, because the digest carries collected revenue, margin and net
 * profit for the whole business — the same figures /reports refuses to a
 * technician. Recipients are PROFILE IDS, not free-text addresses: a schedule
 * that could mail an arbitrary address would be a data-exfiltration control
 * dressed up as a convenience, and it would bypass the shared opt-out rule that
 * `staffEmailEligibility` applies at send time.
 */
export async function createReportSchedule(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner"]); }
  catch { return { ok: false, error: "Only the owner can schedule reports." }; }

  const name = String(formData.get("name") ?? "").trim().slice(0, 80) || "Business summary";
  const frequency = String(formData.get("frequency") ?? "weekly");
  if (!isDigestFrequency(frequency)) return { ok: false, error: "That frequency does not exist." };

  const recipients = formData.getAll("recipients").map((value) => String(value)).filter(Boolean);
  if (!recipients.length) {
    // Refused rather than created empty: a schedule with nobody on it runs every
    // night, fails every night, and looks configured.
    return { ok: false, error: "Choose at least one recipient — a schedule with nobody on it would send nothing." };
  }

  const supabase = await createClient();
  // Every recipient must be a real member of THIS organisation. A forged id in
  // the form body is discarded, not stored.
  const { data: members } = await supabase.from("profiles")
    .select("id").eq("organization_id", profile.organization_id).in("id", recipients);
  const valid = (members ?? []).map((row: { id: string }) => row.id);
  if (!valid.length) return { ok: false, error: "None of those recipients are members of this business." };

  const { error } = await supabase.from("report_schedules").insert({
    organization_id: profile.organization_id,
    name, frequency, enabled: true,
    recipient_profile_ids: valid,
    starts_on: new Date().toISOString().slice(0, 10),
    created_by: profile.id,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/reports/schedule");
  return { ok: true };
}

export async function setReportScheduleEnabled(id: string, enabled: boolean): Promise<ActionResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner"]); }
  catch { return { ok: false, error: "Only the owner can change a schedule." }; }
  const supabase = await createClient();
  const { error } = await supabase.from("report_schedules")
    .update({ enabled }).eq("id", id).eq("organization_id", profile.organization_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/reports/schedule");
  return { ok: true };
}

export async function deleteReportSchedule(id: string): Promise<ActionResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner"]); }
  catch { return { ok: false, error: "Only the owner can delete a schedule." }; }
  const supabase = await createClient();
  const { error } = await supabase.from("report_schedules")
    .delete().eq("id", id).eq("organization_id", profile.organization_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/reports/schedule");
  return { ok: true };
}
