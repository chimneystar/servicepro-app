"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type OnboardingState = { error?: string };

export async function createBusinessAction(_state: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const parsed = z.string().trim().min(2, "צריך לכתוב את שם העסק").max(80).safeParse(formData.get("business_name"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "צריך לבדוק את שם העסק" };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");

  const { error } = await supabase.rpc("sp_create_business", { p_name: parsed.data });
  if (error) {
    console.error("ServicePro onboarding RPC failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return { error: "לא הצלחנו לפתוח את העסק. כדאי לבדוק שקובץ ה‑SQL הורץ ב‑Supabase" };
  }
  redirect("/app");
}
