"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveTimeZone } from "@/lib/booking";

const text = (data: FormData, key: string, max = 500) =>
  String(data.get(key) ?? "")
    .trim()
    .slice(0, max);
const number = (data: FormData, key: string, fallback: number) => {
  const value = Number(data.get(key));
  return Number.isFinite(value) ? value : fallback;
};

export async function saveBookingSettings(data: FormData) {
  const profile = await requireProfile();
  assertRole(profile, ["owner"]);
  const organizationId = profile.organization_id!;
  const supabase = await createClient();
  const weekdayOpen = text(data, "weekdayOpen", 5) || "08:00",
    weekdayClose = text(data, "weekdayClose", 5) || "17:00",
    saturdayOpen = text(data, "saturdayOpen", 5) || "09:00",
    saturdayClose = text(data, "saturdayClose", 5) || "14:00";
  const hours: Record<string, [string, string] | null> = {
    "1": [weekdayOpen, weekdayClose],
    "2": [weekdayOpen, weekdayClose],
    "3": [weekdayOpen, weekdayClose],
    "4": [weekdayOpen, weekdayClose],
    "5": [weekdayOpen, weekdayClose],
    "6": data.get("saturday") === "on" ? [saturdayOpen, saturdayClose] : null,
    "7": null,
  };
  // resolveTimeZone falls back to the default on an unknown IANA name, so a
  // tampered form cannot write a zone the slot engine would then choke on. The
  // DB trigger from migration 029 is the second line of defence.
  const timezone = resolveTimeZone(text(data, "timezone", 64));
  const settings = {
    organization_id: organizationId,
    timezone,
    enabled: data.get("enabled") === "on",
    approval_required: data.get("approvalRequired") === "on",
    enforce_service_area: data.get("enforceServiceArea") === "on",
    use_team_capacity: data.get("useTeamCapacity") === "on",
    min_notice_hours: Math.max(0, Math.min(720, number(data, "minNoticeHours", 4))),
    max_days_ahead: Math.max(1, Math.min(365, number(data, "maxDaysAhead", 60))),
    slot_interval_min: number(data, "slotIntervalMin", 60),
    arrival_window_min: number(data, "arrivalWindowMin", 120),
    hours_json: hours,
    payment_mode: text(data, "paymentMode", 20) || "none",
    deposit_value: Math.max(0, Math.round(number(data, "depositValue", 0))),
    success_message_en: text(data, "successMessageEn", 1000) || null,
    success_message_he: text(data, "successMessageHe", 1000) || null,
    urgent_message_en: text(data, "urgentMessageEn", 1000) || null,
    urgent_message_he: text(data, "urgentMessageHe", 1000) || null,
  };
  const { error } = await supabase.from("booking_settings").upsert(settings);
  if (error) return { ok: false, error: error.message };
  const jobTypeIds = data.getAll("jobTypeId").map(String);
  for (const id of jobTypeIds) {
    const key = id.replaceAll("-", "");
    const price = Math.max(0, Math.round(number(data, `price_${key}`, 0) * 100));
    const row = {
      organization_id: organizationId,
      job_type_id: id,
      name_en: text(data, `nameEn_${key}`, 180),
      name_he: text(data, `nameHe_${key}`, 180) || null,
      description_en: text(data, `descriptionEn_${key}`, 700) || null,
      description_he: text(data, `descriptionHe_${key}`, 700) || null,
      duration_min: Math.max(15, Math.min(1440, number(data, `duration_${key}`, 60))),
      price_minor: price,
      book_as: text(data, `bookAs_${key}`, 20) === "estimate" ? "estimate" : "job",
      active: data.get(`enabled_${key}`) === "on",
    };
    await supabase
      .from("booking_services")
      .upsert(row, { onConflict: "organization_id,job_type_id" });
  }
  revalidatePath("/settings/booking");
  revalidatePath(`/book/${organizationId}`);
  return { ok: true };
}

/**
 * Pull real Hebrew service names out of the bilingual trade catalogue
 * (`industry_pack_services`, migration 041) for every booking service that has
 * none — the A5 repair, exposed so it can be run whenever it is needed rather
 * than once at migration time.
 *
 * The rule lives in `repair_booking_service_names()`, not here, because the
 * database is also where the sync trigger applies it: a Hebrew name that is
 * null or identical to the English one is a mis-seed and is replaced; a Hebrew
 * name a human typed is never touched. The function is SECURITY DEFINER and
 * re-checks org and owner role itself, so the threat model is PostgREST, not
 * this screen.
 */
export async function repairServiceNames() {
  const profile = await requireProfile();
  assertRole(profile, ["owner"]);
  const organizationId = profile.organization_id!;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("repair_booking_service_names", {
    p_org: organizationId,
  });
  if (error) return { ok: false as const, error: error.message, fixed: 0 };
  revalidatePath("/settings/booking");
  revalidatePath(`/book/${organizationId}`);
  return { ok: true as const, error: null, fixed: Number(data ?? 0) };
}

export async function addBookingQuestion(data: FormData) {
  const profile = await requireProfile();
  assertRole(profile, ["owner"]);
  const organizationId = profile.organization_id!;
  const supabase = await createClient();
  const labelEn = text(data, "labelEn", 180);
  if (!labelEn) return { ok: false, error: "English question text is required" };
  const fieldType = ["text", "textarea", "choice", "checkbox"].includes(text(data, "fieldType", 20))
    ? text(data, "fieldType", 20)
    : "text";
  const options = text(data, "options", 1000)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 30);
  const { data: last } = await supabase
    .from("booking_questions")
    .select("sort")
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("booking_questions").insert({
    organization_id: organizationId,
    label_en: labelEn,
    label_he: text(data, "labelHe", 180) || null,
    field_type: fieldType,
    options_json: fieldType === "choice" ? options : [],
    required: data.get("required") === "on",
    sort: (last?.sort ?? -1) + 1,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/booking");
  revalidatePath(`/book/${organizationId}`);
  return { ok: true };
}

export async function deleteBookingQuestion(data: FormData) {
  const profile = await requireProfile();
  assertRole(profile, ["owner"]);
  const organizationId = profile.organization_id!;
  const supabase = await createClient();
  const id = text(data, "id", 80);
  const { error } = await supabase
    .from("booking_questions")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/booking");
  revalidatePath(`/book/${organizationId}`);
  return { ok: true };
}
