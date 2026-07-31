"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function submitPortalRequest(token: string, formData: FormData) {
  const supabase = await createClient();
  const type = String(formData.get("type") ?? "question");
  const { data } = await supabase.rpc("submit_customer_portal_request", {
    p_token: token,
    p_type: type,
    p_job: String(formData.get("jobId") ?? "") || null,
    p_date: String(formData.get("date") ?? "") || null,
    p_message: String(formData.get("message") ?? "") || null,
    p_email_opt_in: type === "preferences" ? formData.get("emailOptIn") === "on" : null,
    p_sms_opt_in: type === "preferences" ? formData.get("smsOptIn") === "on" : null,
  });
  if (data === true) revalidatePath(`/portal/${token}`);
}
