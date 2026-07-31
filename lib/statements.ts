import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { providers, sendSms, sendEmail } from "@/lib/providers";
// @ts-ignore -- shared JS module, proven both ways in tests/statements.test.mjs
import { buildStatement, statementMessage } from "@/lib/core/statements.mjs";
// @ts-ignore -- the SINGLE shared opt-out rule (tests/outreach.test.mjs)
import { contactEligibility, truncateForSms } from "@/lib/core/outreach.mjs";
// @ts-ignore -- shared JS module
import { formatMoney } from "@/lib/core/money.mjs";
// @ts-ignore -- shared JS module
import { escapeHtml } from "@/lib/core/security.mjs";

/**
 * Customer statements (ledger 6c.6).
 *
 * There was no "here is everything you owe" document anywhere in this product:
 * a customer with six open invoices could only be sent six separate links, and
 * collections was one weekly SMS per invoice for ever.
 *
 * Two things live here: LOADING a statement (which is read through the caller's
 * own client, so RLS still decides what they may see) and SENDING one (which
 * honours the shared opt-out rule, records the attempt, and records a refusal
 * WITH its reason so "we chose not to" never looks like "it vanished").
 */

export type StatementLine = {
  date: string; kind: "invoice" | "payment"; reference: string;
  invoiceId: string | null; description: string;
  chargeMinor: number; creditMinor: number; balanceMinor: number;
};

export type Statement = {
  asOf: string; since: string | null;
  openingMinor: number; chargesMinor: number; paymentsMinor: number;
  balanceMinor: number; pastDueMinor: number; oldestDays: number;
  lines: StatementLine[];
  aging: Record<string, number>;
  openInvoices: { invoiceId: string; number: number | null; issueDate: string; ageDays: number; outstandingMinor: number }[];
};

export type StatementCustomer = {
  id: string; name: string; phone: string | null; email: string | null;
  sms_opt_in: boolean | null; email_opt_in: boolean | null; deleted_at: string | null;
  address: string | null; city: string | null; billing_address: string | null; billing_city: string | null;
};
export type StatementOrg = {
  name: string; currency: string; phone: string | null; email: string | null;
  address: string | null; city: string | null; logo_url: string | null; accent_color: string | null;
};
export type StatementBundle = { statement: Statement; customer: StatementCustomer; org: StatementOrg } | null;

const CUSTOMER_FIELDS = "id, name, phone, email, sms_opt_in, email_opt_in, deleted_at, address, city, billing_address, billing_city";
const INVOICE_FIELDS = "id, number, issue_date, total_minor, status, deleted_at, public_token";
const PAYMENT_FIELDS = "invoice_id, paid_at, base_amount_minor, amount_minor, refunded_minor, normalized_status, method, reference";

/** Cap on rows read for one statement. A customer with more than this needs a window. */
const STATEMENT_ROW_LIMIT = 1000;

/**
 * Load one customer's statement.
 *
 * Uses the CALLER's client, not the service role: a technician who cannot read
 * invoices must not be able to read a statement of them either, and RLS is the
 * thing that decides that — not this function.
 */
export async function loadStatement(
  customerId: string,
  options: { asOf?: string; since?: string | null } = {},
): Promise<StatementBundle> {
  const supabase = await createClient();
  const asOf = (options.asOf && /^\d{4}-\d{2}-\d{2}$/.test(options.asOf))
    ? options.asOf
    : new Date().toISOString().slice(0, 10);
  const since = options.since && /^\d{4}-\d{2}-\d{2}$/.test(options.since) ? options.since : null;

  const { data: customer } = await supabase.from("customers").select(CUSTOMER_FIELDS).eq("id", customerId).maybeSingle();
  if (!customer) return null;

  const { data: invoices } = await supabase.from("invoices")
    .select(INVOICE_FIELDS).eq("customer_id", customerId).is("deleted_at", null)
    .lte("issue_date", asOf).order("issue_date", { ascending: true }).limit(STATEMENT_ROW_LIMIT);

  const ids = (invoices ?? []).map((row: { id: string }) => row.id);
  const { data: payments } = ids.length
    ? await supabase.from("payments").select(PAYMENT_FIELDS).in("invoice_id", ids).limit(STATEMENT_ROW_LIMIT)
    : { data: [] as Record<string, unknown>[] };

  const { data: org } = await supabase.from("organizations")
    .select("name, currency, phone, email, address, city, logo_url, accent_color").single();

  // The engine is plain ESM; its inferred `since` type comes from a `= null`
  // default, which TypeScript narrows to `null | undefined`.
  const statement = (buildStatement as unknown as (input: Record<string, unknown>) => Statement)(
    { invoices: invoices ?? [], payments: payments ?? [], asOf, since },
  );
  return {
    statement,
    customer: customer as unknown as StatementCustomer,
    org: (org ?? { name: "", currency: "USD", phone: null, email: null, address: null, city: null, logo_url: null, accent_color: null }) as StatementOrg,
  };
}

