import { z } from "zod";

/**
 * Server-side input validation. Every write is checked against these.
 * Messages are i18n KEYS (see lib/i18n.ts) — the server action translates
 * them into the caller's language before returning.
 */
export const customerSchema = z.object({
  name: z.string().trim().min(1, "err.name_required").max(120),
  phone: z.string().trim().min(1, "err.phone_required").max(40),
  email: z.string().trim().email("err.email_invalid").max(160).optional().or(z.literal("")),
  address: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  billing_address: z.string().trim().max(200).optional().or(z.literal("")),
  billing_city: z.string().trim().max(80).optional().or(z.literal("")),
  source: z.string().trim().max(60).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});
export type CustomerInput = z.infer<typeof customerSchema>;

/**
 * `values.includes(candidate)`, as a type guard.
 *
 * Ninety-nine columns in this schema are `text` with
 * `check (col = any (array['a','b','c']))` — a Postgres enumeration written
 * the long way. `lib/supabase/database.types.ts` reads those constraints, so
 * writing a value outside the set is now a compile error instead of a
 * check-constraint violation discovered by a customer.
 *
 * Most of the affected call sites ALREADY test the value, with exactly this
 * expression, before writing it. They still failed to compile because
 * `Array<string>.includes()` returns a plain boolean: TypeScript learns
 * nothing from a passing check. This helper changes only what the compiler
 * knows — the runtime test, and therefore the behaviour on bad input, is
 * character for character the one that was already there.
 *
 * Deliberately takes `unknown`: the interesting inputs are `FormData.get()`
 * and `searchParams`, neither of which is a `string` until something checks.
 */
export function isOneOf<const T extends readonly (string | number)[]>(
  values: T,
  candidate: unknown,
): candidate is T[number] {
  return (values as readonly unknown[]).includes(candidate);
}
