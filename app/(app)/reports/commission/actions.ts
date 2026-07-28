"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";

export type ActionResult = { ok: boolean; error?: string };

/** Set a technician's commission percentage (owner only). */
export async function updateCommission(profileId: string, pct: number): Promise<ActionResult> {
  try { const p = await requireProfile(); assertRole(p, ["owner"]); }
  catch { return { ok: false, error: "forbidden" }; }
  const clean = Math.max(0, Math.min(100, Math.round(pct)));
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ commission_pct: clean }).eq("id", profileId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/reports/commission");
  return { ok: true };
}
