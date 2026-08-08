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

/**
 * A `jsonb` column read as an object, or null when it is not one.
 *
 * A jsonb column can hold a string, a number, a list or null as legitimately as
 * it can hold an object, so the generated types spell it `Json`. Several
 * screens hand one straight to a component that declares
 * `Record<string, number>` and index into it — `migration_batches.counts_json`,
 * `booking_settings.hours_json`, `retention_runs.summary`,
 * `release_records.regression_checklist`,
 * `permission_change_log.changes`. Nothing on any of those paths validates the
 * shape; the declaration was simply asserted.
 *
 * This does not invent a value or coerce one. Every row those screens read is
 * written as an object by this codebase, so for real data it returns exactly
 * what was passed; it only decides what happens to a row that is NOT an object,
 * which previously reached the component and was indexed as if it were.
 *
 * The element type is the caller's claim about the values, and is still a
 * claim — this checks the container, not what is inside it.
 */
export function asJsonRecord<T>(value: unknown): Record<string, T> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, T>)
    : null;
}
