"use server";

import { revalidatePath } from "next/cache";
import { assertRole, requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isOneOf } from "@/lib/validation";
import { getLocale } from "@/lib/locale-server";
import { runDataRetentionForOrganization } from "@/lib/data-retention";

export type PrivacyResult = {
  ok: boolean;
  error?: string;
  summary?: Record<string, number | boolean>;
};
const message = (he: boolean) =>
  he
    ? "לא הצלחנו לשמור את השינוי. בדקו את הפרטים ונסו שוב."
    : "We couldn't save the change. Check the details and try again.";
async function guard() {
  const profile = await requireProfile();
  assertRole(profile, ["owner"]);
  return profile;
}

export async function savePrivacySettings(
  _previous: PrivacyResult,
  formData: FormData,
): Promise<PrivacyResult> {
  const he = (await getLocale()) === "he";
  try {
    const profile = await guard(),
      supabase = await createClient();
    const n = (key: string, fallback: number) => {
      const value = Number(formData.get(key) ?? fallback);
      return Number.isFinite(value) ? Math.round(value) : fallback;
    };
    const { error } = await supabase.from("organization_privacy_settings").upsert(
      {
        organization_id: profile.organization_id,
        privacy_email: String(formData.get("privacyEmail") ?? "").trim() || null,
        privacy_phone: String(formData.get("privacyPhone") ?? "").trim() || null,
        location_retention_days: n("locationDays", 30),
        call_recording_retention_days: n("callDays", 90),
        communication_retention_days: n("communicationDays", 730),
        job_media_retention_days: n("mediaDays", 2555),
        audit_retention_days: n("auditDays", 2555),
        auto_enforce: formData.get("autoEnforce") === "on",
        updated_by: profile.id,
      },
      { onConflict: "organization_id" },
    );
    if (error) return { ok: false, error: message(he) };
    revalidatePath("/settings/privacy");
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: he
        ? "העמוד הזה זמין לבעלי העסק בלבד."
        : "This page is available to business owners only.",
    };
  }
}

export async function recordConsent(
  _previous: PrivacyResult,
  formData: FormData,
): Promise<PrivacyResult> {
  const he = (await getLocale()) === "he";
  try {
    const profile = await guard(),
      customerId = String(formData.get("customerId") ?? "");
    if (!customerId) return { ok: false, error: message(he) };
    // `consent_events.channel` is CHECK-constrained and was written with no
    // validation at all: the value went straight from the form to Postgres,
    // which refused it, and the caller reported a generic failure.
    const channel = String(formData.get("channel") ?? "email");
    if (
      !isOneOf(["email", "sms", "phone", "location", "terms", "privacy", "payment_method"], channel)
    )
      return { ok: false, error: message(he) };
    const supabase = await createClient();
    const { error } = await supabase.from("consent_events").insert({
      organization_id: profile.organization_id,
      customer_id: customerId,
      channel,
      purpose: String(formData.get("purpose") ?? "").trim() || "customer communication",
      granted: formData.get("granted") === "yes",
      source: "staff",
      policy_version: String(formData.get("policyVersion") ?? "").trim() || null,
      proof: { note: String(formData.get("note") ?? "").trim() },
      recorded_by: profile.id,
    });
    if (error) return { ok: false, error: message(he) };
    revalidatePath("/settings/privacy");
    return { ok: true };
  } catch {
    return { ok: false, error: message(he) };
  }
}

export async function createPrivacyRequest(
  _previous: PrivacyResult,
  formData: FormData,
): Promise<PrivacyResult> {
  const he = (await getLocale()) === "he";
  try {
    const profile = await guard(),
      supabase = await createClient(),
      name = String(formData.get("requesterName") ?? "").trim();
    if (!name) return { ok: false, error: message(he) };
    // `privacy_requests.request_type` is CHECK-constrained; same gap.
    const requestType = String(formData.get("requestType") ?? "access");
    if (!isOneOf(["access", "export", "correction", "deletion", "opt_out"], requestType))
      return { ok: false, error: message(he) };
    const due = new Date();
    due.setDate(due.getDate() + 30);
    const { error } = await supabase.from("privacy_requests").insert({
      organization_id: profile.organization_id,
      customer_id: String(formData.get("customerId") ?? "") || null,
      request_type: requestType,
      requester_name: name,
      requester_email: String(formData.get("email") ?? "").trim() || null,
      requester_phone: String(formData.get("phone") ?? "").trim() || null,
      details: String(formData.get("details") ?? "").trim() || null,
      due_at: String(formData.get("dueAt") ?? "") || due.toISOString(),
      assigned_to: String(formData.get("assignedTo") ?? "") || profile.id,
      created_by: profile.id,
    });
    if (error) return { ok: false, error: message(he) };
    revalidatePath("/settings/privacy");
    return { ok: true };
  } catch {
    return { ok: false, error: message(he) };
  }
}

export async function updatePrivacyRequest(
  id: string,
  status: string,
  verified: boolean,
  notes: string,
): Promise<PrivacyResult> {
  const he = (await getLocale()) === "he";
  if (
    ![
      "received",
      "identity_check",
      "in_progress",
      "blocked",
      "ready",
      "completed",
      "denied",
      "cancelled",
    ].includes(status)
  )
    return { ok: false, error: message(he) };
  try {
    const profile = await guard(),
      supabase = await createClient();
    const update: any = { status, completion_notes: notes.trim() || null };
    if (verified) update.identity_verified_at = new Date().toISOString();
    if (["completed", "denied", "cancelled"].includes(status))
      update.completed_at = new Date().toISOString();
    const { error } = await supabase
      .from("privacy_requests")
      .update(update)
      .eq("id", id)
      .eq("organization_id", profile.organization_id!);
    if (error) return { ok: false, error: message(he) };
    revalidatePath("/settings/privacy");
    return { ok: true };
  } catch {
    return { ok: false, error: message(he) };
  }
}

