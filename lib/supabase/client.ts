import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/**
 * Supabase client for Client Components (browser). Uses the public anon key.
 *
 * The `Database` generic is not decoration: it is what makes
 * `from("merchant_accounts")` — a table that has never existed, and which was
 * found in production code by the 2026-07-31 audit — a compile error rather
 * than a runtime 404 that nobody checked for. It is generated from the
 * migrations by `npm run db:types`; see lib/supabase/database.types.ts.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
