import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Service-role client for trusted server-only contexts (e.g. Stripe webhooks)
 * where there is no logged-in user. NEVER import this into client code.
 * Requires SUPABASE_SERVICE_ROLE_KEY to be set.
 *
 * Typed against the generated `Database` exactly like the anon clients. The
 * service role bypasses RLS, so this is the client where a typo in a table
 * name is most dangerous and least likely to be caught by a policy refusing
 * the query.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("service role not configured");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
