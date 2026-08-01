/**
 * Technician availability and qualifications.
 *
 * These reads gate an assignment: time off decides whether somebody CAN be
 * booked, skills decide whether they MAY be. A truncated read here does not
 * show fewer rows on a screen — it silently removes a constraint, and the
 * dispatcher books a technician who is on holiday or uncertified. That is why
 * `assignment-guard.ts`, which is the server-side refusal, reads through the
 * same functions as the board that draws it.
 */

import type { ServerClient } from "@/lib/supabase/server";
import { readAll } from "./db";

/** Approved time off covering one date, for the whole org — the dispatch board. */
export function listApprovedTimeOffOn(supabase: ServerClient, date: string) {
  return readAll("technicians.listApprovedTimeOffOn", () =>
    supabase
      .from("technician_time_off")
      .select("id,profile_id,starts_on,ends_on,start_time,end_time,kind,status,note")
      .eq("status", "approved")
      .lte("starts_on", date)
      .gte("ends_on", date),
  );
}

/**
 * Approved time off covering one date for ONE technician, plus org-wide
 * closures (`profile_id is null`).
 *
 * The organisation filter is explicit rather than left to row-level security:
 * this is the guard a server action consults before writing an assignment, and
 * a guard should state its own scope.
 */
export function listApprovedTimeOffFor(
  supabase: ServerClient,
  organizationId: string,
  profileId: string,
  date: string,
) {
  return readAll("technicians.listApprovedTimeOffFor", () =>
    supabase
      .from("technician_time_off")
      .select("profile_id,starts_on,ends_on,start_time,end_time,status")
      .eq("organization_id", organizationId)
      .eq("status", "approved")
      .lte("starts_on", date)
      .gte("ends_on", date)
      .or(`profile_id.eq.${profileId},profile_id.is.null`),
  );
}

/** Every technician's skills — the dispatch board's qualification map. */
export function listSkills(supabase: ServerClient) {
  return readAll("technicians.listSkills", () =>
    supabase.from("technician_skills").select("profile_id,skill_code,label,issued_on,expires_on"),
  );
}

/** One technician's skills, for the server-side assignment check. */
export function listSkillsFor(supabase: ServerClient, organizationId: string, profileId: string) {
  return readAll("technicians.listSkillsFor", () =>
    supabase
      .from("technician_skills")
      .select("skill_code,label,issued_on,expires_on")
      .eq("organization_id", organizationId)
      .eq("profile_id", profileId),
  );
}

/** Who has consented to location tracking — the fleet screen. */
export function listLocationConsents(supabase: ServerClient) {
  return readAll("technicians.listLocationConsents", () =>
    supabase.from("technician_location_consents").select("profile_id,consented"),
  );
}
