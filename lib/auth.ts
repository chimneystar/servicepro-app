import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "office" | "tech";
export type CapabilityKey =
  | "customers.view" | "customers.edit" | "schedule.manage" | "jobs.edit"
  | "estimates.manage" | "invoices.manage" | "payments.manage" | "reports.view"
  | "purchasing.manage" | "automations.manage" | "settings.manage" | "team.manage";

export interface Profile {
  id: string;
  organization_id: string | null;
  full_name: string;
  role: Role;
  ui_theme?: "light" | "dark" | "system";
  ui_contrast?: "normal" | "high";
  ui_text_scale?: "normal" | "large";
  ui_reduce_motion?: boolean;
}

/**
 * Loads the logged-in user's profile on the server.
 * - Not logged in  -> redirect to /login
 * - No organization -> redirect to /onboarding (first-run: create the business)
 */
export async function requireProfile(): Promise<Profile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, organization_id, full_name, role, ui_theme, ui_contrast, ui_text_scale, ui_reduce_motion")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.organization_id) redirect("/onboarding");
  return profile as Profile;
}

/** Throws if the current user's role is not in the allowed list. */
export function assertRole(profile: Profile, allowed: Role[]) {
  if (!allowed.includes(profile.role)) {
    throw new Error("forbidden");
  }
}

/** Load the current member's explicit access for navigation and server guards. Owners always have all access. */
export async function loadCapabilities(profile: Profile): Promise<Set<CapabilityKey>> {
  const all: CapabilityKey[] = [
    "customers.view", "customers.edit", "schedule.manage", "jobs.edit", "estimates.manage", "invoices.manage",
    "payments.manage", "reports.view", "purchasing.manage", "automations.manage", "settings.manage", "team.manage",
  ];
  if (profile.role === "owner") return new Set(all);
  const supabase = await createClient();
  const { data } = await supabase.from("profile_capabilities").select(
    "can_view_customers, can_edit_customers, can_manage_schedule, can_edit_jobs, can_manage_estimates, can_manage_invoices, can_manage_payments, can_view_reports, can_manage_purchasing, can_manage_automations, can_manage_settings, can_manage_team",
  ).eq("profile_id", profile.id).maybeSingle();
  const mapping: [CapabilityKey, string][] = [
    ["customers.view", "can_view_customers"], ["customers.edit", "can_edit_customers"], ["schedule.manage", "can_manage_schedule"],
    ["jobs.edit", "can_edit_jobs"], ["estimates.manage", "can_manage_estimates"], ["invoices.manage", "can_manage_invoices"],
    ["payments.manage", "can_manage_payments"], ["reports.view", "can_view_reports"], ["purchasing.manage", "can_manage_purchasing"],
    ["automations.manage", "can_manage_automations"], ["settings.manage", "can_manage_settings"], ["team.manage", "can_manage_team"],
  ];
  return new Set(mapping.filter(([, column]) => Boolean((data as Record<string, unknown> | null)?.[column])).map(([key]) => key));
}

export async function assertCapability(profile: Profile, capability: CapabilityKey) {
  const capabilities = await loadCapabilities(profile);
  if (!capabilities.has(capability)) throw new Error("forbidden");
}
