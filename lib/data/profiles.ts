/**
 * Staff profiles.
 *
 * NOTE ON THE EMBED HINTS. `profiles` is one of the relations migration 014
 * gave a second, composite foreign key, so `jobs(profiles(...))` needs an
 * explicit `!jobs_assigned_to_fkey`. Any query added here that embeds profiles
 * must carry the hint or PostgREST answers 300/PGRST201 —
 * `tests/postgrest-embeds.test.mjs` fails the build if it does not, and it
 * scans this directory like any other.
 */

import type { ServerClient } from "@/lib/supabase/server";
import { readAll, readAtMost, readOne } from "./db";

/** Active staff, alphabetical — the assignee picker on several screens. */
export function listActive(supabase: ServerClient) {
  return readAll("profiles.listActive", () =>
    supabase.from("profiles").select("id, full_name").eq("active", true).order("full_name"),
  );
}

/** Everyone who can be shown on the dispatch board, with their role. */
export function listAssignable(supabase: ServerClient) {
  return readAll("profiles.listAssignable", () =>
    supabase
      .from("profiles")
      .select("id,full_name,role")
      .in("role", ["tech", "office", "owner"])
      .order("full_name"),
  );
}

/** Everyone in one organisation, for admin and audit screens. */
export function listInOrganization(supabase: ServerClient, organizationId: string) {
  return readAll("profiles.listInOrganization", () =>
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("organization_id", organizationId)
      .order("full_name"),
  );
}

/** Names for a set of ids — for turning an actor column into something readable. */
export function listNamesByIds(supabase: ServerClient, ids: string[]) {
  if (!ids.length) return Promise.resolve([]);
  return readAll("profiles.listNamesByIds", () =>
    supabase.from("profiles").select("id, full_name").in("id", ids),
  );
}

/**
 * Which of `ids` are members of this organisation.
 *
 * Used to validate a recipient list before writing it. The org filter is
 * explicit and not left to RLS alone: this runs on a write path, where being
 * wrong means sending a report to somebody else's staff.
 */
export function listMembersAmong(supabase: ServerClient, organizationId: string, ids: string[]) {
  if (!ids.length) return Promise.resolve([]);
  return readAll("profiles.listMembersAmong", () =>
    supabase.from("profiles").select("id").eq("organization_id", organizationId).in("id", ids),
  );
}

/** One profile, or null — null means "no such profile" OR "not visible to you". */
export function findById(supabase: ServerClient, id: string) {
  return readOne(
    "profiles.findById",
    supabase.from("profiles").select("id, full_name, role, active").eq("id", id).maybeSingle(),
  );
}

/** Capabilities explicitly granted to one member. */
export function listCapabilities(supabase: ServerClient, profileId: string, limit: number) {
  return readAtMost(
    "profiles.listCapabilities",
    () => supabase.from("profile_capabilities").select("capability").eq("profile_id", profileId),
    limit,
  );
}
