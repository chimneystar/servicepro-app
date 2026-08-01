import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * The typed client, for the many helpers that take one as a parameter.
 *
 * They were all declared `supabase: any`, which quietly undid the typing for
 * every query made through them — and those are the shared paths
 * (`lib/documents.ts`, `lib/payments/*`), so it was the money code that stayed
 * untyped. Derived from `createClient` rather than written out, so it cannot
 * drift from what callers actually pass.
 */
export type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Supabase client for Server Components / Server Actions / Route Handlers.
 * Uses the anon key. All access is still constrained by Row-Level Security
 * to the currently logged-in user's organization.
 *
 * The `Database` generic is generated from the migrations (`npm run db:types`),
 * so a column that a migration renamed stops compiling here instead of
 * returning `undefined` on a screen.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component (read-only cookies). The
            // middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}
