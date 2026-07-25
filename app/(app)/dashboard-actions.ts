"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

export async function dismissOnboarding(): Promise<{ ok: boolean }> {
  const profile = await requireProfile();
  const supabase = createClient();
  await supabase.from("organizations").update({ onboarding_dismissed: true }).eq("id", profile.organization_id!);
  revalidatePath("/");
  return { ok: true };
}
