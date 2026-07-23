import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "office" | "tech";

export interface Profile {
  id: string;
  organization_id: string | null;
  full_name: string;
  role: Role;
}

/**
 * Loads the logged-in user's profile on the server.
 * - Not logged in  -> redirect to /login
 * - No organization -> redirect to /onboarding (first-run: create the business)
 */
export async function requireProfile(): Promise<Profile> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, organization_id, full_name, role")
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
