import { createAdminClient } from "@/lib/supabase/admin";
import { providers, sendSms, sendEmail } from "@/lib/providers";
import { fillTemplate } from "@/lib/notify";
import { featureFlagEvaluator } from "@/lib/feature-flags";
// @ts-ignore -- shared JS module: the "Generate due" button uses the identical maths
import { RECURRING_JOB_SOURCE, nextDueAfter, recurringJobKey } from "@/lib/core/recurring.mjs";
// @ts-ignore -- shared JS module
import { isUniqueViolation } from "@/lib/core/db-errors.mjs";
// @ts-ignore -- shared JS module, proven both ways in tests/automation.test.mjs
import {
  AUTOMATION_MAX_ATTEMPTS, MESSAGE_ACTIONS, automationWindowStart, isStaleRun,
  nextRunAction, validateAutomationRule,
} from "@/lib/core/automation.mjs";
// @ts-ignore -- shared JS module, proven both ways in tests/outreach.test.mjs
import {
  INACTIVE_AFTER_DAYS, PAST_DUE_AFTER_DAYS, campaignChannels, contactEligibility,
  isKnownSegment, isoDaysBefore, truncateForSms,
} from "@/lib/core/outreach.mjs";
// @ts-ignore -- shared JS module
import { escapeHtml } from "@/lib/core/security.mjs";

const dayISO = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };

/**
 * Create jobs for every maintenance plan that's due (all orgs), and roll each
 * plan PAST today. Advancing by one interval left an overdue plan overdue, so
 * the nightly run kept minting another back-dated job for it every night.
 */
export async function runRecurringGeneration(): Promise<number> {
  const admin = createAdminClient();
  const today = dayISO(0);
  const { data: due } = await admin.from("recurring_plans").select("*").eq("active", true).lte("next_due", today);
  let created = 0;
  for (const p of due ?? []) {
    const dueDate = String(p.next_due);
    const { error } = await admin.from("jobs").insert({
      organization_id: p.organization_id, created_by: p.created_by, customer_id: p.customer_id,
      assigned_to: p.assigned_to, service: p.service, price_minor: p.price_minor,
      scheduled_date: dueDate, end_date: dueDate, source: "Maintenance plan",
      external_source: RECURRING_JOB_SOURCE, external_id: recurringJobKey(p.id, dueDate),
    });
    // 23505 = uq_jobs_external_source: the button already generated this
    // occurrence. Roll the plan forward regardless, or it never stops being due.
    if (error && !isUniqueViolation(error)) continue;
    if (!error) created++;
    await admin.from("recurring_plans")
      .update({ next_due: nextDueAfter(dueDate, p.interval_months, today) })
      .eq("id", p.id);
  }
  return created;
}

