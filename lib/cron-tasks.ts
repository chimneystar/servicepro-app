import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/lib/supabase/database.types";
import { providers, sendSms, sendEmail } from "@/lib/providers";
import { fillTemplate } from "@/lib/notify";
import { featureFlagEvaluator } from "@/lib/feature-flags";
// @ts-ignore -- shared JS module: the "Generate due" button uses the identical maths
import { RECURRING_JOB_SOURCE, nextDueAfter, recurringJobKey } from "@/lib/core/recurring.mjs";
// @ts-ignore -- shared JS module
import { isUniqueViolation } from "@/lib/core/db-errors.mjs";
// @ts-ignore -- shared JS module, proven both ways in tests/automation.test.mjs
import {
  AUTOMATION_MAX_ATTEMPTS,
  MESSAGE_ACTIONS,
  automationWindowStart,
  isStaleRun,
  nextRunAction,
  validateAutomationRule,
} from "@/lib/core/automation.mjs";
// @ts-ignore -- shared JS module, proven both ways in tests/outreach.test.mjs
import {
  INACTIVE_AFTER_DAYS,
  PAST_DUE_AFTER_DAYS,
  campaignChannels,
  contactEligibility,
  isKnownSegment,
  isoDaysBefore,
  truncateForSms,
} from "@/lib/core/outreach.mjs";
// @ts-ignore -- shared JS module
import { escapeHtml } from "@/lib/core/security.mjs";
// @ts-ignore -- shared JS module, proven both ways in tests/statements.test.mjs
import { dunningMessage, nextDunningStage } from "@/lib/core/statements.mjs";
// @ts-ignore -- shared JS module, proven both ways in tests/scheduled-reports.test.mjs
import { digestTotals, isDigestDue, renderDigest } from "@/lib/core/digest.mjs";
import { loadStatementForCron } from "@/lib/statements";
import { staffContact } from "@/lib/notify";
// @ts-ignore -- shared JS module
import { COLLECTED_STATUSES } from "@/lib/core/reporting.mjs";
// @ts-ignore -- shared JS module
import { formatMoney } from "@/lib/core/money.mjs";

const dayISO = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

/**
 * Create jobs for every maintenance plan that's due (all orgs), and roll each
 * plan PAST today. Advancing by one interval left an overdue plan overdue, so
 * the nightly run kept minting another back-dated job for it every night.
 */
export async function runRecurringGeneration(): Promise<number> {
  const admin = createAdminClient();
  const today = dayISO(0);
  const { data: due } = await admin
    .from("recurring_plans")
    .select("*")
    .eq("active", true)
    .lte("next_due", today);
  let created = 0;
  for (const p of due ?? []) {
    const dueDate = String(p.next_due);
    const { error } = await admin.from("jobs").insert({
      organization_id: p.organization_id,
      created_by: p.created_by,
      customer_id: p.customer_id,
      assigned_to: p.assigned_to,
      service: p.service,
      price_minor: p.price_minor,
      scheduled_date: dueDate,
      end_date: dueDate,
      source: "Maintenance plan",
      external_source: RECURRING_JOB_SOURCE,
      external_id: recurringJobKey(p.id, dueDate),
    });
    // 23505 = uq_jobs_external_source: the button already generated this
    // occurrence. Roll the plan forward regardless, or it never stops being due.
    if (error && !isUniqueViolation(error)) continue;
    if (!error) created++;
    await admin
      .from("recurring_plans")
      .update({ next_due: nextDueAfter(dueDate, p.interval_months, today) })
      .eq("id", p.id);
  }
  return created;
}