export async function createRetentionHold(
  _previous: PrivacyResult,
  formData: FormData,
): Promise<PrivacyResult> {
  const he = (await getLocale()) === "he";
  try {
    const profile = await guard(),
      reason = String(formData.get("reason") ?? "").trim();
    if (!reason) return { ok: false, error: message(he) };
    // `retention_holds.category` is CHECK-constrained; same gap.
    const category = String(formData.get("category") ?? "all");
    if (!isOneOf(["all", "location", "calls", "communications", "media", "audit"], category))
      return { ok: false, error: message(he) };
    const supabase = await createClient();
    const { error } = await supabase.from("retention_holds").insert({
      organization_id: profile.organization_id,
      customer_id: String(formData.get("customerId") ?? "") || null,
      category,
      reason,
      expires_at: String(formData.get("expiresAt") ?? "") || null,
      created_by: profile.id,
    });
    if (error) return { ok: false, error: message(he) };
    revalidatePath("/settings/privacy");
    return { ok: true };
  } catch {
    return { ok: false, error: message(he) };
  }
}

export async function releaseRetentionHold(id: string): Promise<PrivacyResult> {
  const he = (await getLocale()) === "he";
  try {
    const profile = await guard(),
      supabase = await createClient();
    const { error } = await supabase
      .from("retention_holds")
      .update({ released_at: new Date().toISOString(), released_by: profile.id })
      .eq("id", id)
      .eq("organization_id", profile.organization_id!);
    if (error) return { ok: false, error: message(he) };
    revalidatePath("/settings/privacy");
    return { ok: true };
  } catch {
    return { ok: false, error: message(he) };
  }
}

export async function previewRetention(enforce: boolean): Promise<PrivacyResult> {
  const he = (await getLocale()) === "he";
  try {
    const profile = await guard();
    const summary = await runDataRetentionForOrganization(
      profile.organization_id!,
      enforce,
      profile.id,
    );
    revalidatePath("/settings/privacy");
    return { ok: true, summary };
  } catch {
    return {
      ok: false,
      error: he ? "לא הצלחנו להריץ את בדיקת השמירה." : "We couldn't run the retention check.",
    };
  }
}

export async function anonymizeCustomerForRequest(
  requestId: string,
  confirmation: string,
): Promise<PrivacyResult> {
  const he = (await getLocale()) === "he";
  try {
    const profile = await guard(),
      supabase = await createClient();
    const { data: request } = await supabase
      .from("privacy_requests")
      .select("id,request_type,customer_id,identity_verified_at,status,customers(name)")
      .eq("id", requestId)
      .eq("organization_id", profile.organization_id!)
      .single();
    const customer: any = request?.customers;
    if (
      !request ||
      request.request_type !== "deletion" ||
      !request.customer_id ||
      !request.identity_verified_at ||
      String(customer?.name ?? "")
        .trim()
        .toLowerCase() !== confirmation.trim().toLowerCase()
    )
      return {
        ok: false,
        error: he
          ? "צריך לאמת זהות ולהקליד את שם הלקוח בדיוק כפי שמופיע."
          : "Verify identity and type the customer name exactly as shown.",
      };
    const { count } = await supabase
      .from("invoices")
      .select("id", { head: true, count: "exact" })
      .eq("customer_id", request.customer_id)
      .eq("status", "unpaid")
      .is("deleted_at", null);
    if ((count ?? 0) > 0) {
      await supabase
        .from("privacy_requests")
        .update({
          status: "blocked",
          completion_notes: he
            ? "המחיקה ממתינה עד להסדרת החשבוניות הפתוחות."
            : "Deletion is waiting for open invoices to be resolved.",
        })
        .eq("id", requestId);
      revalidatePath("/settings/privacy");
      return {
        ok: false,
        error: he
          ? "יש ללקוח חשבונית פתוחה. המידע הפיננסי חייב להישמר עד להסדרת היתרה."
          : "This customer has an open invoice. Financial records must be kept until the balance is resolved.",
      };
    }
    const suffix = request.customer_id.slice(0, 8);
    const { error } = await supabase
      .from("customers")
      .update({
        name: `${he ? "לקוח שנמחק" : "Deleted customer"} · ${suffix}`,
        phone: "—",
        email: null,
        address: null,
        city: null,
        source: null,
        notes: null,
        deleted_at: new Date().toISOString(),
        archived: true,
      })
      .eq("id", request.customer_id)
      .eq("organization_id", profile.organization_id!);
    if (error) return { ok: false, error: message(he) };
    await supabase
      .from("privacy_requests")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completion_notes: he
          ? "פרטי הזיהוי נמחקו. מסמכים כספיים נשמרו כנדרש."
          : "Identifying details were removed. Required financial records were retained.",
      })
      .eq("id", requestId);
    revalidatePath("/settings/privacy");
    return { ok: true };
  } catch {
    return { ok: false, error: message(he) };
  }
}
