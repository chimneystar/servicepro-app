import { createAdminClient } from "@/lib/supabase/admin";
// @ts-ignore -- shared JS module, proven both ways in tests/feature-flags.test.mjs
import { evaluateFlag, flagFallback, KNOWN_FLAGS } from "@/lib/core/feature-flags.mjs";

/**
 * Reading half of the feature-flag system (ledger 5.12).
 *
 * `feature_flags` has been written by the admin console since migration 022 and
 * read by nothing at all. This module is the only reader, and it exists because
 * the two things it gates — the automation executor and the outreach sender —
 * are the two things in this codebase that spend a business's money and text
 * its customers on a timer. Those are exactly what you want to be able to stop
 * from a console at 2am without waiting for a deploy.
 *
 * SERVICE ROLE ONLY, and not by accident: migration 022 revokes `feature_flags`
 * from both `anon` and `authenticated` and gives it a deny-all policy. There is
 * no way to consult a flag from a user-scoped client, so every consumer is
 * server-side and trusted. Do not import this into client code.
 */

export type FeatureFlagKey = keyof typeof KNOWN_FLAGS & string;

type FlagRow = {
  key: string;
  enabled: boolean;
  rollout_percent: number;
  organization_allowlist: string[] | null;
  organization_blocklist: string[] | null;
};

/**
 * Load one flag and return a decision function for it.
 *
 * On a database error the configured fallback is used and the failure is
 * LOGGED. Failing closed would be worse than the bug being fixed: a transient
 * PostgREST hiccup would silently suppress every scheduled message that night,
 * which is indistinguishable from the "stored but inert" defect this work
 * exists to remove. The flag is a kill switch operated deliberately, not a
 * health check.
 */
export async function featureFlagEvaluator(
  key: FeatureFlagKey,
): Promise<(organizationId: string) => boolean> {
  const fallback: boolean = flagFallback(key);
  let row: FlagRow | null = null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("feature_flags")
      .select("key, enabled, rollout_percent, organization_allowlist, organization_blocklist")
      .eq("key", key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    row = (data as FlagRow | null) ?? null;
    if (!row) {
      console.warn(`[feature-flags] no row for "${key}"; using fallback ${fallback}`);
    }
  } catch (e: unknown) {
    console.error(
      `[feature-flags] could not read "${key}": ${e instanceof Error ? e.message : String(e)}; using fallback ${fallback}`,
    );
    row = null;
  }
  return (organizationId: string) => evaluateFlag(row, organizationId, fallback);
}

/** One-shot convenience for a single organisation. */
export async function isFeatureEnabled(key: FeatureFlagKey, organizationId: string): Promise<boolean> {
  const evaluator = await featureFlagEvaluator(key);
  return evaluator(organizationId);
}