/** Send day-before appointment reminders + weekly overdue-invoice nudges (SMS). */
export async function runReminders(): Promise<{ appointments: number; overdue: number }> {
  if (!providers.sms()) return { appointments: 0, overdue: 0 };
  const admin = createAdminClient();
  const today = dayISO(0), tomorrow = dayISO(1), weekAgo = dayISO(-7);
  let appointments = 0, overdue = 0;

  // --- Appointment reminders (jobs scheduled tomorrow) ---
  const { data: jobs } = await admin.from("jobs")
    .select("id, service, scheduled_date, start_time, organization_id, customers(name, phone, sms_opt_in)")
    .eq("scheduled_date", tomorrow).eq("status", "scheduled").is("deleted_at", null);
  for (const j of jobs ?? []) {
    const cust: any = (j as any).customers;
    if (!cust?.phone || cust.phone === "—") continue;
    if (cust.sms_opt_in === false) continue; // customer replied STOP
    const { data: tpl } = await admin.from("message_templates").select("enabled, body").eq("organization_id", j.organization_id).eq("trigger", "day_before").maybeSingle();
    if (!tpl?.enabled || !tpl.body) continue;
    // Claim the slot first so two concurrent runs cannot both send...
    const { error: dupe } = await admin.from("reminder_log").insert({ organization_id: j.organization_id, kind: "appointment", ref_id: j.id, sent_on: today });
    if (dupe) continue; // already sent today
    const { data: org } = await admin.from("organizations").select("name").eq("id", j.organization_id).single();
    const body = fillTemplate(tpl.body, { name: (cust.name ?? "").split(" ")[0] ?? "", service: j.service ?? "", date: j.scheduled_date ?? "", time: (j.start_time ?? "").slice(0, 5), business: org?.name ?? "" });
    try {
      const sid = await sendSms(cust.phone, body);
      await admin.from("sms_messages").insert({ organization_id: j.organization_id, job_id: j.id, to_phone: cust.phone, body, provider: "twilio", provider_message_id: sid, status: "sent", sent_at: new Date().toISOString() });
      appointments++;
    } catch (e: unknown) {
      // ...but RELEASE it on failure, or a transient provider error would
      // suppress this reminder permanently — it could never be retried.
      await admin.from("reminder_log").delete().eq("organization_id", j.organization_id).eq("kind", "appointment").eq("ref_id", j.id).eq("sent_on", today);
      console.error(`[cron] appointment reminder failed for job ${j.id}:`, e instanceof Error ? e.message : String(e));
    }
  }

  // --- Overdue invoice nudges (unpaid > 14 days, at most weekly) ---
  const { data: invs } = await admin.from("invoices")
    .select("id, number, issue_date, organization_id, customers(name, phone, sms_opt_in)")
    .eq("status", "unpaid").is("deleted_at", null).lte("issue_date", dayISO(-14));
  for (const inv of invs ?? []) {
    const cust: any = (inv as any).customers;
    if (!cust?.phone || cust.phone === "—") continue;
    if (cust.sms_opt_in === false) continue; // customer replied STOP
    const { data: recent } = await admin.from("reminder_log").select("id").eq("kind", "overdue").eq("ref_id", inv.id).gte("sent_on", weekAgo).limit(1);
    if (recent && recent.length) continue;
    const { error: dupe } = await admin.from("reminder_log").insert({ organization_id: inv.organization_id, kind: "overdue", ref_id: inv.id, sent_on: today });
    if (dupe) continue;
    const { data: org } = await admin.from("organizations").select("name").eq("id", inv.organization_id).single();
    const body = `Friendly reminder from ${org?.name}: invoice #${inv.number} is past due. Please let us know if you have any questions — thank you!`;
    try {
      const sid = await sendSms(cust.phone, body);
      await admin.from("sms_messages").insert({ organization_id: inv.organization_id, to_phone: cust.phone, body, provider: "twilio", provider_message_id: sid, status: "sent", sent_at: new Date().toISOString() });
      overdue++;
    } catch (e: unknown) {
      // Release the claim so a transient failure can be retried next run.
      await admin.from("reminder_log").delete().eq("organization_id", inv.organization_id).eq("kind", "overdue").eq("ref_id", inv.id).eq("sent_on", today);
      console.error(`[cron] overdue nudge failed for invoice ${inv.id}:`, e instanceof Error ? e.message : String(e));
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
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
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
  organizationId: string; channel: "sms" | "email"; to: string; body: string;
  subject?: string; customerId?: string | null; jobId?: string | null;
  relatedType?: string; relatedId?: string | null;
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
        organization_id: opts.organizationId, customer_id: opts.customerId ?? null, job_id: opts.jobId ?? null,
        to_phone: opts.to, body, provider: "twilio", provider_message_id: sid, status: "sent", sent_at: sentAt,
      });
      return sid;
    } catch (e: unknown) {
      await admin.from("sms_messages").insert({
        organization_id: opts.organizationId, customer_id: opts.customerId ?? null, job_id: opts.jobId ?? null,
        to_phone: opts.to, body, provider: "twilio", status: "failed", error: errorText(e),
      });
      throw e;
    }
  }
  const subject = opts.subject ?? "";
  try {
    const id = await sendEmail(opts.to, subject, htmlBody(opts.body));
    await admin.from("email_messages").insert({
      organization_id: opts.organizationId, related_type: opts.relatedType ?? null, related_id: opts.relatedId ?? null,
      to_email: opts.to, subject, provider: "resend", provider_message_id: id, status: "sent", sent_at: sentAt,
    });
    return id;
  } catch (e: unknown) {
    await admin.from("email_messages").insert({
      organization_id: opts.organizationId, related_type: opts.relatedType ?? null, related_id: opts.relatedId ?? null,
      to_email: opts.to, subject, provider: "resend", status: "failed", error: errorText(e),
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
    const { data } = await admin.from("organizations").select("name").eq("id", organizationId).maybeSingle();
    const name = data?.name ?? "";
    cache.set(organizationId, name);
    return name;
  };
}

const CUSTOMER_CONTACT = "id, name, phone, email, sms_opt_in, email_opt_in, deleted_at";
/** Bound on rows examined per rule per night. A cron that scans without a limit is a future outage. */
const AUTOMATION_SOURCE_LIMIT = 200;

type AutomationSource = {
  id: string; customer: any; vars: Record<string, string>; jobId: string | null;
  label: string; link: string;
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
  admin: Admin, rule: any, overdueDays: number, windowStart: string, nowISO: string,
): Promise<AutomationSource[]> {
  const origin = appOrigin();
  if (rule.trigger_type === "job_completed") {
    const { data } = await admin.from("jobs")
      .select(`id, service, scheduled_date, start_time, customer_id, customers(${CUSTOMER_CONTACT})`)
      .eq("organization_id", rule.organization_id).eq("status", "done").is("deleted_at", null)
      .gte("updated_at", windowStart).lte("updated_at", nowISO)
      .order("updated_at", { ascending: false }).limit(AUTOMATION_SOURCE_LIMIT);
    return (data ?? []).map((row: any) => ({
      id: row.id, customer: row.customers, jobId: row.id, label: "job",
      link: "",
      vars: { service: row.service ?? "", date: row.scheduled_date ?? "", time: String(row.start_time ?? "").slice(0, 5), number: "" },
    }));
  }
  if (rule.trigger_type === "estimate_sent") {
    const { data } = await admin.from("estimates")
      .select(`id, number, public_token, customer_id, customers(${CUSTOMER_CONTACT})`)
      .eq("organization_id", rule.organization_id).eq("status", "sent").is("deleted_at", null)
      .gte("updated_at", windowStart).lte("updated_at", nowISO)
      .order("updated_at", { ascending: false }).limit(AUTOMATION_SOURCE_LIMIT);
    return (data ?? []).map((row: any) => ({
      id: row.id, customer: row.customers, jobId: null, label: "estimate",
      link: origin && row.public_token ? `${origin}/p/${row.public_token}` : "",
      vars: { number: String(row.number ?? ""), service: "", date: "", time: "" },
    }));
  }
  // invoice_overdue is time-based: an invoice nobody touches still becomes
  // overdue, so eligibility is issue_date + overdueDays, not updated_at.
  const windowStartDate = windowStart.slice(0, 10);
  const { data } = await admin.from("invoices")
    .select(`id, number, issue_date, public_token, job_id, customer_id, customers(${CUSTOMER_CONTACT})`)
    .eq("organization_id", rule.organization_id).eq("status", "unpaid").is("deleted_at", null)
    .gte("issue_date", isoDaysBefore(windowStartDate, overdueDays))
    .lte("issue_date", isoDaysBefore(nowISO.slice(0, 10), overdueDays))
    .order("issue_date", { ascending: false }).limit(AUTOMATION_SOURCE_LIMIT);
  return (data ?? []).map((row: any) => ({
    id: row.id, customer: row.customers, jobId: row.job_id ?? null, label: "invoice",
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
  admin: Admin, rule: any, message: string, source: AutomationSource, businessName: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (rule.action_type === "create_task") {
    // job_tasks.job_id is NOT NULL; validateAutomationRule only ever allows
    // create_task for the job_completed trigger, so this is always present.
    if (!source.jobId) return { ok: false, reason: "no_job_for_task" };
    const { error } = await admin.from("job_tasks").insert({
      organization_id: rule.organization_id, job_id: source.jobId, title: message.slice(0, 200),
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
    organizationId: rule.organization_id, channel, to: eligibility.to, body,
    subject: `${businessName}`.trim() || "A message from your service provider",
    customerId: source.customer ? (source.customer.id ?? null) : null,
    jobId: source.jobId, relatedType: `automation_${source.label}`, relatedId: null,
  });
  return { ok: true };
}

export type AutomationRunSummary = {
  rules: number; fired: number; skipped: number; failed: number;
  invalidRules: number; flagDisabled: number; providerMissing: number; stuck: number;
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
    rules: 0, fired: 0, skipped: 0, failed: 0, invalidRules: 0, flagDisabled: 0, providerMissing: 0, stuck: 0,
  };

  const { data: rules } = await admin.from("automation_rules")
    .select("id, organization_id, trigger_type, action_type, action_json, condition_json, created_at")
    .eq("enabled", true).order("created_at", { ascending: true }).limit(500);

  for (const rule of rules ?? []) {
    if (!enabledFor(rule.organization_id)) { summary.flagDisabled++; continue; }

    // Rules created before validation existed can still be malformed. Report
    // them every night rather than skipping them in silence.
    const validation = validateAutomationRule({
      triggerType: rule.trigger_type, actionType: rule.action_type,
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
        console.warn(`[cron] automation rule ${rule.id} needs a ${rule.action_type === "send_sms" ? "SMS" : "email"} provider that is not configured`);
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
      console.warn(`[cron] automation rule ${rule.id} hit the ${AUTOMATION_SOURCE_LIMIT}-row scan limit; remaining rows run tomorrow`);
    }

    for (const source of sources) {
      const { data: existing } = await admin.from("automation_runs")
        .select("id, status, attempts, created_at").eq("rule_id", rule.id).eq("source_id", source.id).maybeSingle();
      const decision = nextRunAction(existing, AUTOMATION_MAX_ATTEMPTS);
      if (decision === "skip") {
        if (isStaleRun(existing, nowISO)) {
          summary.stuck++;
          console.error(`[cron] automation run ${existing!.id} has been 'running' since ${existing!.created_at}; it will not be re-fired automatically because nobody can tell whether the message went out`);
        }
        continue;
      }

      let runId: string | null = null;
      if (decision === "claim") {
        const { data: claimed, error: claimError } = await admin.from("automation_runs").insert({
          organization_id: rule.organization_id, rule_id: rule.id, source_type: source.label,
          source_id: source.id, status: "running", attempts: 1,
        }).select("id").maybeSingle();
        // A unique violation means a concurrent run won the race — correct, not an error.
        if (claimError) {
          if (!isUniqueViolation(claimError)) console.error(`[cron] could not claim automation run for rule ${rule.id}:`, claimError.message);
          continue;
        }
        runId = claimed?.id ?? null;
      } else {
        // Compare-and-set: only the worker that flips 'failed' → 'running' owns it.
        const { data: retried } = await admin.from("automation_runs")
          .update({ status: "running", attempts: Number(existing!.attempts ?? 0) + 1, error_message: null, finished_at: null })
          .eq("id", existing!.id).eq("status", "failed").select("id").maybeSingle();
        if (!retried) continue;
        runId = retried.id;
      }
      if (!runId) continue;

      try {
        const outcome = await runAutomationAction(admin, rule, message, source, businessName);
        if (outcome.ok) {
          summary.fired++;
          await admin.from("automation_runs").update({ status: "succeeded", finished_at: new Date().toISOString() }).eq("id", runId);
        } else {
          // A skip is terminal and CARRIES ITS REASON: "we did not text this
          // customer because they replied STOP" must be readable afterwards.
          summary.skipped++;
          await admin.from("automation_runs").update({ status: "skipped", error_message: outcome.reason, finished_at: new Date().toISOString() }).eq("id", runId);
        }
      } catch (e: unknown) {
        summary.failed++;
        const message = errorText(e);
        await admin.from("automation_runs").update({ status: "failed", error_message: message, finished_at: new Date().toISOString() }).eq("id", runId);
        console.error(`[cron] automation rule ${rule.id} failed on ${source.label} ${source.id}:`, message);
      }
    }

    await admin.from("automation_rules").update({ last_run_at: new Date().toISOString() }).eq("id", rule.id);
  }
  return summary;
}

// ---------------------------------------------------------------------
//  Campaigns and estimate follow-ups (ledger 5.9).
// ---------------------------------------------------------------------

const CAMPAIGN_RECIPIENT_LIMIT = 1000;

/** Customers a campaign segment resolves to. Every segment is defined, none is a silent "everyone". */
async function campaignAudience(admin: Admin, organizationId: string, segment: string): Promise<any[]> {
  const today = dayISO(0);
  if (segment === "past_due") {
    // Same definition the overdue nudge uses: unpaid, issued at least 14 days ago.
    const { data: invoices } = await admin.from("invoices")
      .select("customer_id").eq("organization_id", organizationId).eq("status", "unpaid")
      .is("deleted_at", null).lte("issue_date", isoDaysBefore(today, PAST_DUE_AFTER_DAYS)).limit(CAMPAIGN_RECIPIENT_LIMIT);
    const ids = [...new Set((invoices ?? []).map((row: any) => row.customer_id).filter(Boolean))];
    if (!ids.length) return [];
    const { data } = await admin.from("customers")
      .select(`${CUSTOMER_CONTACT}`).eq("organization_id", organizationId)
      .is("deleted_at", null).eq("archived", false).in("id", ids).limit(CAMPAIGN_RECIPIENT_LIMIT);
    return data ?? [];
  }
  if (segment === "inactive") {
    // No work in the last year. Computed by exclusion so a customer with a
    // recent job cannot slip in through a stale cache.
    const { data: recent } = await admin.from("jobs")
      .select("customer_id").eq("organization_id", organizationId).is("deleted_at", null)
      .gte("scheduled_date", isoDaysBefore(today, INACTIVE_AFTER_DAYS)).limit(5000);
    const active = new Set((recent ?? []).map((row: any) => row.customer_id));
    const { data } = await admin.from("customers")
      .select(`${CUSTOMER_CONTACT}`).eq("organization_id", organizationId)
      .is("deleted_at", null).eq("archived", false).limit(CAMPAIGN_RECIPIENT_LIMIT);
    return (data ?? []).filter((row: any) => !active.has(row.id));
  }
  const { data } = await admin.from("customers")
    .select(`${CUSTOMER_CONTACT}`).eq("organization_id", organizationId)
    .is("deleted_at", null).eq("archived", false).limit(CAMPAIGN_RECIPIENT_LIMIT);
  return data ?? [];
}

export type OutreachSummary = {
  campaigns: number; campaignMessages: number; campaignSkipped: number; campaignFailed: number;
  followupsSent: number; followupsSkipped: number; followupsFailed: number; flagDisabled: number; invalid: number;
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
    campaigns: 0, campaignMessages: 0, campaignSkipped: 0, campaignFailed: 0,
    followupsSent: 0, followupsSkipped: 0, followupsFailed: 0, flagDisabled: 0, invalid: 0,
  };

  // --- Campaigns due to go out -------------------------------------------
  const { data: campaigns } = await admin.from("campaigns")
    .select("id, organization_id, name, channel, subject, body, audience_json, scheduled_at, status")
    .eq("status", "scheduled").lte("scheduled_at", nowISO)
    .order("scheduled_at", { ascending: true }).limit(20);

  for (const campaign of campaigns ?? []) {
    if (!enabledFor(campaign.organization_id)) { summary.flagDisabled++; continue; }
    const segment = String((campaign.audience_json as any)?.segment ?? "all_customers");
    const channels: ("sms" | "email")[] = campaignChannels(campaign.channel);
    if (!channels.length || !isKnownSegment(segment)) {
      summary.invalid++;
      console.error(`[cron] campaign ${campaign.id} has an unsupported channel/segment (${campaign.channel}/${segment}); left scheduled`);
      continue;
    }
    // A campaign whose provider is not connected stays 'scheduled' and says so.
    const usable = channels.filter((channel) => (channel === "sms" ? providers.sms() : providers.email()));
    if (!usable.length) {
      summary.invalid++;
      console.warn(`[cron] campaign ${campaign.id} needs a provider that is not configured; left scheduled`);
      continue;
    }

    // Claim the campaign itself: only the worker that flips 'scheduled' →
    // 'sending' builds the audience.
    const { data: claimed } = await admin.from("campaigns")
      .update({ status: "sending" }).eq("id", campaign.id).eq("status", "scheduled").select("id").maybeSingle();
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
          const { data: existing } = await admin.from("campaign_deliveries")
            .select("id, status, attempts").eq("campaign_id", campaign.id)
            .eq("customer_id", customer.id).eq("channel", channel).maybeSingle();
          const decision = nextRunAction(existing, AUTOMATION_MAX_ATTEMPTS);
          if (decision === "skip") continue;

          let deliveryId: string | null = null;
          if (decision === "claim") {
            const { data: row, error } = await admin.from("campaign_deliveries").insert({
              organization_id: campaign.organization_id, campaign_id: campaign.id,
              customer_id: customer.id, channel, status: "running", attempts: 1,
            }).select("id").maybeSingle();
            if (error) { if (!isUniqueViolation(error)) console.error(`[cron] campaign ${campaign.id} claim failed:`, error.message); continue; }
            deliveryId = row?.id ?? null;
          } else {
            const { data: row } = await admin.from("campaign_deliveries")
              .update({ status: "running", attempts: Number(existing!.attempts ?? 0) + 1, reason: null, finished_at: null })
              .eq("id", existing!.id).eq("status", "failed").select("id").maybeSingle();
            if (!row) continue;
            deliveryId = row.id;
          }
          if (!deliveryId) continue;

          const eligibility = contactEligibility(customer, channel);
          if (!eligibility.ok) {
            summary.campaignSkipped++;
            await admin.from("campaign_deliveries")
              .update({ status: "skipped", reason: eligibility.reason, finished_at: new Date().toISOString() })
              .eq("id", deliveryId);
            continue;
          }
          const body = fillTemplate(campaign.body ?? "", {
            name: String(customer.name ?? "").split(" ")[0] ?? "", business: businessName,
            service: "", date: "", time: "", number: "", link: "",
          });
          try {
            await deliver(admin, {
              organizationId: campaign.organization_id, channel, to: eligibility.to, body,
              subject: campaign.subject || campaign.name || businessName,
              customerId: customer.id, relatedType: "campaign", relatedId: campaign.id,
            });
            summary.campaignMessages++;
            await admin.from("campaign_deliveries")
              .update({ status: "sent", finished_at: new Date().toISOString() }).eq("id", deliveryId);
          } catch (e: unknown) {
            summary.campaignFailed++;
            retryable = true;
            await admin.from("campaign_deliveries")
              .update({ status: "failed", reason: errorText(e), finished_at: new Date().toISOString() }).eq("id", deliveryId);
            console.error(`[cron] campaign ${campaign.id} could not reach customer ${customer.id} by ${channel}:`, errorText(e));
          }
        }
      }
    } catch (e: unknown) {
      retryable = true;
      console.error(`[cron] campaign ${campaign.id} failed while building its audience:`, errorText(e));
    }

    const { count } = await admin.from("campaign_deliveries")
      .select("id", { count: "exact", head: true }).eq("campaign_id", campaign.id).eq("status", "sent");
    // Anything still retryable goes BACK to 'scheduled' rather than being
    // declared sent — a campaign stuck in 'sending' would be a silent failure,
    // and the per-recipient claims mean the retry cannot duplicate a message.
    await admin.from("campaigns")
      .update({ status: retryable ? "scheduled" : "sent", sent_count: count ?? 0 }).eq("id", campaign.id);
  }

  // --- Estimate follow-ups -----------------------------------------------
  const { data: followups } = await admin.from("estimate_followups")
    .select("id, organization_id, estimate_id, channel, scheduled_at, attempts")
    .eq("status", "scheduled").lte("scheduled_at", nowISO)
    .order("scheduled_at", { ascending: true }).limit(200);

  const origin = appOrigin();
  for (const followup of followups ?? []) {
    if (!enabledFor(followup.organization_id)) { summary.flagDisabled++; continue; }
    const channel: "sms" | "email" = followup.channel === "sms" ? "sms" : "email";
    if (channel === "sms" ? !providers.sms() : !providers.email()) {
      summary.invalid++;
      console.warn(`[cron] estimate follow-up ${followup.id} needs a ${channel} provider that is not configured; left scheduled`);
      continue;
    }
    const attempts = Number(followup.attempts ?? 0) + 1;
    // Claim by leaving 'scheduled'. Only one worker can win this update.
    const { data: claimed } = await admin.from("estimate_followups")
      .update({ status: "sent", attempts, sent_at: new Date().toISOString() })
      .eq("id", followup.id).eq("status", "scheduled").select("id").maybeSingle();
    if (!claimed) continue;

    const release = async (message: string) => {
      // Retry while there is budget, then fail VISIBLY with the reason —
      // never retry for ever, never lose it.
      const exhausted = attempts >= AUTOMATION_MAX_ATTEMPTS;
      await admin.from("estimate_followups")
        .update({ status: exhausted ? "failed" : "scheduled", error_message: message, sent_at: null })
        .eq("id", followup.id);
      summary.followupsFailed++;
      console.error(`[cron] estimate follow-up ${followup.id} failed (attempt ${attempts}${exhausted ? ", giving up" : ""}):`, message);
    };

    try {
      const { data: estimate } = await admin.from("estimates")
        .select(`id, number, public_token, customer_id, customers(${CUSTOMER_CONTACT})`)
        .eq("id", followup.estimate_id).is("deleted_at", null).maybeSingle();
      if (!estimate) { await release("estimate not found"); continue; }
      const eligibility = contactEligibility((estimate as any).customers, channel);
      if (!eligibility.ok) {
        // Consent refusal is terminal and named — not a retry, not a silence.
        await admin.from("estimate_followups")
          .update({ status: "cancelled", error_message: eligibility.reason, sent_at: null }).eq("id", followup.id);
        summary.followupsSkipped++;
        continue;
      }
      const businessName = await nameOf(followup.organization_id);
      const link = origin && (estimate as any).public_token ? `${origin}/p/${(estimate as any).public_token}` : "";
      const first = String((estimate as any).customers?.name ?? "").split(" ")[0] ?? "";
      const body = `Hi ${first}, just following up on estimate #${(estimate as any).number} from ${businessName}.`
        + (link ? ` You can review and approve it here: ${link}` : "")
        + " Let us know if you have any questions — thank you!";
      await deliver(admin, {
        organizationId: followup.organization_id, channel, to: eligibility.to, body,
        subject: `${businessName} — estimate #${(estimate as any).number}`,
        customerId: (estimate as any).customer_id ?? null,
        relatedType: "estimate_followup", relatedId: followup.estimate_id,
      });
      summary.followupsSent++;
    } catch (e: unknown) {
      await release(errorText(e));
    }
  }

  return summary;
}
