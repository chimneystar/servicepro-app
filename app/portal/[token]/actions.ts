"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type PortalRequestResult = { ok: boolean; error?: string };

/**
 * A customer's request from the portal — reschedule, question, or contact
 * preferences.
 *
 * WHAT WAS WRONG. The RPC's `error` was destructured away and never read, and
 * the whole body was `if (data === true) revalidatePath(...)`. So when the
 * request failed — an expired token, a revoked portal link, a database error —
 * the customer saw the page reload with their message gone and no explanation.
 * They had every reason to believe the business had been told they need a
 * different date. Nobody had.
 *
 * `data === false` and an error are deliberately distinguished: the first means
 * the token no longer grants access (the RPC's own decision), the second means
 * we could not ask. Telling a customer their link expired when the database was
 * simply unreachable would send them to the business for the wrong reason.
 */
export async function submitPortalRequest(
  token: string,
  formData: FormData,
): Promise<PortalRequestResult> {
  const supabase = await createClient();
  const type = String(formData.get("type") ?? "question");
  const { data, error } = await supabase.rpc("submit_customer_portal_request", {
    p_token: token,
    p_type: type,
    p_job: String(formData.get("jobId") ?? "") || null,
    p_date: String(formData.get("date") ?? "") || null,
    p_message: String(formData.get("message") ?? "") || null,
    p_email_opt_in: type === "preferences" ? formData.get("emailOptIn") === "on" : null,
    p_sms_opt_in: type === "preferences" ? formData.get("smsOptIn") === "on" : null,
  });

  if (error) {
    return { ok: false, error: "We couldn’t send that just now. Please try again." };
  }
  if (data !== true) {
    return {
      ok: false,
      error: "This link is no longer active. Please contact the business directly.",
    };
  }
  revalidatePath(`/portal/${token}`);
  return { ok: true };
}
