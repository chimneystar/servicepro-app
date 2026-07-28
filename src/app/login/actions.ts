"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; message?: string };

const emailSchema = z.email("כתובת המייל לא נראית תקינה");
const passwordSchema = z.string().min(8, "הסיסמה צריכה להכיל לפחות 8 תווים");

export async function signInAction(_state: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = z
    .object({ email: emailSchema, password: passwordSchema })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "צריך לבדוק את הפרטים" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "המייל או הסיסמה לא נכונים" };
  redirect("/app");
}

export async function signUpAction(_state: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = z
    .object({
      displayName: z.string().trim().min(2, "צריך לכתוב שם"),
      email: emailSchema,
      password: passwordSchema,
    })
    .safeParse({
      displayName: formData.get("display_name"),
      email: formData.get("email"),
      password: formData.get("password"),
    });

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "צריך לבדוק את הפרטים" };

  const requestHeaders = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL || requestHeaders.get("origin") || "http://localhost:3000";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes("already")) return { error: "כבר יש חשבון עם המייל הזה" };
    return { error: "לא הצלחנו לפתוח את החשבון. כדאי לנסות שוב בעוד רגע" };
  }

  if (data.session) redirect("/onboarding");
  return { message: "שלחנו לך מייל. אחרי האישור אפשר להיכנס ולהתחיל לעבוד" };
}
