import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Enums, Tables } from "@/lib/supabase/database.types";

/**
 * The roles, taken from the `user_role` Postgres enum rather than retyped.
 *
 * The list used to be written out here as well as in db/001_schema.sql. Two
 * copies of an enumeration is one copy too many: adding a role in a migration
 * left this one silently short, and every `assertRole` call would have refused
 * the new role without a single compile error.
 */
export type Role = Enums<"user_role">;
export type CapabilityKey =
  | "customers.view"
  | "customers.edit"
  | "schedule.manage"
  | "jobs.edit"
  | "estimates.manage"
  | "invoices.manage"
  | "payments.manage"
  | "reports.view"
  | "purchasing.manage"
  | "automations.manage"
  | "settings.manage"
  | "team.manage";

/**
 * The logged-in user's profile, as every server action and page consumes it.
 *
 * Each field's type is the database's, with ONE deliberate narrowing:
 * `organization_id` is `string`, not `string | null`. In `profiles` the column
 * is nullable — a row exists between signup and onboarding — but
 * `requireProfile()` redirects when it is null and `redirect()` never returns,
 * so no caller can hold a Profile whose org is missing.
 *
 * That narrowing is the whole reason this file matters. Roughly a hundred
 * `insert({ organization_id: profile.organization_id, ... })` call sites write
 * into NOT NULL columns; with the nullable type they were a hundred latent
 * "null value in column violates not-null constraint" errors that only the
 * redirect prevented, and nothing recorded that the redirect was what
 * prevented them.
 */
export interface Profile {
  id: Tables<"profiles">["id"];
  organization_id: NonNullable<Tables<"profiles">["organization_id"]>;
  full_name: Tables<"profiles">["full_name"];
  role: Role;
  ui_theme?: Tables<"profiles">["ui_theme"];
  ui_contrast?: Tables<"profiles">["ui_contrast"];
  ui_text_scale?: Tables<"profiles">["ui_text_scale"];
  ui_reduce_motion?: Tables<"profiles">["ui_reduce_motion"];
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
    .select(
      "id, organization_id, full_name, role, ui_theme, ui_contrast, ui_text_scale, ui_reduce_motion",
    )
    .eq("id", user.id)
    .single();

  if (!profile || !profile.organization_id) redirect("/onboarding");
  // Rebuilt rather than cast. `profile.organization_id` is narrowed to string
  // by the line above, but narrowing a property does not narrow the object, so
  // `return profile` (or the `as Profile` this used to be) would quietly hand
  // back the nullable type it claims not to have.
  return { ...profile, organization_id: profile.organization_id };
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
    "customers.view",
    "customers.edit",
    "schedule.manage",
    "jobs.edit",
    "estimates.manage",
    "invoices.manage",
    "payments.manage",
    "reports.view",
    "purchasing.manage",
    "automations.manage",
    "settings.manage",
    "team.manage",
  ];
  if (profile.role === "owner") return new Set(all);
  const supabase = await createClient();
  const { data } = await supabase
    .from("profile_capabilities")
    .select(
      "can_view_customers, can_edit_customers, can_manage_schedule, can_edit_jobs, can_manage_estimates, can_manage_invoices, can_manage_payments, can_view_reports, can_manage_purchasing, can_manage_automations, can_manage_settings, can_manage_team",
    )
    .eq("profile_id", profile.id)
    .maybeSingle();
  const mapping: [CapabilityKey, string][] = [
    ["customers.view", "can_view_customers"],
    ["customers.edit", "can_edit_customers"],
    ["schedule.manage", "can_manage_schedule"],
    ["jobs.edit", "can_edit_jobs"],
    ["estimates.manage", "can_manage_estimates"],
    ["invoices.manage", "can_manage_invoices"],
    ["payments.manage", "can_manage_payments"],
    ["reports.view", "can_view_reports"],
    ["purchasing.manage", "can_manage_purchasing"],
    ["automations.manage", "can_manage_automations"],
    ["settings.manage", "can_manage_settings"],
    ["team.manage", "can_manage_team"],
  ];
  return new Set(
    mapping
      .filter(([, column]) => Boolean((data as Record<string, unknown> | null)?.[column]))
      .map(([key]) => key),
  );
}

export async function assertCapability(profile: Profile, capability: CapabilityKey) {
  const capabilities = await loadCapabilities(profile);
  if (!capabilities.has(capability)) throw new Error("forbidden");
}