/** Send day-before appointment reminders + weekly overdue-invoice nudges (SMS). */
export async function runReminders(): Promise<{ appointments: number; overdue: number }> {
  if (!providers.sms()) return { appointments: 0, overdue: 0 };
  const admin = createAdminClient();
  const today = dayISO(0),
    tomorrow = dayISO(1),
    weekAgo = dayISO(-7);
  let appointments = 0,
    overdue = 0;

  // --- Appointment reminders (jobs scheduled tomorrow) ---
  const { data: jobs } = await admin
    .from("jobs")
    .select(
      "id, service, scheduled_date, start_time, organization_id, customers!jobs_customer_id_fkey(name, phone, sms_opt_in)",
    )
    .eq("scheduled_date", tomorrow)
    .eq("status", "scheduled")
    .is("deleted_at", null);
  for (const j of jobs ?? []) {
    const cust = j.customers;
    if (!cust?.phone || cust.phone === "—") continue;
    if (cust.sms_opt_in === false) continue; // customer replied STOP
    const { data: tpl } = await admin
      .from("message_templates")
      .select("enabled, body")
      .eq("organization_id", j.organization_id)
      .eq("trigger", "day_before")
      .maybeSingle();
    if (!tpl?.enabled || !tpl.body) continue;
    // Claim the slot first so two concurrent runs cannot both send...
    const { error: dupe } = await admin.from("reminder_log").insert({
      organization_id: j.organization_id,
      kind: "appointment",
      ref_id: j.id,
      sent_on: today,
    });
    if (dupe) continue; // already sent today
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", j.organization_id)
      .single();
    const body = fillTemplate(tpl.body, {
      name: (cust.name ?? "").split(" ")[0] ?? "",
      service: j.service ?? "",
      date: j.scheduled_date ?? "",
      time: (j.start_time ?? "").slice(0, 5),
      business: org?.name ?? "",
    });
    try {
      const sid = await sendSms(cust.phone, body);
      await admin.from("sms_messages").insert({
        organization_id: j.organization_id,
        job_id: j.id,
        to_phone: cust.phone,
        body,
        provider: "twilio",
        provider_message_id: sid,
        status: "sent",
        sent_at: new Date().toISOString(),
      });
      appointments++;
    } catch (e: unknown) {
      // ...but RELEASE it on failure, or a transient provider error would
      // suppress this reminder permanently — it could never be retried.
      await admin
        .from("reminder_log")
        .delete()
        .eq("organization_id", j.organization_id)
        .eq("kind", "appointment")
        .eq("ref_id", j.id)
        .eq("sent_on", today);
      console.error(
        `[cron] appointment reminder failed for job ${j.id}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  // --- Overdue invoice nudges (unpaid > 14 days, at most weekly) ---
  const { data: invs } = await admin
    .from("invoices")
    .select(
      "id, number, issue_date, organization_id, customers!invoices_customer_id_fkey(name, phone, sms_opt_in)",
    )
    .eq("status", "unpaid")
    .is("deleted_at", null)
    .lte("issue_date", dayISO(-14));
  for (const inv of invs ?? []) {
    const cust = inv.customers;
    if (!cust?.phone || cust.phone === "—") continue;
    if (cust.sms_opt_in === false) continue; // customer replied STOP
    const { data: recent } = await admin
      .from("reminder_log")
      .select("id")
      .eq("kind", "overdue")
      .eq("ref_id", inv.id)
      .gte("sent_on", weekAgo)
      .limit(1);
    if (recent && recent.length) continue;
    const { error: dupe } = await admin.from("reminder_log").insert({
      organization_id: inv.organization_id,
      kind: "overdue",
      ref_id: inv.id,
      sent_on: today,
    });
    if (dupe) continue;
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", inv.organization_id)
      .single();
    const body = `Friendly reminder from ${org?.name}: invoice #${inv.number} is past due. Please let us know if you have any questions — thank you!`;
    try {
      const sid = await sendSms(cust.phone, body);
      await admin.from("sms_messages").insert({
        organization_id: inv.organization_id,
        to_phone: cust.phone,
        body,
        provider: "twilio",
        provider_message_id: sid,
        status: "sent",
        sent_at: new Date().toISOString(),
      });
      overdue++;
    } catch (e: unknown) {
      // Release the claim so a transient failure can be retried next run.
      await admin
        .from("reminder_log")
        .delete()
        .eq("organization_id", inv.organization_id)
        .eq("kind", "overdue")
        .eq("ref_id", inv.id)
        .eq("sent_on", today);
      console.error(
        `[cron] overdue nudge failed for invoice ${inv.id}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  return { appointments, overdue };
}

// =====================================================================
//  Automation rules (ledger 5.8) and growth outreach (ledger 5.9).
//
//  Both were stored-but-inert: `automation_rules` had never produced a single
//  `automation_runs` row, and a campaign or estimate follow-up sat at its
//  scheduled time for ever. Everything below follows the same three rules the
//  reminder loops above already follow:
//
//    * CLAIM before sending, so two concurrent cron runs cannot both send;
//    * RELEASE (or mark retryable) on failure, so a transient provider error
//      cannot suppress a message permanently; and
//    * RECORD the outcome — including a deliberate skip and its reason —
//      because a send that is quietly not attempted is indistinguishable from
//      one that succeeded.
// =====================================================================

type Admin = ReturnType<typeof createAdminClient>;

/** Public origin, from configuration only — never from a caller. */
function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(
    /\/$/,
    "",
  );
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** Plain text → a minimal, escaped HTML body. Untrusted values never land raw. */
function htmlBody(text: string): string {
  return String(text ?? "")
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

type DeliverOptions = {
  organizationId: string;
  channel: "sms" | "email";
  to: string;
  body: string;
  subject?: string;
  customerId?: string | null;
  jobId?: string | null;
  relatedType?: string;
  relatedId?: string | null;
};

/**
 * Send one message and log it, on success AND on failure.
 *
 * THROWS when the provider rejects it. That is deliberate: the caller owns the
 * claim, and only a thrown error tells it to release/mark the claim retryable.
 * Swallowing here would leave a run marked 'succeeded' with nothing sent.
 */
async function deliver(admin: Admin, opts: DeliverOptions): Promise<string> {
  const sentAt = new Date().toISOString();
  if (opts.channel === "sms") {
    const body = truncateForSms(opts.body);
    try {
      const sid = await sendSms(opts.to, body);
      await admin.from("sms_messages").insert({
        organization_id: opts.organizationId,
        customer_id: opts.customerId ?? null,
        job_id: opts.jobId ?? null,
        to_phone: opts.to,
        body,
        provider: "twilio",
        provider_message_id: sid,
        status: "sent",
        sent_at: sentAt,
      });
      return sid;
    } catch (e: unknown) {
      await admin.from("sms_messages").insert({
        organization_id: opts.organizationId,
        customer_id: opts.customerId ?? null,
        job_id: opts.jobId ?? null,
        to_phone: opts.to,
        body,
        provider: "twilio",
        status: "failed",
        error: errorText(e),
      });
      throw e;
    }
  }
  const subject = opts.subject ?? "";
  try {
    const id = await sendEmail(opts.to, subject, htmlBody(opts.body));
    await admin.from("email_messages").insert({
      organization_id: opts.organizationId,
      related_type: opts.relatedType ?? null,
      related_id: opts.relatedId ?? null,
      to_email: opts.to,
      subject,
      provider: "resend",
      provider_message_id: id,
      status: "sent",
      sent_at: sentAt,
    });
    return id;
  } catch (e: unknown) {
    await admin.from("email_messages").insert({
      organization_id: opts.organizationId,
      related_type: opts.relatedType ?? null,
      related_id: opts.relatedId ?? null,
      to_email: opts.to,
      subject,
      provider: "resend",
      status: "failed",
      error: errorText(e),
    });
    throw e;
  }
}

/** Organisation names, fetched once per cron run rather than once per message. */
function orgNames(admin: Admin) {
  const cache = new Map<string, string>();
  return async (organizationId: string): Promise<string> => {
    const hit = cache.get(organizationId);
    if (hit !== undefined) return hit;
    const { data } = await admin
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle();
    const name = data?.name ?? "";
    cache.set(organizationId, name);
    return name;
  };
}

const CUSTOMER_CONTACT = "id, name, phone, email, sms_opt_in, email_opt_in, deleted_at";
/** Bound on rows examined per rule per night. A cron that scans without a limit is a future outage. */
const AUTOMATION_SOURCE_LIMIT = 200;

/**
 * The columns of `automation_rules` this file reads, taken from the generated
 * Row type rather than declared as `rule: any`. It is what the select at the
 * top of `runAutomations` asks for, so removing a column from the select or
 * from the table breaks this instead of producing `undefined` at 3am.
 */
type AutomationRule = Pick<
  Tables<"automation_rules">,
  | "id"
  | "organization_id"
  | "trigger_type"
  | "action_type"
  | "action_json"
  | "condition_json"
  | "created_at"
>;

type AutomationSource = {
  id: string;
  /** The contact columns in CUSTOMER_CONTACT, as the embed returns them. */
  customer: Pick<
    Tables<"customers">,
    "id" | "name" | "phone" | "email" | "sms_opt_in" | "email_opt_in" | "deleted_at"
  > | null;
  vars: Record<string, string>;
  jobId: string | null;
  label: string;
  link: string;
};

/**
 * Rows a rule should act on tonight.
 *
 * The window is the safety property: it starts no earlier than the rule's own
 * creation, so switching on "text every completed job" cannot text five years
 * of finished jobs, and no earlier than a two-day lookback, so a cron that was
 * down for a month does not send a month of back-dated messages at once.
 */
async function automationSources(
  admin: Admin,
  rule: AutomationRule,
  overdueDays: number,
  windowStart: string,
  nowISO: string,
): Promise<AutomationSource[]> {
  const origin = appOrigin();
  if (rule.trigger_type === "job_completed") {
    const { data } = await admin
      .from("jobs")
      .select(
        `id, service, scheduled_date, start_time, customer_id, customers!jobs_customer_id_fkey(${CUSTOMER_CONTACT})`,
      )
      .eq("organization_id", rule.organization_id)
      .eq("status", "done")
      .is("deleted_at", null)
      .gte("updated_at", windowStart)
      .lte("updated_at", nowISO)
      .order("updated_at", { ascending: false })
      .limit(AUTOMATION_SOURCE_LIMIT);
    return (data ?? []).map((row) => ({
      id: row.id,
      customer: row.customers,
      jobId: row.id,
      label: "job",
      link: "",
      vars: {
        service: row.service ?? "",
        date: row.scheduled_date ?? "",
        time: String(row.start_time ?? "").slice(0, 5),
        number: "",
      },
    }));
  }
  if (rule.trigger_type === "estimate_sent") {
    const { data } = await admin
      .from("estimates")
      .select(
        `id, number, public_token, customer_id, customers!estimates_customer_id_fkey(${CUSTOMER_CONTACT})`,
      )
      .eq("organization_id", rule.organization_id)
      .eq("status", "sent")
      .is("deleted_at", null)
      .gte("updated_at", windowStart)
      .lte("updated_at", nowISO)
      .order("updated_at", { ascending: false })
      .limit(AUTOMATION_SOURCE_LIMIT);
    return (data ?? []).map((row) => ({
      id: row.id,
      customer: row.customers,
      jobId: null,
      label: "estimate",
      link: origin && row.public_token ? `${origin}/p/${row.public_token}` : "",
      vars: { number: String(row.number ?? ""), service: "", date: "", time: "" },
    }));
  }
  // invoice_overdue is time-based: an invoice nobody touches still becomes
  // overdue, so eligibility is issue_date + overdueDays, not updated_at.
  const windowStartDate = windowStart.slice(0, 10);
  const { data } = await admin
    .from("invoices")
    .select(
      `id, number, issue_date, public_token, job_id, customer_id, customers!invoices_customer_id_fkey(${CUSTOMER_CONTACT})`,
    )
    .eq("organization_id", rule.organization_id)
    .eq("status", "unpaid")
    .is("deleted_at", null)
    .gte("issue_date", isoDaysBefore(windowStartDate, overdueDays))
    .lte("issue_date", isoDaysBefore(nowISO.slice(0, 10), overdueDays))
    .order("issue_date", { ascending: false })
    .limit(AUTOMATION_SOURCE_LIMIT);
  return (data ?? []).map((row) => ({
    id: row.id,
    customer: row.customers,
    jobId: row.job_id ?? null,
    label: "invoice",
    link: origin && row.public_token ? `${origin}/p/${row.public_token}` : "",
    vars: { number: String(row.number ?? ""), date: row.issue_date ?? "", service: "", time: "" },
  }));
}

/**
 * Perform one rule's action against one source row.
 * `{ ok: false, reason }` is a DELIBERATE skip (consent, no contact details) and
 * is recorded as such. A provider failure throws.
 */
async function runAutomationAction(
  admin: Admin,
  rule: AutomationRule,
  message: string,
  source: AutomationSource,
  businessName: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (rule.action_type === "create_task") {
    // job_tasks.job_id is NOT NULL; validateAutomationRule only ever allows
    // create_task for the job_completed trigger, so this is always present.
    if (!source.jobId) return { ok: false, reason: "no_job_for_task" };
    const { error } = await admin.from("job_tasks").insert({
      organization_id: rule.organization_id,
      job_id: source.jobId,
      title: message.slice(0, 200),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  const channel = rule.action_type === "send_sms" ? "sms" : "email";
  const eligibility = contactEligibility(source.customer, channel);
  if (!eligibility.ok) return { ok: false, reason: eligibility.reason };

  const body = fillTemplate(message, {
    ...source.vars,
    name: String(source.customer?.name ?? "").split(" ")[0] ?? "",
    business: businessName,
    link: source.link,
  });
  await deliver(admin, {
    organizationId: rule.organization_id,
    channel,
    to: eligibility.to,
    body,
    subject: `${businessName}`.trim() || "A message from your service provider",
    customerId: source.customer ? (source.customer.id ?? null) : null,
    jobId: source.jobId,
    relatedType: `automation_${source.label}`,
    relatedId: null,
  });
  return { ok: true };
}

export type AutomationRunSummary = {
  rules: number;
  fired: number;
  skipped: number;
  failed: number;
  invalidRules: number;
  flagDisabled: number;
  providerMissing: number;
  stuck: number;
};

/**
 * Execute every enabled automation rule (ledger 5.8).
 *
 * Idempotency lives in `automation_runs`: the row is both the claim and the
 * audit record, and `uq_automation_runs_rule_source` (migration 032) makes the
 * insert the arbiter between two concurrent runs. A failed run is NOT deleted —
 * it is left as `failed` with its error and re-claimed by compare-and-set on the
 * next night, up to AUTOMATION_MAX_ATTEMPTS. A succeeded or skipped run is
 * terminal, so no source row can ever be acted on twice.
 */
export async function runAutomationRules(): Promise<AutomationRunSummary> {
  const admin = createAdminClient();
  const enabledFor = await featureFlagEvaluator("automation_rules");
  const nameOf = orgNames(admin);
  const nowISO = new Date().toISOString();
  const summary: AutomationRunSummary = {
    rules: 0,
    fired: 0,
    skipped: 0,
    failed: 0,
    invalidRules: 0,
    flagDisabled: 0,
    providerMissing: 0,
    stuck: 0,
  };

  const { data: rules } = await admin
    .from("automation_rules")
    .select(
      "id, organization_id, trigger_type, action_type, action_json, condition_json, created_at",
    )
    .eq("enabled", true)
    .order("created_at", { ascending: true })
    .limit(500);

  for (const rule of rules ?? []) {
    if (!enabledFor(rule.organization_id)) {
      summary.flagDisabled++;
      continue;
    }

    // Rules created before validation existed can still be malformed. Report
    // them every night rather than skipping them in silence.
    const validation = validateAutomationRule({
      triggerType: rule.trigger_type,
      actionType: rule.action_type,
      message: (rule.action_json as any)?.message,
      overdueDays: (rule.condition_json as any)?.overdue_days,
    });
    if (!validation.ok) {
      summary.invalidRules++;
      console.error(`[cron] automation rule ${rule.id} cannot run: ${validation.reason}`);
      continue;
    }
    const { message, overdueDays } = validation.rule;

    // Provider checks happen BEFORE anything is claimed. Claiming and failing
    // would burn the retry budget every night and permanently skip the rule the
    // week the business finally connects Twilio.
    if (MESSAGE_ACTIONS.includes(rule.action_type)) {
      const ready = rule.action_type === "send_sms" ? providers.sms() : providers.email();
      if (!ready) {
        summary.providerMissing++;
        console.warn(
          `[cron] automation rule ${rule.id} needs a ${rule.action_type === "send_sms" ? "SMS" : "email"} provider that is not configured`,
        );
        continue;
      }
    }

    summary.rules++;
    const windowStart = automationWindowStart(rule.created_at, nowISO);
    const businessName = await nameOf(rule.organization_id);
    let sources: AutomationSource[] = [];
    try {
      sources = await automationSources(admin, rule, overdueDays, windowStart, nowISO);
    } catch (e: unknown) {
      summary.failed++;
      console.error(`[cron] automation rule ${rule.id} could not read its sources:`, errorText(e));
      continue;
    }
    if (sources.length === AUTOMATION_SOURCE_LIMIT) {
      console.warn(
        `[cron] automation rule ${rule.id} hit the ${AUTOMATION_SOURCE_LIMIT}-row scan limit; remaining rows run tomorrow`,
      );
    }

    for (const source of sources) {
      const { data: existing } = await admin
        .from("automation_runs")
        .select("id, status, attempts, created_at")
        .eq("rule_id", rule.id)
        .eq("source_id", source.id)
        .maybeSingle();
      const decision = nextRunAction(existing, AUTOMATION_MAX_ATTEMPTS);
      if (decision === "skip") {
        if (isStaleRun(existing, nowISO)) {
          summary.stuck++;
          console.error(
            `[cron] automation run ${existing!.id} has been 'running' since ${existing!.created_at}; it will not be re-fired automatically because nobody can tell whether the message went out`,
          );
        }
        continue;
      }

      let runId: string | null = null;
      if (decision === "claim") {
        const { data: claimed, error: claimError } = await admin
          .from("automation_runs")
          .insert({
            organization_id: rule.organization_id,
            rule_id: rule.id,
            source_type: source.label,
            source_id: source.id,
            status: "running",
            attempts: 1,
          })
          .select("id")
          .maybeSingle();
        // A unique violation means a concurrent run won the race — correct, not an error.
        if (claimError) {
          if (!isUniqueViolation(claimError))
            console.error(
              `[cron] could not claim automation run for rule ${rule.id}:`,
              claimError.message,
            );
          continue;
        }
        runId = claimed?.id ?? null;
      } else {
        // Compare-and-set: only the worker that flips 'failed' → 'running' owns it.
        const { data: retried } = await admin
          .from("automation_runs")
          .update({
            status: "running",
            attempts: Number(existing!.attempts ?? 0) + 1,
            error_message: null,
            finished_at: null,
          })
          .eq("id", existing!.id)
          .eq("status", "failed")
          .select("id")
          .maybeSingle();
        if (!retried) continue;
        runId = retried.id;
      }
      if (!runId) continue;

      try {
        const outcome = await runAutomationAction(admin, rule, message, source, businessName);
        if (outcome.ok) {
          summary.fired++;
          await admin
            .from("automation_runs")
            .update({ status: "succeeded", finished_at: new Date().toISOString() })
            .eq("id", runId);
        } else {
          // A skip is terminal and CARRIES ITS REASON: "we did not text this
          // customer because they replied STOP" must be readable afterwards.
          summary.skipped++;
          await admin
            .from("automation_runs")
            .update({
              status: "skipped",
              error_message: outcome.reason,
              finished_at: new Date().toISOString(),
            })
            .eq("id", runId);
        }
      } catch (e: unknown) {
        summary.failed++;
        const message = errorText(e);
        await admin
          .from("automation_runs")
          .update({
            status: "failed",
            error_message: message,
            finished_at: new Date().toISOString(),
          })
          .eq("id", runId);
        console.error(
          `[cron] automation rule ${rule.id} failed on ${source.label} ${source.id}:`,
          message,
        );
      }
    }

    await admin
      .from("automation_rules")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", rule.id);
  }
  return summary;
}

// ---------------------------------------------------------------------
//  Campaigns and estimate follow-ups (ledger 5.9).
// ---------------------------------------------------------------------

const CAMPAIGN_RECIPIENT_LIMIT = 1000;

/** Customers a campaign segment resolves to. Every segment is defined, none is a silent "everyone". */
async function campaignAudience(
  admin: Admin,
  organizationId: string,
  segment: string,
): Promise<any[]> {
  const today = dayISO(0);
  if (segment === "past_due") {
    // Same definition the overdue nudge uses: unpaid, issued at least 14 days ago.
    const { data: invoices } = await admin
      .from("invoices")
      .select("customer_id")
      .eq("organization_id", organizationId)
      .eq("status", "unpaid")
      .is("deleted_at", null)
      .lte("issue_date", isoDaysBefore(today, PAST_DUE_AFTER_DAYS))
      .limit(CAMPAIGN_RECIPIENT_LIMIT);
    const ids = [...new Set((invoices ?? []).map((row) => row.customer_id).filter(Boolean))];
    if (!ids.length) return [];
    const { data } = await admin
      .from("customers")
      .select(`${CUSTOMER_CONTACT}`)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .eq("archived", false)
      .in("id", ids)
      .limit(CAMPAIGN_RECIPIENT_LIMIT);
    return data ?? [];
  }
  if (segment === "inactive") {
    // No work in the last year. Computed by exclusion so a customer with a
    // recent job cannot slip in through a stale cache.
    const { data: recent } = await admin
      .from("jobs")
      .select("customer_id")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .gte("scheduled_date", isoDaysBefore(today, INACTIVE_AFTER_DAYS))
      .limit(5000);
    const active = new Set((recent ?? []).map((row) => row.customer_id));
    const { data } = await admin
      .from("customers")
      .select(`${CUSTOMER_CONTACT}`)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .eq("archived", false)
      .limit(CAMPAIGN_RECIPIENT_LIMIT);
    return (data ?? []).filter((row) => !active.has(row.id));
  }
  const { data } = await admin
    .from("customers")
    .select(`${CUSTOMER_CONTACT}`)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .eq("archived", false)
    .limit(CAMPAIGN_RECIPIENT_LIMIT);
  return data ?? [];
}

export type OutreachSummary = {
  campaigns: number;
  campaignMessages: number;
  campaignSkipped: number;
  campaignFailed: number;
  followupsSent: number;
  followupsSkipped: number;
  followupsFailed: number;
  flagDisabled: number;
  invalid: number;
};

/**
 * Send scheduled campaigns and due estimate follow-ups (ledger 5.9).
 *
 * Opt-out is enforced for EVERY recipient through `contactEligibility`, the same
 * `customers.sms_opt_in` / `email_opt_in` rule the reminder loops honour.
 * Marketing to somebody who replied STOP is a legal problem, so the refusal is
 * a pure, separately tested function rather than an inline condition, and the
 * refusal itself is recorded (`campaign_deliveries.status = 'skipped'` with its
 * reason) so "we chose not to" never looks like "it silently vanished".
 */
export async function runGrowthOutreach(): Promise<OutreachSummary> {
  const admin = createAdminClient();
  const enabledFor = await featureFlagEvaluator("growth_outreach");
  const nameOf = orgNames(admin);
  const nowISO = new Date().toISOString();
  const summary: OutreachSummary = {
    campaigns: 0,
    campaignMessages: 0,
    campaignSkipped: 0,
    campaignFailed: 0,
    followupsSent: 0,
    followupsSkipped: 0,
    followupsFailed: 0,
    flagDisabled: 0,
    invalid: 0,
  };

  // --- Campaigns due to go out -------------------------------------------
  const { data: campaigns } = await admin
    .from("campaigns")
    .select(
      "id, organization_id, name, channel, subject, body, audience_json, scheduled_at, status",
    )
    .eq("status", "scheduled")
    .lte("scheduled_at", nowISO)
    .order("scheduled_at", { ascending: true })
    .limit(20);

  for (const campaign of campaigns ?? []) {
    if (!enabledFor(campaign.organization_id)) {
      summary.flagDisabled++;
      continue;
    }
    const segment = String((campaign.audience_json as any)?.segment ?? "all_customers");
    const channels: ("sms" | "email")[] = campaignChannels(campaign.channel);
    if (!channels.length || !isKnownSegment(segment)) {
      summary.invalid++;
      console.error(
        `[cron] campaign ${campaign.id} has an unsupported channel/segment (${campaign.channel}/${segment}); left scheduled`,
      );
      continue;
    }
    // A campaign whose provider is not connected stays 'scheduled' and says so.
    const usable = channels.filter((channel) =>
      channel === "sms" ? providers.sms() : providers.email(),
    );
    if (!usable.length) {
      summary.invalid++;
      console.warn(
        `[cron] campaign ${campaign.id} needs a provider that is not configured; left scheduled`,
      );
      continue;
    }

    // Claim the campaign itself: only the worker that flips 'scheduled' →
    // 'sending' builds the audience.
    const { data: claimed } = await admin
      .from("campaigns")
      .update({ status: "sending" })
      .eq("id", campaign.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    summary.campaigns++;

    const businessName = await nameOf(campaign.organization_id);
    let retryable = false;
    try {
      const audience = await campaignAudience(admin, campaign.organization_id, segment);
      for (const customer of audience) {
        for (const channel of usable) {
          // Per-recipient claim. This is what makes a campaign resumable: a
          // crash half-way through re-sends to nobody.
          const { data: existing } = await admin
            .from("campaign_deliveries")
            .select("id, status, attempts")
            .eq("campaign_id", campaign.id)
            .eq("customer_id", customer.id)
            .eq("channel", channel)
            .maybeSingle();
          const decision = nextRunAction(existing, AUTOMATION_MAX_ATTEMPTS);
          if (decision === "skip") continue;

          let deliveryId: string | null = null;
          if (decision === "claim") {
            const { data: row, error } = await admin
              .from("campaign_deliveries")
              .insert({
                organization_id: campaign.organization_id,
                campaign_id: campaign.id,
                customer_id: customer.id,
                channel,
                status: "running",
                attempts: 1,
              })
              .select("id")
              .maybeSingle();
            if (error) {
              if (!isUniqueViolation(error))
                console.error(`[cron] campaign ${campaign.id} claim failed:`, error.message);
              continue;
            }
            deliveryId = row?.id ?? null;
          } else {
            const { data: row } = await admin
              .from("campaign_deliveries")
              .update({
                status: "running",
                attempts: Number(existing!.attempts ?? 0) + 1,
                reason: null,
                finished_at: null,
              })
              .eq("id", existing!.id)
              .eq("status", "failed")
              .select("id")
              .maybeSingle();
            if (!row) continue;
            deliveryId = row.id;
          }
          if (!deliveryId) continue;

          const eligibility = contactEligibility(customer, channel);
          if (!eligibility.ok) {
            summary.campaignSkipped++;
            await admin
              .from("campaign_deliveries")
              .update({
                status: "skipped",
                reason: eligibility.reason,
                finished_at: new Date().toISOString(),
              })
              .eq("id", deliveryId);
            continue;
          }
          const body = fillTemplate(campaign.body ?? "", {
            name: String(customer.name ?? "").split(" ")[0] ?? "",
            business: businessName,
            service: "",
            date: "",
            time: "",
            number: "",
            link: "",
          });
          try {
            await deliver(admin, {
              organizationId: campaign.organization_id,
              channel,
              to: eligibility.to,
              body,
              subject: campaign.subject || campaign.name || businessName,
              customerId: customer.id,
              relatedType: "campaign",
              relatedId: campaign.id,
            });
            summary.campaignMessages++;
            await admin
              .from("campaign_deliveries")
              .update({ status: "sent", finished_at: new Date().toISOString() })
              .eq("id", deliveryId);
          } catch (e: unknown) {
            summary.campaignFailed++;
            retryable = true;
            await admin
              .from("campaign_deliveries")
              .update({
                status: "failed",
                reason: errorText(e),
                finished_at: new Date().toISOString(),
              })
              .eq("id", deliveryId);
            console.error(
              `[cron] campaign ${campaign.id} could not reach customer ${customer.id} by ${channel}:`,
              errorText(e),
            );
          }
        }
      }
    } catch (e: unknown) {
      retryable = true;
      console.error(
        `[cron] campaign ${campaign.id} failed while building its audience:`,
        errorText(e),
      );
    }

    const { count } = await admin
      .from("campaign_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .eq("status", "sent");
    // Anything still retryable goes BACK to 'scheduled' rather than being
    // declared sent — a campaign stuck in 'sending' would be a silent failure,
    // and the per-recipient claims mean the retry cannot duplicate a message.
    await admin
      .from("campaigns")
      .update({ status: retryable ? "scheduled" : "sent", sent_count: count ?? 0 })
      .eq("id", campaign.id);
  }

  // --- Estimate follow-ups -----------------------------------------------
  const { data: followups } = await admin
    .from("estimate_followups")
    .select("id, organization_id, estimate_id, channel, scheduled_at, attempts")
    .eq("status", "scheduled")
    .lte("scheduled_at", nowISO)
    .order("scheduled_at", { ascending: true })
    .limit(200);

  const origin = appOrigin();
  for (const followup of followups ?? []) {
    if (!enabledFor(followup.organization_id)) {
      summary.flagDisabled++;
      continue;
    }
    const channel: "sms" | "email" = followup.channel === "sms" ? "sms" : "email";
    if (channel === "sms" ? !providers.sms() : !providers.email()) {
      summary.invalid++;
      console.warn(
        `[cron] estimate follow-up ${followup.id} needs a ${channel} provider that is not configured; left scheduled`,
      );
      continue;
    }
    const attempts = Number(followup.attempts ?? 0) + 1;
    // Claim by leaving 'scheduled'. Only one worker can win this update.
    const { data: claimed } = await admin
      .from("estimate_followups")
      .update({ status: "sent", attempts, sent_at: new Date().toISOString() })
      .eq("id", followup.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const release = async (message: string) => {
      // Retry while there is budget, then fail VISIBLY with the reason —
      // never retry for ever, never lose it.
      const exhausted = attempts >= AUTOMATION_MAX_ATTEMPTS;
      await admin
        .from("estimate_followups")
        .update({
          status: exhausted ? "failed" : "scheduled",
          error_message: message,
          sent_at: null,
        })
        .eq("id", followup.id);
      summary.followupsFailed++;
      console.error(
        `[cron] estimate follow-up ${followup.id} failed (attempt ${attempts}${exhausted ? ", giving up" : ""}):`,
        message,
      );
    };

    try {
      const { data: estimate } = await admin
        .from("estimates")
        .select(
          `id, number, public_token, customer_id, customers!estimates_customer_id_fkey(${CUSTOMER_CONTACT})`,
        )
        .eq("id", followup.estimate_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (!estimate) {
        await release("estimate not found");
        continue;
      }
      const eligibility = contactEligibility(estimate.customers, channel);
      if (!eligibility.ok) {
        // Consent refusal is terminal and named — not a retry, not a silence.
        await admin
          .from("estimate_followups")
          .update({ status: "cancelled", error_message: eligibility.reason, sent_at: null })
          .eq("id", followup.id);
        summary.followupsSkipped++;
        continue;
      }
      const businessName = await nameOf(followup.organization_id);
      const link = origin && estimate.public_token ? `${origin}/p/${estimate.public_token}` : "";
      const first = String(estimate.customers?.name ?? "").split(" ")[0] ?? "";
      const body =
        `Hi ${first}, just following up on estimate #${estimate.number} from ${businessName}.` +
        (link ? ` You can review and approve it here: ${link}` : "") +
        " Let us know if you have any questions — thank you!";
      await deliver(admin, {
        organizationId: followup.organization_id,
        channel,
        to: eligibility.to,
        body,
        subject: `${businessName} — estimate #${estimate.number}`,
        customerId: estimate.customer_id ?? null,
        relatedType: "estimate_followup",
        relatedId: followup.estimate_id,
      });
      summary.followupsSent++;
    } catch (e: unknown) {
      await release(errorText(e));
    }
  }

  return summary;
}

// =====================================================================
//  Structured dunning (ledger 6c.6).
//
//  WHAT WAS THERE: `runReminders` above sends ONE overdue SMS per unpaid
//  invoice, at most weekly, for ever. Day 15 and day 400 get the identical
//  message at the identical volume, and there is no terminal state — a business
//  keeps texting somebody it has already written off.
//
//  WHAT THIS ADDS: a four-rung ladder that escalates, changes channel, and
//  STOPS. `nextDunningStage` returns the HIGHEST rung the invoice's age has
//  earned, so switching this on against a book of year-old invoices sends one
//  final notice each rather than four nightly messages. `dunning_events` is the
//  claim (unique per invoice+stage), so a rung fires exactly once.
//
//  The weekly nudge is NOT removed. It stays exactly as it was for businesses
//  that never enable this; the two are kept apart by `organizations.dunning_enabled`
//  being absent — see the note below on why this is opt-in through the schedule
//  screen rather than switched on for everybody.
// =====================================================================

export type DunningSummary = {
  invoices: number;
  sent: number;
  skipped: number;
  failed: number;
  providerMissing: number;
  flagDisabled: number;
};

/** Bound on invoices examined per organisation per night. */
const DUNNING_SCAN_LIMIT = 500;

/**
 * Walk every open invoice and fire at most one dunning rung against each.
 *
 * Claim → attempt → release-as-retryable, exactly as the automation runner
 * does. A consent refusal is TERMINAL and recorded with its reason; a provider
 * failure is left as `failed` with its message and re-claimed by compare-and-set
 * on a later night, up to AUTOMATION_MAX_ATTEMPTS.
 */
export async function runDunning(): Promise<DunningSummary> {
  const admin = createAdminClient();
  const enabledFor = await featureFlagEvaluator("growth_outreach");
  const nameOf = orgNames(admin);
  const today = dayISO(0);
  const origin = appOrigin();
  const summary: DunningSummary = {
    invoices: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    providerMissing: 0,
    flagDisabled: 0,
  };

  const { data: invoices } = await admin
    .from("invoices")
    .select(
      `id, number, organization_id, issue_date, total_minor, public_token, customer_id, customers!invoices_customer_id_fkey(${CUSTOMER_CONTACT})`,
    )
    .eq("status", "unpaid")
    .is("deleted_at", null)
    .lte("issue_date", isoDaysBefore(today, 7))
    .order("issue_date", { ascending: true })
    .limit(DUNNING_SCAN_LIMIT);

  const orgCurrency = new Map<string, string>();
  const currencyOf = async (organizationId: string): Promise<string> => {
    const hit = orgCurrency.get(organizationId);
    if (hit !== undefined) return hit;
    const { data } = await admin
      .from("organizations")
      .select("currency")
      .eq("id", organizationId)
      .maybeSingle();
    const currency = data?.currency ?? "USD";
    orgCurrency.set(organizationId, currency);
    return currency;
  };

  for (const invoice of invoices ?? []) {
    if (!enabledFor(invoice.organization_id)) {
      summary.flagDisabled++;
      continue;
    }

    // Outstanding is the invoice total net of settled payments, so a partly
    // paid invoice is dunned for what is left and a fully paid one is not
    // dunned at all even if its status was never flipped.
    const { data: paid } = await admin
      .from("payments")
      .select("base_amount_minor, amount_minor, refunded_minor, normalized_status")
      .eq("invoice_id", invoice.id)
      .in("normalized_status", COLLECTED_STATUSES);
    const collected = (paid ?? []).reduce(
      (sum: number, row) =>
        sum +
        Math.max(
          0,
          Number(row.base_amount_minor ?? row.amount_minor ?? 0) - Number(row.refunded_minor ?? 0),
        ),
      0,
    );
    const outstanding = Number(invoice.total_minor ?? 0) - collected;
    if (outstanding <= 0) continue;

    const ageDays = Math.round(
      (new Date(`${today}T00:00:00.000Z`).getTime() -
        new Date(`${String(invoice.issue_date).slice(0, 10)}T00:00:00.000Z`).getTime()) /
        86400000,
    );

    const { data: history } = await admin
      .from("dunning_events")
      .select("stage, status, attempts, id")
      .eq("invoice_id", invoice.id);
    // Only a rung that actually WENT OUT (or was terminally skipped) counts as
    // sent. A rung left 'failed' must remain retryable.
    const done = (history ?? [])
      .filter((row) => row.status === "sent" || row.status === "skipped")
      .map((row) => row.stage);
    // No cast: `nextDunningStage` returns a rung of DUNNING_LADDER, whose
    // `stage` and `channel` are annotated in lib/core/statements.mjs with the
    // exact values `dunning_events` allows. The `as { stage: string; ... }`
    // that used to be here widened `stage` back to `string` and was the reason
    // the write below could not be checked.
    const rung = nextDunningStage({ ageDays, outstandingMinor: outstanding }, done);
    if (!rung) continue;
    summary.invoices++;

    const ready = rung.channel === "sms" ? providers.sms() : providers.email();
    if (!ready) {
      // Checked BEFORE the claim: claiming and failing would burn the retry
      // budget every night and permanently skip the rung the week the business
      // finally connects a provider.
      summary.providerMissing++;
      continue;
    }

    const existing = (history ?? []).find((row) => row.stage === rung.stage);
    let eventId: string | null = null;
    if (!existing) {
      const { data: claimed, error: claimError } = await admin
        .from("dunning_events")
        .insert({
          organization_id: invoice.organization_id,
          invoice_id: invoice.id,
          customer_id: invoice.customer_id ?? null,
          stage: rung.stage,
          channel: rung.channel,
          status: "running",
          attempts: 1,
          age_days: ageDays,
          outstanding_minor: outstanding,
        })
        .select("id")
        .maybeSingle();
      if (claimError) {
        if (!isUniqueViolation(claimError))
          console.error(
            `[cron] could not claim dunning ${rung.stage} for invoice ${invoice.id}:`,
            claimError.message,
          );
        continue;
      }
      eventId = claimed?.id ?? null;
    } else {
      if (String(existing.status) !== "failed") continue;
      if (Number(existing.attempts ?? 0) >= AUTOMATION_MAX_ATTEMPTS) continue;
      // Compare-and-set: only the worker that flips 'failed' → 'running' owns it.
      const { data: retried } = await admin
        .from("dunning_events")
        .update({
          status: "running",
          attempts: Number(existing.attempts ?? 0) + 1,
          reason: null,
          finished_at: null,
        })
        .eq("id", existing.id)
        .eq("status", "failed")
        .select("id")
        .maybeSingle();
      if (!retried) continue;
      eventId = retried.id;
    }
    if (!eventId) continue;

    const customer = invoice.customers;
    const eligibility = contactEligibility(customer, rung.channel);
    if (!eligibility.ok) {
      // Consent refusal is TERMINAL and named. A customer who replied STOP must
      // never receive the next rung, and "we chose not to" must be readable.
      summary.skipped++;
      await admin
        .from("dunning_events")
        .update({
          status: "skipped",
          reason: eligibility.reason,
          finished_at: new Date().toISOString(),
        })
        .eq("id", eventId);
      continue;
    }

    try {
      const businessName = await nameOf(invoice.organization_id);
      const currency = await currencyOf(invoice.organization_id);
      const statement = await loadStatementForCron(admin, String(invoice.customer_id), today);
      const message = dunningMessage({
        stage: rung.stage,
        firstName: String(customer?.name ?? "").split(" ")[0] ?? "",
        businessName,
        invoiceNumber: String(invoice.number ?? ""),
        amountLabel: formatMoney(outstanding, { currency }) as string,
        balanceLabel: formatMoney(statement?.balanceMinor ?? outstanding, { currency }) as string,
        link: origin && invoice.public_token ? `${origin}/p/${invoice.public_token}` : "",
      }) as { subject: string; body: string };

      await deliver(admin, {
        organizationId: invoice.organization_id,
        channel: rung.channel,
        to: eligibility.to,
        body: message.body,
        subject: message.subject,
        customerId: invoice.customer_id ?? null,
        relatedType: `dunning_${rung.stage}`,
        relatedId: invoice.id,
      });
      summary.sent++;
      await admin
        .from("dunning_events")
        .update({ status: "sent", finished_at: new Date().toISOString() })
        .eq("id", eventId);
    } catch (e: unknown) {
      // RELEASE as retryable. A swallowed send is indistinguishable from a
      // successful one; this is neither.
      summary.failed++;
      const reason = errorText(e);
      await admin
        .from("dunning_events")
        .update({ status: "failed", reason, finished_at: new Date().toISOString() })
        .eq("id", eventId);
      console.error(`[cron] dunning ${rung.stage} for invoice ${invoice.id} failed:`, reason);
    }
  }

  return summary;
}

// =====================================================================
//  Scheduled / emailed reports (ledger 6c.9).
//
//  Every number in this product required somebody to log in and look at it.
//
//  THE ONE RULE: the revenue arithmetic comes from lib/core/reporting.mjs
//  through `digestTotals`, which is a pass-through to `periodTotals`. Three
//  screens each grew their own inline copy and all three were wrong in the same
//  two ways; a fourth copy in an email nobody cross-checks would be the worst,
//  because a wrong figure in an inbox is trusted and never reconciled.
// =====================================================================

export type ReportRunSummary = {
  schedules: number;
  sent: number;
  recipients: number;
  skipped: number;
  failed: number;
  providerMissing: number;
};

export async function runScheduledReports(): Promise<ReportRunSummary> {
  const admin = createAdminClient();
  const nameOf = orgNames(admin);
  const today = dayISO(0);
  const origin = appOrigin();
  const summary: ReportRunSummary = {
    schedules: 0,
    sent: 0,
    recipients: 0,
    skipped: 0,
    failed: 0,
    providerMissing: 0,
  };

  const { data: schedules } = await admin
    .from("report_schedules")
    .select(
      "id, organization_id, name, frequency, enabled, recipient_profile_ids, starts_on, last_period_key",
    )
    .eq("enabled", true)
    .limit(500);

  for (const schedule of schedules ?? []) {
    const due = isDigestDue(schedule, today) as {
      due: boolean;
      reason: string;
      period?: { start: string; end: string; label: string; key: string };
    };
    if (!due.due || !due.period) continue;
    const period = due.period;

    if (!providers.email()) {
      // Not claimed: the schedule stays due so it goes out the day an email
      // provider is connected, rather than being burned tonight.
      summary.providerMissing++;
      console.warn(
        `[cron] report schedule ${schedule.id} needs an email provider that is not configured; left due`,
      );
      continue;
    }

    // CLAIM the period. The unique (schedule_id, period_key) makes the insert
    // the arbiter between concurrent runs, so a cron that fires twice sends one
    // digest and a week-long outage produces one catch-up, not seven.
    const { data: claimed, error: claimError } = await admin
      .from("report_deliveries")
      .insert({
        organization_id: schedule.organization_id,
        schedule_id: schedule.id,
        period_key: period.key,
        period_start: period.start,
        period_end: period.end,
        status: "running",
        attempts: 1,
      })
      .select("id")
      .maybeSingle();
    if (claimError) {
      if (!isUniqueViolation(claimError))
        console.error(`[cron] could not claim report ${schedule.id}:`, claimError.message);
      continue;
    }
    const deliveryId = claimed?.id ?? null;
    if (!deliveryId) continue;
    summary.schedules++;

    try {
      const organizationId = schedule.organization_id;
      const [
        { data: org },
        { data: invoices },
        { data: payments },
        { data: expenses },
        { data: open },
      ] = await Promise.all([
        admin
          .from("organizations")
          .select("currency, locale")
          .eq("id", organizationId)
          .maybeSingle(),
        admin
          .from("invoices")
          .select("id, total_minor, discount_minor, tax_rate_bps, issue_date")
          .eq("organization_id", organizationId)
          .eq("status", "paid")
          .is("deleted_at", null)
          .gte("issue_date", period.start)
          .lte("issue_date", period.end)
          .limit(2000),
        admin
          .from("payments")
          .select("invoice_id, base_amount_minor, amount_minor, refunded_minor, normalized_status")
          .eq("organization_id", organizationId)
          .in("normalized_status", COLLECTED_STATUSES)
          .gte("paid_at", `${period.start}T00:00:00`)
          .lte("paid_at", `${period.end}T23:59:59`)
          .limit(5000),
        admin
          .from("expenses")
          .select("amount_minor")
          .eq("organization_id", organizationId)
          .gte("expense_date", period.start)
          .lte("expense_date", period.end)
          .limit(2000),
        admin
          .from("invoices")
          .select("total_minor")
          .eq("organization_id", organizationId)
          .eq("status", "unpaid")
          .is("deleted_at", null)
          .limit(2000),
      ]);

      const invoiceIds = (invoices ?? []).map((row) => row.id);
      const { data: items } = invoiceIds.length
        ? await admin
            .from("invoice_items")
            .select("invoice_id, qty_milli, unit_price_minor, cost_minor, taxable")
            .in("invoice_id", invoiceIds)
            .limit(10000)
        : { data: [] as any[] };
      const itemsByInvoice: Record<string, any[]> = {};
      for (const item of items ?? []) (itemsByInvoice[item.invoice_id] ||= []).push(item);

      const currency = org?.currency ?? "USD";
      const locale: "en" | "he" = org?.locale === "he" ? "he" : "en";
      const totals = digestTotals({
        payments: payments ?? [],
        invoices: invoices ?? [],
        itemsByInvoice,
        expensesMinor: (expenses ?? []).reduce(
          (sum: number, row) => sum + Number(row.amount_minor ?? 0),
          0,
        ),
      });

      const { count: jobsCompleted } = await admin
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("status", "done")
        .is("deleted_at", null)
        .gte("scheduled_date", period.start)
        .lte("scheduled_date", period.end);

      const digest = renderDigest({
        totals,
        period,
        locale,
        orgName: await nameOf(organizationId),
        format: (minor: number) => formatMoney(minor, { currency }) as string,
        reportUrl: origin ? `${origin}/reports` : "",
        counts: {
          openInvoices: (open ?? []).length,
          outstandingMinor: (open ?? []).reduce(
            (sum: number, row) => sum + Number(row.total_minor ?? 0),
            0,
          ),
          jobsCompleted: jobsCompleted ?? 0,
        },
      }) as { subject: string; body: string };

      const ids: string[] = Array.isArray(schedule.recipient_profile_ids)
        ? schedule.recipient_profile_ids.map(String)
        : [];
      const { data: recipients } = ids.length
        ? await admin
            .from("profiles")
            .select("id, active, notify_email, notify_email_opt_in")
            .in("id", ids)
            .eq("organization_id", organizationId)
        : { data: [] as any[] };

      let sent = 0;
      const problems: string[] = [];
      for (const profile of recipients ?? []) {
        // The SAME shared opt-out rule, so a teammate who turned alerts off is
        // skipped WITH a reason rather than mailed anyway. `staffContact`
        // resolves the address, because `profiles` has no email column — the
        // login address lives in auth.users.
        const eligibility = await staffContact(admin, profile);
        if (!eligibility.ok) {
          summary.skipped++;
          problems.push(`${profile.id}: ${eligibility.reason}`);
          continue;
        }
        try {
          await deliver(admin, {
            organizationId,
            channel: "email",
            to: eligibility.to!,
            body: digest.body,
            subject: digest.subject,
            relatedType: "report_digest",
            relatedId: schedule.id,
          });
          sent++;
        } catch (e: unknown) {
          problems.push(`${profile.id}: ${errorText(e)}`);
        }
      }

      if (!ids.length) problems.push("no recipients configured");

      // A digest that reached NOBODY is a failure, and the period claim is
      // released so it can be retried — otherwise the schedule would look sent.
      if (sent === 0) {
        await admin
          .from("report_deliveries")
          .update({
            status: "failed",
            reason: problems.join("; ").slice(0, 500) || "nobody was reached",
            recipients: 0,
            finished_at: new Date().toISOString(),
          })
          .eq("id", deliveryId);
        await admin
          .from("report_schedules")
          .update({
            last_run_at: new Date().toISOString(),
            last_error: problems.join("; ").slice(0, 500) || "nobody was reached",
          })
          .eq("id", schedule.id);
        summary.failed++;
        console.error(`[cron] report schedule ${schedule.id} reached nobody:`, problems.join("; "));
        continue;
      }

      await admin
        .from("report_deliveries")
        .update({
          status: "sent",
          recipients: sent,
          reason: problems.length ? problems.join("; ").slice(0, 500) : null,
          finished_at: new Date().toISOString(),
        })
        .eq("id", deliveryId);
      // Only NOW is the period marked claimed on the schedule, so a failure
      // above leaves it due rather than silently consumed.
      await admin
        .from("report_schedules")
        .update({
          last_period_key: period.key,
          last_run_at: new Date().toISOString(),
          last_error: problems.length ? problems.join("; ").slice(0, 500) : null,
        })
        .eq("id", schedule.id);
      summary.sent++;
      summary.recipients += sent;
    } catch (e: unknown) {
      summary.failed++;
      const reason = errorText(e);
      await admin
        .from("report_deliveries")
        .update({ status: "failed", reason, finished_at: new Date().toISOString() })
        .eq("id", deliveryId);
      await admin
        .from("report_schedules")
        .update({ last_error: reason, last_run_at: new Date().toISOString() })
        .eq("id", schedule.id);
      console.error(`[cron] report schedule ${schedule.id} failed:`, reason);
    }
  }

  return summary;
}
