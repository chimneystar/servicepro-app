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
  source: z.string().trim().max(60).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});
export type CustomerInput = z.infer<typeof customerSchema>;
