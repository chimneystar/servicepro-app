"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
// @ts-ignore -- shared JS module, proven both ways in tests/calendar-feed.test.mjs
import {
  CALENDAR_TOKEN_TTL_DAYS,
  calendarTokenExpiry,
  canCreateFeed,
} from "@/lib/core/calendar.mjs";

export type ActionResult = { ok: boolean; error?: string };

/**
 * Mint a calendar feed URL (ledger 6c.7).
 *
 * The URL IS a credential, so it is created with the same bounds 023 §10
 * settled on for portal links: an explicit expiry (90 days, NOT NULL, enforced
 * at lookup), a revocation column, and a scope. `canCreateFeed` refuses an
 * organisation-wide feed to a technician; a database trigger refuses it again,
 * so a forged form post cannot do what this screen will not.
 */
export async function createCalendarFeed(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const profile = await requireProfile();
  const scope = String(formData.get("scope") ?? "mine");
  const label = String(formData.get("label") ?? "")
    .trim()
    .slice(0, 80);

  const permitted = canCreateFeed(profile.role, scope) as { ok: boolean; reason?: string };
  if (!permitted.ok) {
    return {
      ok: false,
      error:
        permitted.reason === "scope_not_permitted"
          ? "Only an owner or office member can subscribe to the whole schedule."
          : "That feed scope does not exist.",
    };
  }

  const supabase = await createClient();
  // A hard ceiling: an unbounded number of live feed URLs per person is an
  // unbounded number of things to leak.
  const { count } = await supabase
    .from("calendar_feed_tokens")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profile.id)
    .is("revoked_at", null);
  if ((count ?? 0) >= 5) {
    return {
      ok: false,
      error: "You already have 5 live calendar feeds. Revoke one before creating another.",
    };
  }

  const { error } = await supabase.from("calendar_feed_tokens").insert({
    organization_id: profile.organization_id,
    profile_id: profile.id,
    scope,
    label: label || (scope === "mine" ? "My schedule" : "Whole schedule"),
    expires_at: calendarTokenExpiry(new Date().toISOString(), CALENDAR_TOKEN_TTL_DAYS),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/reports/calendar");
  return { ok: true };
}

/**
 * Revoke a feed. Immediate: `calendarFeedAccess` checks `revoked_at` BEFORE
 * expiry and nothing is cached, so the next fetch — within the hour — is 404.
 */
export async function revokeCalendarFeed(id: string): Promise<ActionResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase
    .from("calendar_feed_tokens")
    .update({ revoked_at: new Date().toISOString(), revoked_by: profile.id })
    .eq("id", id)
    .eq("profile_id", profile.id)
    .is("revoked_at", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/reports/calendar");
  return { ok: true };
}

/**
 * Rotate: revoke the old URL and mint a new one with a fresh 90 days.
 *
 * The old URL stops working the moment this returns — which is the point. A
 * "renew" that extended the existing token would leave a leaked URL live for
 * another quarter.
 */
export async function rotateCalendarFeed(id: string): Promise<ActionResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("calendar_feed_tokens")
    .select("id, scope, label")
    .eq("id", id)
    .eq("profile_id", profile.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (!existing) return { ok: false, error: "That feed no longer exists." };

  const revoked = await revokeCalendarFeed(id);
  if (!revoked.ok) return revoked;

  const { error } = await supabase.from("calendar_feed_tokens").insert({
    organization_id: profile.organization_id,
    profile_id: profile.id,
    scope: existing.scope,
    label: existing.label,
    expires_at: calendarTokenExpiry(new Date().toISOString(), CALENDAR_TOKEN_TTL_DAYS),
  });
  if (error)
    return {
      ok: false,
      error: `The old link was revoked but the new one could not be created: ${error.message}`,
    };

  revalidatePath("/reports/calendar");
  return { ok: true };
}
