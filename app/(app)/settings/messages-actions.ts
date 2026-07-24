"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";

export type ActionResult = { ok: boolean; error?: string };

const TRIGGERS = ["booked", "day_before", "on_the_way", "completed"] as const;

/** Save one message template (enabled flag + body) for a given trigger. */
export async function saveMessageTemplate(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }

  const trigger = String(formData.get("trigger") ?? "");
  if (!TRIGGERS.includes(trigger as any)) return { ok: false, error: "Invalid trigger" };
  const enabled = String(formData.get("enabled") ?? "") === "on";
  const body = String(formData.get("body") ?? "").trim();

  const supabase = createClient();
  const { error } = await supabase.from("message_templates").upsert(
    { organization_id: profile.organization_id, trigger, enabled, body },
    { onConflict: "organization_id,trigger" }
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/messages");
  return { ok: true };
}
