"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
// @ts-ignore - shared pure JavaScript is also exercised directly by Node tests.
import { callNeedsFollowUp, normalizeUsPhone, phoneSearchSuffix } from "@/lib/core/calls.mjs";

export type ServiceRecordResult = { ok: boolean; error?: string; href?: string };

const value = (data: FormData, key: string, max = 4000) =>
  String(data.get(key) ?? "")
    .trim()
    .slice(0, max);
const invalid = (he: boolean) =>
  he ? "חסר מידע או שאחד הפרטים לא תקין." : "Some information is missing or invalid.";
const saveFailed = (he: boolean) =>
  he
    ? "לא הצלחנו לשמור את השינוי. נסו שוב בעוד רגע."
    : "We couldn't save that change. Please try again.";
const forbidden = (he: boolean) =>
  he ? "אין לכם הרשאה לבצע את הפעולה הזאת." : "You don't have permission to do that.";

async function officeContext() {
  const profile = await requireProfile();
  assertRole(profile, ["owner", "office"]);
  return { profile, supabase: await createClient() };
}

export async function addJobAction(jobId: string, data: FormData): Promise<ServiceRecordResult> {
  const locale = await getLocale();
  const he = locale === "he";
  const profile = await requireProfile();
  const supabase = await createClient();
  const actionType = value(data, "actionType", 20) === "follow_up" ? "follow_up" : "note";
  if (profile.role === "tech" && actionType !== "note") return { ok: false, error: forbidden(he) };
  const title = value(data, "title", 180);
  if (!title) return { ok: false, error: invalid(he) };
  const dueValue = value(data, "dueAt", 40);
  const dueAt =
    dueValue && !Number.isNaN(new Date(dueValue).getTime())
      ? new Date(dueValue).toISOString()
      : null;
  const assignedTo = profile.role === "tech" ? profile.id : value(data, "assignedTo", 80) || null;
  const { error } = await supabase.from("job_actions").insert({
    organization_id: profile.organization_id,
    job_id: jobId,
    action_type: actionType,
    title,
    body: value(data, "body") || null,
    due_at: actionType === "follow_up" ? dueAt : null,
    assigned_to: actionType === "follow_up" ? assignedTo : null,
    created_by: profile.id,
  });
  if (error) return { ok: false, error: saveFailed(he) };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

export async function completeJobAction(
  actionId: string,
  jobId: string,
): Promise<ServiceRecordResult> {
  const locale = await getLocale();
  const he = locale === "he";
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data: action } = await supabase
    .from("job_actions")
    .select("id,organization_id,job_id,assigned_to,status")
    .eq("id", actionId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (!action || action.organization_id !== profile.organization_id)
    return { ok: false, error: invalid(he) };
  const patch = {
    status: "done",
    completed_by: profile.id,
    completed_at: new Date().toISOString(),
  };
  if (profile.role === "tech") {
    if (action.assigned_to !== profile.id) return { ok: false, error: forbidden(he) };
    try {
      const admin = createAdminClient();
      const { error } = await admin
        .from("job_actions")
        .update(patch)
        .eq("id", actionId)
        .eq("organization_id", profile.organization_id!);
      if (error) return { ok: false, error: saveFailed(he) };
    } catch {
      return { ok: false, error: saveFailed(he) };
    }
  } else {
    const { error } = await supabase.from("job_actions").update(patch).eq("id", actionId);
    if (error) return { ok: false, error: saveFailed(he) };
  }
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

export async function saveJobWarranty(jobId: string, data: FormData): Promise<ServiceRecordResult> {
  const locale = await getLocale();
  const he = locale === "he";
  let context;
  try {
    context = await officeContext();
  } catch {
    return { ok: false, error: forbidden(he) };
  }
  const { profile, supabase } = context;
  const startsOn = value(data, "startsOn", 10);
  const expiresOn = value(data, "expiresOn", 10) || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || (expiresOn && expiresOn < startsOn))
    return { ok: false, error: invalid(he) };
  const coverageType = ["workmanship", "manufacturer", "custom"].includes(
    value(data, "coverageType", 30),
  )
    ? value(data, "coverageType", 30)
    : "workmanship";
  const { error } = await supabase.from("job_warranties").upsert(
    {
      organization_id: profile.organization_id,
      job_id: jobId,
      coverage_type: coverageType,
      starts_on: startsOn,
      expires_on: expiresOn,
      terms: value(data, "terms") || null,
      status: "active",
      created_by: profile.id,
    },
    { onConflict: "job_id" },
  );
  if (error) return { ok: false, error: saveFailed(he) };
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/warranties");
  return { ok: true };
}

export async function reportWarrantyCallback(
  jobId: string,
  data: FormData,
): Promise<ServiceRecordResult> {
  const locale = await getLocale();
  const he = locale === "he";
  let context;
  try {
    context = await officeContext();
  } catch {
    return { ok: false, error: forbidden(he) };
  }
  const { profile, supabase } = context;
  const issue = value(data, "issue");
  if (!issue) return { ok: false, error: invalid(he) };
  const { data: job } = await supabase
    .from("jobs")
    .select("id,customer_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { ok: false, error: invalid(he) };
  const { data: warranty } = await supabase
    .from("job_warranties")
    .select("id")
    .eq("job_id", jobId)
    .maybeSingle();
  const priority = ["low", "normal", "urgent"].includes(value(data, "priority", 20))
    ? value(data, "priority", 20)
    : "normal";
  const responsibility = ["review", "covered", "customer", "manufacturer", "third_party"].includes(
    value(data, "responsibility", 30),
  )
    ? value(data, "responsibility", 30)
    : "review";
  const { error } = await supabase.from("warranty_callbacks").insert({
    organization_id: profile.organization_id,
    warranty_id: warranty?.id ?? null,
    original_job_id: jobId,
    customer_id: job.customer_id,
    issue,
    priority,
    responsibility,
    created_by: profile.id,
  });
  if (error) return { ok: false, error: saveFailed(he) };
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/warranties");
  return { ok: true };
}

export async function scheduleWarrantyCallback(
  callbackId: string,
  originalJobId: string,
  data: FormData,
): Promise<ServiceRecordResult> {
  const locale = await getLocale();
  const he = locale === "he";
  let context;
  try {
    context = await officeContext();
  } catch {
    return { ok: false, error: forbidden(he) };
  }
  const { supabase } = context;
  const date = value(data, "date", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: invalid(he) };
  const { data: jobId, error } = await supabase.rpc("schedule_warranty_callback", {
    p_callback_id: callbackId,
    p_date: date,
    p_start: value(data, "start", 8) || null,
    p_end: value(data, "end", 8) || null,
    p_assigned_to: value(data, "assignedTo", 80) || null,
  });
  if (error || !jobId)
    return {
      ok: false,
      error:
        error?.code === "23P01"
          ? he
            ? "הטכנאי כבר משובץ בשעה הזאת."
            : "That technician is already booked at that time."
          : saveFailed(he),
    };
  revalidatePath(`/jobs/${originalJobId}`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/warranties");
  revalidatePath("/schedule");
  return { ok: true, href: `/jobs/${jobId}` };
}

export async function resolveWarrantyCallback(
  callbackId: string,
  originalJobId: string,
  data: FormData,
): Promise<ServiceRecordResult> {
  const locale = await getLocale();
  const he = locale === "he";
  let context;
  try {
    context = await officeContext();
  } catch {
    return { ok: false, error: forbidden(he) };
  }
  const { profile, supabase } = context;
  const resolution = value(data, "resolution");
  if (!resolution) return { ok: false, error: invalid(he) };
  const cost = Number(data.get("cost") ?? 0);
  if (!Number.isFinite(cost) || cost < 0) return { ok: false, error: invalid(he) };
  const { error } = await supabase
    .from("warranty_callbacks")
    .update({
      status: value(data, "decision", 20) === "denied" ? "denied" : "resolved",
      resolution,
      internal_cost_minor: Math.round(cost * 100),
      resolved_by: profile.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", callbackId);
  if (error) return { ok: false, error: saveFailed(he) };
  revalidatePath(`/jobs/${originalJobId}`);
  revalidatePath("/warranties");
  return { ok: true };
}

export async function logCall(data: FormData): Promise<ServiceRecordResult> {
  const locale = await getLocale();
  const he = locale === "he";
  let context;
  try {
    context = await officeContext();
  } catch {
    return { ok: false, error: forbidden(he) };
  }
  const { profile, supabase } = context;
  const direction = value(data, "direction", 20) === "inbound" ? "inbound" : "outbound";
  const fromNumber = normalizeUsPhone(value(data, "fromNumber", 40));
  const toNumber = normalizeUsPhone(value(data, "toNumber", 40));
  if (!fromNumber || !toNumber)
    return {
      ok: false,
      error: he
        ? "צריך להזין מספר טלפון אמריקאי תקין."
        : "Enter a valid United States phone number.",
    };
  const statusInput = value(data, "status", 30);
  const status = ["completed", "missed", "failed", "voicemail"].includes(statusInput)
    ? statusInput
    : "completed";
  const duration = Math.max(0, Math.round(Number(data.get("durationSeconds") ?? 0)));
  if (!Number.isFinite(duration)) return { ok: false, error: invalid(he) };
  let customerId = value(data, "customerId", 80) || null;
  let jobId = value(data, "jobId", 80) || null;
  if (jobId) {
    const { data: job } = await supabase
      .from("jobs")
      .select("id,customer_id")
      .eq("id", jobId)
      .maybeSingle();
    if (!job) return { ok: false, error: invalid(he) };
    customerId = job.customer_id;
  }
  if (!customerId) {
    // Narrow in SQL, confirm in JavaScript. This used to select up to 1000
    // customers and scan them here, which stopped being correct the moment a
    // business had more than 1000 customers: the right row could simply be
    // outside the page the query returned, and the call was filed against
    // nobody. See lib/core/calls.mjs#phoneSearchSuffix.
    const caller = direction === "inbound" ? fromNumber : toNumber;
    const suffix = phoneSearchSuffix(caller);
    if (suffix) {
      const { data: candidates } = await supabase
        .from("customers")
        .select("id,phone")
        .is("deleted_at", null)
        .ilike("phone", `%${suffix}`)
        .limit(50);
      customerId =
        (candidates ?? []).find((row) => normalizeUsPhone(row.phone) === caller)?.id ?? null;
    }
  }
  const outcome = value(data, "outcome", 80);
  const { error } = await supabase.from("call_events").insert({
    organization_id: profile.organization_id,
    provider: "manual",
    direction,
    status,
    from_number: fromNumber,
    to_number: toNumber,
    customer_id: customerId,
    job_id: jobId,
    handled_by: profile.id,
    reason: value(data, "reason", 180) || null,
    outcome: outcome || null,
    notes: value(data, "notes") || null,
    duration_seconds: duration,
    needs_follow_up: data.get("needsFollowUp") === "on" || callNeedsFollowUp(status, outcome),
    answered_at: status === "completed" ? new Date().toISOString() : null,
    ended_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: saveFailed(he) };
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/calls");
  return { ok: true };
}

export async function saveTrackedNumber(data: FormData): Promise<ServiceRecordResult> {
  const locale = await getLocale();
  const he = locale === "he";
  let context;
  try {
    context = await officeContext();
  } catch {
    return { ok: false, error: forbidden(he) };
  }
  const { profile, supabase } = context;
  const phoneNumber = normalizeUsPhone(value(data, "phoneNumber", 40));
  const destinationNumber = normalizeUsPhone(value(data, "destinationNumber", 40));
  const label = value(data, "label", 120);
  if (!phoneNumber || !destinationNumber || !label) return { ok: false, error: invalid(he) };
  const { error } = await supabase.from("tracked_phone_numbers").upsert(
    {
      organization_id: profile.organization_id,
      provider: "twilio",
      phone_number: phoneNumber,
      label,
      lead_source: value(data, "leadSource", 120) || null,
      campaign: value(data, "campaign", 120) || null,
      destination_number: destinationNumber,
      recording_enabled: data.get("recordingEnabled") === "on",
      recording_notice_enabled: true,
      active: true,
      created_by: profile.id,
    },
    { onConflict: "organization_id,phone_number" },
  );
  if (error) return { ok: false, error: saveFailed(he) };
  revalidatePath("/calls");
  return { ok: true };
}

export async function markCallFollowedUp(callId: string): Promise<ServiceRecordResult> {
  const locale = await getLocale();
  const he = locale === "he";
  let context;
  try {
    context = await officeContext();
  } catch {
    return { ok: false, error: forbidden(he) };
  }
  const { supabase } = context;
  const { error } = await supabase
    .from("call_events")
    .update({ needs_follow_up: false })
    .eq("id", callId);
  if (error) return { ok: false, error: saveFailed(he) };
  revalidatePath("/calls");
  return { ok: true };
}