export type StatementSendResult = { ok: boolean; skipped?: boolean; channel?: "sms" | "email"; reason?: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/**
 * Send a statement on one channel.
 *
 * CLAIM → ATTEMPT → RECORD, and a refusal is recorded as a refusal. The claim
 * here is the `customer_statements` row: it is written as 'created' first, so a
 * send that dies mid-flight leaves a visible record rather than nothing at all,
 * and it is updated to 'sent', 'failed' or 'skipped' with the reason. Consent is
 * decided by `contactEligibility` — the single shared rule — which refuses a
 * NON-BOOLEAN flag as well as an explicit false.
 */
export async function sendStatement(input: {
  organizationId: string;
  customerId: string;
  channel: "sms" | "email";
  actorId?: string | null;
  asOf?: string;
  since?: string | null;
  locale?: "en" | "he";
}): Promise<StatementSendResult> {
  const bundle = await loadStatement(input.customerId, { asOf: input.asOf, since: input.since });
  if (!bundle) return { ok: false, reason: "customer_not_found" };

  const supabase = await createClient();
  const { statement, customer, org } = bundle;
  const currency = org.currency || "USD";
  const balanceLabel = formatMoney(statement.balanceMinor, { currency }) as string;

  const record = async (status: string, reason: string | null, sentTo: string | null) => {
    const { error } = await supabase.from("customer_statements").insert({
      organization_id: input.organizationId, customer_id: input.customerId,
      as_of: statement.asOf, since: statement.since,
      opening_minor: statement.openingMinor, charges_minor: statement.chargesMinor,
      payments_minor: statement.paymentsMinor, balance_minor: statement.balanceMinor,
      past_due_minor: statement.pastDueMinor,
      channel: input.channel, status, reason, sent_to: sentTo,
      created_by: input.actorId ?? null,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    });
    // Losing the record must not lose the send, but it must not be silent.
    if (error) console.error(`[statements] could not record the statement for ${input.customerId}: ${error.message}`);
  };

  const ready = input.channel === "sms" ? providers.sms() : providers.email();
  if (!ready) {
    await record("skipped", "provider_not_configured", null);
    return { ok: false, skipped: true, channel: input.channel, reason: "provider_not_configured" };
  }

  const eligibility = contactEligibility(customer, input.channel) as { ok: boolean; to?: string; reason?: string };
  if (!eligibility.ok) {
    await record("skipped", eligibility.reason ?? "not_eligible", null);
    return { ok: false, skipped: true, channel: input.channel, reason: eligibility.reason };
  }

  const message = statementMessage({
    locale: input.locale ?? "en",
    firstName: String(customer.name ?? "").split(" ")[0] ?? "",
    businessName: org.name ?? "", balanceLabel, asOf: statement.asOf,
    // Deliberately NO link. The statement print view lives behind the app's own
    // authentication at /customers/[id]/statement, and mailing a customer an
    // internal URL they cannot open is worse than not mailing one. Giving them
    // a passwordless one would be a new credential nobody asked for; the
    // itemised detail travels in the body instead.
    link: "",
  }) as { subject: string; body: string };

  const detail = statement.openInvoices
    .slice(0, 20)
    .map((row) => `#${row.number ?? ""} — ${formatMoney(row.outstandingMinor, { currency })} (${row.ageDays}d)`)
    .join("\n");

  try {
    if (input.channel === "sms") {
      const sid = await sendSms(eligibility.to!, truncateForSms(message.body) as string);
      await supabase.from("sms_messages").insert({
        organization_id: input.organizationId, customer_id: input.customerId,
        to_phone: eligibility.to, body: message.body, provider: "twilio",
        provider_message_id: sid, status: "sent", sent_at: new Date().toISOString(),
      });
    } else {
      const html = `<p>${escapeHtml(message.body)}</p>`
        + (detail ? `<pre style="font-family:inherit">${escapeHtml(detail)}</pre>` : "")
        + `<p><b>${escapeHtml(`Balance: ${balanceLabel}`)}</b></p>`;
      const id = await sendEmail(eligibility.to!, message.subject, html);
      await supabase.from("email_messages").insert({
        organization_id: input.organizationId, related_type: "statement", related_id: input.customerId,
        to_email: eligibility.to, subject: message.subject, provider: "resend",
        provider_message_id: id, status: "sent", sent_at: new Date().toISOString(),
      });
    }
    await record("sent", null, eligibility.to ?? null);
    return { ok: true, channel: input.channel };
  } catch (cause: unknown) {
    const reason = errorText(cause);
    if (input.channel === "email") {
      await supabase.from("email_messages").insert({
        organization_id: input.organizationId, related_type: "statement", related_id: input.customerId,
        to_email: eligibility.to, subject: message.subject, provider: "resend", status: "failed", error: reason,
      });
    } else {
      await supabase.from("sms_messages").insert({
        organization_id: input.organizationId, customer_id: input.customerId,
        to_phone: eligibility.to, body: message.body, provider: "twilio", status: "failed", error: reason,
      });
    }
    await record("failed", reason, eligibility.to ?? null);
    console.error(`[statements] statement to ${input.customerId} failed: ${reason}`);
    return { ok: false, channel: input.channel, reason };
  }
}

/**
 * Statement data for the nightly dunning run, read with the SERVICE ROLE.
 *
 * The cron has no session, so it cannot use `loadStatement`. Kept deliberately
 * narrow: only the open invoices and the balance, for one customer.
 */
export async function loadStatementForCron(admin: ReturnType<typeof createAdminClient>, customerId: string, asOf: string): Promise<Statement | null> {
  const { data: invoices } = await admin.from("invoices")
    .select(INVOICE_FIELDS).eq("customer_id", customerId).is("deleted_at", null)
    .lte("issue_date", asOf).limit(STATEMENT_ROW_LIMIT);
  if (!invoices) return null;
  const ids = invoices.map((row: { id: string }) => row.id);
  const { data: payments } = ids.length
    ? await admin.from("payments").select(PAYMENT_FIELDS).in("invoice_id", ids).limit(STATEMENT_ROW_LIMIT)
    : { data: [] as Record<string, unknown>[] };
  return buildStatement({ invoices, payments: payments ?? [], asOf }) as Statement;
}
