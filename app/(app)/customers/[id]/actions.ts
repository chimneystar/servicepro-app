"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

export type ActionResult = { ok: boolean; error?: string };

export async function addReview(customerId: string, rating: number, body: string): Promise<ActionResult> {
  const profile = await requireProfile();
  const r = Math.max(1, Math.min(5, Math.round(rating)));
  const supabase = createClient();
  const { error } = await supabase.from("reviews").insert({
    organization_id: profile.organization_id,
    customer_id: customerId,
    rating: r,
    body: body.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/customers/${customerId}`);
  return { ok: true };
}
