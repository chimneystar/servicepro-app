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
 * The SAME client, deliberately WITHOUT the `Database` generic.
 *
 * There is exactly one caller: `app/api/export/business/route.ts`, the
 * whole-business export, which walks all ~120 tables from a manifest. There the
 * table name is DATA, not a literal, and no type can help: `from()` needs a
 * literal to check anything, and instantiating the query builder over a union
 * of 120 tables makes `tsc` give up with "type instantiation is excessively
 * deep and possibly infinite" — after which it would have typed nothing anyway.
 *
 * So the honest thing is to say so in one place rather than scatter casts. Two
 * properties are unchanged and are what actually protect that route: it is the
 * anon/session client, so RLS still decides what it may read, and every query
 * carries an explicit `.eq(orgKey, organizationId)` on top. The manifest itself
 * is checked against db/*.sql by tests/business-export.test.mjs, which is what
 * catches a table name that does not exist — the job the type would have done.
 *
 * Do not use it anywhere else. `npm test` enforces that (tests/source-shape).
 */
export async function createUntypedClient() {
  const cookieStore = await cookies();
  return createServerClient(
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
            // Read-only cookies in a Server Component; the middleware refreshes.
          }
        },
      },
    },
  );
}

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
