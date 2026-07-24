import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client for trusted server-only contexts (e.g. Stripe webhooks)
 * where there is no logged-in user. NEVER import this into client code.
 * Requires SUPABASE_SERVICE_ROLE_KEY to be set.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("service role not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
