/**
 * Query shapes for the backend/background surface: cron tasks, notifications,
 * push, activity/history, data retention, platform admin, the payments money
 * path, and the API routes under `app/api/**`.
 *
 * These do not belong in the screen-facing repositories (`lib/data/*.ts`)
 * because their shapes are particular to a background job or a webhook — an
 * admin-client cross-tenant read with an explicit `organization_id` filter,
 * or a table no screen repository touches. See `lib/data/db.ts` for why
 * nothing here applies its own range, and for how errors and row-level
 * security are handled: every function below THROWS `DataError` on a query
 * error rather than returning `[]`, so a cron loop or a route handler that
 * used to see a quiet empty list now sees a real failure it can log and,
 * where the call site processes many organisations, skip past.
 */

import type { ServerClient } from "@/lib/supabase/server";
import { readAll, readAtMost } from "./db";
import { COLLECTED_STATUSES } from "./payments";

const CUSTOMER = "customers!jobs_customer_org_fk";
const INVOICE_CUSTOMER = "customers!invoices_customer_org_fk";
const ESTIMATE_CUSTOMER = "customers!estimates_customer_org_fk";

// ===========================================================================
// lib/cron-tasks.ts
// ===========================================================================

/** Jobs scheduled for one day, with the contact columns the day-before SMS needs. */
export function listJobsForDayBeforeReminder(supabase: ServerClient, date: string) {
  return readAll("backend.listJobsForDayBeforeReminder", () =>
    supabase
      .from("jobs")
      .select(
        `id, service, scheduled_date, start_time, organization_id, ${CUSTOMER}(name, phone, sms_opt_in)`,
      )
      .eq("scheduled_date", date)
      .eq("status", "scheduled")
      .is("deleted_at", null),
  );
}

/** Unpaid invoices older than a cutoff, with the contact columns the overdue nudge needs. */
export function listOverdueInvoicesForNudge(supabase: ServerClient, cutoffDate: string) {
  return readAll("backend.listOverdueInvoicesForNudge", () =>
    supabase
      .from("invoices")
      .select(
        `id, number, issue_date, organization_id, ${INVOICE_CUSTOMER}(name, phone, sms_opt_in)`,
      )
      .eq("status", "unpaid")
      .is("deleted_at", null)
      .lte("issue_date", cutoffDate),
  );
}

/** The contact columns every automation/outreach/dunning source embed reads. Kept as one string so it cannot drift. */
const CUSTOMER_CONTACT = "id, name, phone, email, sms_opt_in, email_opt_in, deleted_at";

/** Enabled automation rules, oldest first — the nightly runner's work list. */
export function listAutomationRules(supabase: ServerClient, limit: number) {
  return readAtMost(
    "backend.listAutomationRules",
    () =>
      supabase
        .from("automation_rules")
        .select(
          "id, organization_id, trigger_type, action_type, action_json, condition_json, created_at",
        )
        .eq("enabled", true)
        .order("created_at", { ascending: true }),
    limit,
  );
}

// NOTE: the three per-rule automation-source reads (jobs/estimates/invoices
// for job_completed / estimate_sent / invoice_overdue) are deliberately kept
// INLINE in lib/cron-tasks.ts rather than centralised here — see the comment
// at that call site. tests/automation.test.mjs reads that file's own source
// for the literal ".limit(AUTOMATION_SOURCE_LIMIT)" text.

/** Customer ids behind unpaid invoices older than a cutoff — the `past_due` campaign segment. */
export function listPastDueInvoiceCustomerIds(
  supabase: ServerClient,
  organizationId: string,
  cutoffDate: string,
  limit: number,
) {
  return readAtMost(
    "backend.listPastDueInvoiceCustomerIds",
    () =>
      supabase
        .from("invoices")
        .select("customer_id")
        .eq("organization_id", organizationId)
        .eq("status", "unpaid")
        .is("deleted_at", null)
        .lte("issue_date", cutoffDate),
    limit,
  );
}

/** Customer ids with a job scheduled since a cutoff — used to EXCLUDE them from the `inactive` campaign segment. */
export function listRecentJobCustomerIds(
  supabase: ServerClient,
  organizationId: string,
  cutoffDate: string,
  limit: number,
) {
  return readAtMost(
    "backend.listRecentJobCustomerIds",
    () =>
      supabase
        .from("jobs")
        .select("customer_id")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .gte("scheduled_date", cutoffDate),
    limit,
  );
}

/** Contactable customers by id — the `past_due` campaign segment's recipient rows. */
export function listOutreachCustomersByIds(
  supabase: ServerClient,
  organizationId: string,
  ids: string[],
  limit: number,
) {
  if (!ids.length) return Promise.resolve([]);
  return readAtMost(
    "backend.listOutreachCustomersByIds",
    () =>
      supabase
        .from("customers")
        .select(CUSTOMER_CONTACT)
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .eq("archived", false)
        .in("id", ids),
    limit,
  );
}

/** Every contactable customer — the `inactive` and `all_customers` campaign segments. */
export function listOutreachCustomers(
  supabase: ServerClient,
  organizationId: string,
  limit: number,
) {
  return readAtMost(
    "backend.listOutreachCustomers",
    () =>
      supabase
        .from("customers")
        .select(CUSTOMER_CONTACT)
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .eq("archived", false),
    limit,
  );
}

/** Campaigns due to go out — the outreach runner's work list. */
export function listDueCampaigns(supabase: ServerClient, nowISO: string, limit: number) {
  return readAtMost(
    "backend.listDueCampaigns",
    () =>
      supabase
        .from("campaigns")
        .select(
          "id, organization_id, name, channel, subject, body, audience_json, scheduled_at, status",
        )
        .eq("status", "scheduled")
        .lte("scheduled_at", nowISO)
        .order("scheduled_at", { ascending: true }),
    limit,
  );
}

/** Estimate follow-ups due to go out — the outreach runner's second work list. */
export function listDueEstimateFollowups(supabase: ServerClient, nowISO: string, limit: number) {
  return readAtMost(
    "backend.listDueEstimateFollowups",
    () =>
      supabase
        .from("estimate_followups")
        .select("id, organization_id, estimate_id, channel, scheduled_at, attempts")
        .eq("status", "scheduled")
        .lte("scheduled_at", nowISO)
        .order("scheduled_at", { ascending: true }),
    limit,
  );
}

/**
 * Unpaid invoices old enough to dun — the nightly dunning walk's work list.
 *
 * The sharpest paging risk in the file this feeds: each row read fires at
 * most one dunning rung. Rows past a silent 1000-row cap would simply never
 * be dunned, with nothing to say so.
 */
export function listDunningCandidateInvoices(
  supabase: ServerClient,
  cutoffDate: string,
  limit: number,
) {
  return readAtMost(
    "backend.listDunningCandidateInvoices",
    () =>
      supabase
        .from("invoices")
        .select(
          `id, number, organization_id, issue_date, total_minor, public_token, customer_id, ${INVOICE_CUSTOMER}(${CUSTOMER_CONTACT})`,
        )
        .eq("status", "unpaid")
        .is("deleted_at", null)
        .lte("issue_date", cutoffDate)
        .order("issue_date", { ascending: true }),
    limit,
  );
}

/** Settled payment amounts against one invoice — what an outstanding-balance figure is computed from. */
export function listSettledPaymentAmountsForInvoice(supabase: ServerClient, invoiceId: string) {
  return readAll("backend.listSettledPaymentAmountsForInvoice", () =>
    supabase
      .from("payments")
      .select("base_amount_minor, amount_minor, refunded_minor, normalized_status")
      .eq("invoice_id", invoiceId)
      .in("normalized_status", [...COLLECTED_STATUSES]),
  );
}

/** Every dunning rung already recorded against one invoice. */
export function listDunningHistoryForInvoice(supabase: ServerClient, invoiceId: string) {
  return readAll("backend.listDunningHistoryForInvoice", () =>
    supabase
      .from("dunning_events")
      .select("stage, status, attempts, id")
      .eq("invoice_id", invoiceId),
  );
}

/** Enabled report schedules — the scheduled-report runner's work list. */
export function listReportSchedulesDue(supabase: ServerClient, limit: number) {
  return readAtMost(
    "backend.listReportSchedulesDue",
    () =>
      supabase
        .from("report_schedules")
        .select(
          "id, organization_id, name, frequency, enabled, recipient_profile_ids, starts_on, last_period_key",
        )
        .eq("enabled", true),
    limit,
  );
}

/** Paid invoices in a window for one organisation — the digest's revenue side. */
export function listPaidInvoicesForOrgWindow(
  supabase: ServerClient,
  organizationId: string,
  start: string,
  end: string,
  limit: number,
) {
  return readAtMost(
    "backend.listPaidInvoicesForOrgWindow",
    () =>
      supabase
        .from("invoices")
        .select("id, total_minor, discount_minor, tax_rate_bps, issue_date")
        .eq("organization_id", organizationId)
        .eq("status", "paid")
        .is("deleted_at", null)
        .gte("issue_date", start)
        .lte("issue_date", end),
    limit,
  );
}

/** Collected payments in a window for one organisation — the digest's cash side. */
export function listCollectedPaymentsForOrgWindow(
  supabase: ServerClient,
  organizationId: string,
  start: string,
  end: string,
  limit: number,
) {
  return readAtMost(
    "backend.listCollectedPaymentsForOrgWindow",
    () =>
      supabase
        .from("payments")
        .select("invoice_id, base_amount_minor, amount_minor, refunded_minor, normalized_status")
        .eq("organization_id", organizationId)
        .in("normalized_status", [...COLLECTED_STATUSES])
        .gte("paid_at", `${start}T00:00:00`)
        .lte("paid_at", `${end}T23:59:59`),
    limit,
  );
}

/** Expense amounts in a window for one organisation — what the digest subtracts. */
export function listExpenseAmountsForOrgWindow(
  supabase: ServerClient,
  organizationId: string,
  start: string,
  end: string,
  limit: number,
) {
  return readAtMost(
    "backend.listExpenseAmountsForOrgWindow",
    () =>
      supabase
        .from("expenses")
        .select("amount_minor")
        .eq("organization_id", organizationId)
        .gte("expense_date", start)
        .lte("expense_date", end),
    limit,
  );
}

/** Unpaid invoice totals for one organisation — the digest's outstanding figure. */
export function listUnpaidInvoiceTotalsForOrg(
  supabase: ServerClient,
  organizationId: string,
  limit: number,
) {
  return readAtMost(
    "backend.listUnpaidInvoiceTotalsForOrg",
    () =>
      supabase
        .from("invoices")
        .select("total_minor")
        .eq("organization_id", organizationId)
        .eq("status", "unpaid")
        .is("deleted_at", null),
    limit,
  );
}

/** The report schedule's chosen recipients, resolved to the columns `staffContact` needs. */
export function listReportRecipientProfiles(
  supabase: ServerClient,
  organizationId: string,
  ids: string[],
) {
  if (!ids.length) return Promise.resolve([]);
  return readAll("backend.listReportRecipientProfiles", () =>
    supabase
      .from("profiles")
      .select("id, active, notify_email, notify_email_opt_in")
      .in("id", ids)
      .eq("organization_id", organizationId),
  );
}

// ===========================================================================
// lib/data-retention.ts
// ===========================================================================

/** Every organisation that has opted into automatic data retention enforcement — the nightly sweep's work list. */
export function listOrgsWithAutoRetention(supabase: ServerClient) {
  return readAll("backend.listOrgsWithAutoRetention", () =>
    supabase
      .from("organization_privacy_settings")
      .select("organization_id")
      .eq("auto_enforce", true),
  );
}

/** Active retention holds for one organisation — what a retention sweep must not touch. */
export function listActiveRetentionHolds(
  supabase: ServerClient,
  organizationId: string,
  nowISO: string,
) {
  return readAll("backend.listActiveRetentionHolds", () =>
    supabase
      .from("retention_holds")
      .select("category,customer_id")
      .eq("organization_id", organizationId)
      .is("released_at", null)
      .or(`expires_at.is.null,expires_at.gt.${nowISO}`),
  );
}

// ===========================================================================
// lib/push.ts / lib/notify.ts
// ===========================================================================

/** A teammate's enabled push subscriptions — every device a notification fans out to. */
export function listEnabledDeviceSubscriptions(
  supabase: ServerClient,
  organizationId: string,
  profileId: string,
) {
  return readAll("backend.listEnabledDeviceSubscriptions", () =>
    supabase
      .from("device_subscriptions")
      .select("id, endpoint, p256dh, auth_secret, locale")
      .eq("organization_id", organizationId)
      .eq("profile_id", profileId)
      .eq("enabled", true),
  );
}

/** Every profile in an organisation, bounded — a payment notification's candidate recipients. */
export function listOrgProfilesForNotify(
  supabase: ServerClient,
  organizationId: string,
  limit: number,
) {
  return readAtMost(
    "backend.listOrgProfilesForNotify",
    () =>
      supabase.from("profiles").select("id, role, active").eq("organization_id", organizationId),
    limit,
  );
}

/** Payment-management capability rows for a set of profiles. */
export function listPaymentCapabilities(supabase: ServerClient, profileIds: string[]) {
  if (!profileIds.length) return Promise.resolve([]);
  return readAll("backend.listPaymentCapabilities", () =>
    supabase
      .from("profile_capabilities")
      .select("profile_id, can_manage_payments")
      .in("profile_id", profileIds),
  );
}

// ===========================================================================
// lib/activity.ts / lib/job-history.ts
// ===========================================================================

/** The most recent audit-log rows for one record, on the entity detail screens. */
export function listAuditLogForRecord(
  supabase: ServerClient,
  tableName: string,
  rowId: string,
  limit: number,
) {
  return readAtMost(
    "backend.listAuditLogForRecord",
    () =>
      supabase
        .from("audit_log")
        .select("id, table_name, action, actor, old_data, new_data, at")
        .eq("table_name", tableName)
        .eq("row_id", rowId)
        .order("at", { ascending: false }),
    limit,
  );
}

/** The audit-log rows for one job's history timeline. */
export function listAuditLogForJob(supabase: ServerClient, jobId: string, limit: number) {
  return readAtMost(
    "backend.listAuditLogForJob",
    () =>
      supabase
        .from("audit_log")
        .select("id,action,actor,old_data,new_data,at")
        .eq("table_name", "jobs")
        .eq("row_id", jobId)
        .order("at", { ascending: false }),
    limit,
  );
}

/** Notes and follow-ups logged against one job. */
export function listJobActions(supabase: ServerClient, jobId: string) {
  return readAll("backend.listJobActions", () =>
    supabase
      .from("job_actions")
      .select(
        "id,action_type,title,body,status,due_at,assigned_to,created_by,completed_by,completed_at,created_at",
      )
      .eq("job_id", jobId)
      .order("created_at", { ascending: false }),
  );
}

/** Call events logged against one job. */
export function listJobCallEvents(supabase: ServerClient, jobId: string) {
  return readAll("backend.listJobCallEvents", () =>
    supabase
      .from("call_events")
      .select(
        "id,direction,status,from_number,to_number,reason,outcome,notes,needs_follow_up,handled_by,duration_seconds,started_at",
      )
      .eq("job_id", jobId)
      .order("started_at", { ascending: false }),
  );
}

/** Warranty callbacks reported against one job. */
export function listJobWarrantyCallbacks(supabase: ServerClient, jobId: string) {
  return readAll("backend.listJobWarrantyCallbacks", () =>
    supabase
      .from("warranty_callbacks")
      .select(
        "id,issue,priority,responsibility,status,scheduled_for,resolution,created_by,resolved_by,resolved_at,reported_at,callback_job_id",
      )
      .eq("original_job_id", jobId)
      .order("reported_at", { ascending: false }),
  );
}

// NOTE: lib/platform-admin.ts's support_sessions read is kept INLINE rather
// than centralised here — see the comment at that call site.
// tests/support-access.test.mjs reads that file's own source for the literal
// `from("support_sessions")` text.

// ===========================================================================
// lib/documents.ts
// ===========================================================================

const SETTLED_STATUSES = ["settled", "partially_refunded"] as const;

/**
 * Money actually received against a document, net of refunds — what
 * `collectedMinor` sums. Branches exactly as the original inline query did:
 * an invoice converted from an estimate credits both the invoice's own
 * payments and the estimate's deposit.
 */
export function listSettledPaymentAmountsForDocument(
  supabase: ServerClient,
  kind: "estimate" | "invoice",
  id: string,
  estimateId?: string | null,
) {
  return readAll("backend.listSettledPaymentAmountsForDocument", () => {
    let query = supabase
      .from("payments")
      .select("amount_minor, base_amount_minor, refunded_minor")
      .in("normalized_status", SETTLED_STATUSES);
    if (kind === "invoice") {
      query = estimateId
        ? query.or(`invoice_id.eq.${id},estimate_id.eq.${estimateId}`)
        : query.eq("invoice_id", id);
    } else {
      query = query.eq("estimate_id", id);
    }
    return query;
  });
}

/** Every column of every line on one invoice — the duplicate-document path copies them all. */
export function listInvoiceItemsFull(supabase: ServerClient, invoiceId: string) {
  return readAll("backend.listInvoiceItemsFull", () =>
    supabase.from("invoice_items").select("*").eq("invoice_id", invoiceId).order("sort"),
  );
}

/** The names already in the price book — so `saveItemsToLibrary` does not insert a duplicate. */
export function listPriceBookNames(supabase: ServerClient, organizationId: string) {
  return readAll("backend.listPriceBookNames", () =>
    supabase.from("price_book").select("name").eq("organization_id", organizationId),
  );
}

/** Every credit note against an invoice, newest first. */
export function listCreditNotesForInvoice(supabase: ServerClient, invoiceId: string) {
  return readAll("backend.listCreditNotesForInvoice", () =>
    supabase
      .from("credit_notes")
      .select(
        "id, number, amount_minor, reason, status, issue_date, created_at, cancelled_at, cancel_reason",
      )
      .eq("invoice_id", invoiceId)
      .order("number", { ascending: false }),
  );
}

// ===========================================================================
// lib/payments/server.ts, refunds.ts, deposits.ts, receipts.ts — the money path.
//
// These feed arithmetic that decides what a customer owes or has been
// refunded. Paging changes nothing about the numbers themselves — the same
// rows, the same filters, the same columns — it only guarantees ALL of the
// matching rows are summed rather than PostgREST's first 1000.
// ===========================================================================

// NOTE: openBalance and refreshInvoicePaidState (lib/payments/server.ts) keep
// their payments reads INLINE rather than centralised here — see the comments
// at both call sites. tests/deposit-credit.test.mjs reads that file's own
// source for the literal "partially_refunded" / "refunded_minor" text to
// prove the balance readers agree on what counts as paid.

/** Settled payments behind one invoice, for the refund path's "is it still covered?" check. */
export function listSettledPaymentsForRefundCheck(
  supabase: ServerClient,
  invoiceId: string,
  estimateId: string | null,
) {
  return readAll("backend.listSettledPaymentsForRefundCheck", () => {
    let query = supabase
      .from("payments")
      .select("base_amount_minor, amount_minor, refunded_minor, normalized_status")
      .in("normalized_status", ["settled", "partially_refunded"]);
    query = estimateId
      ? query.or(`invoice_id.eq.${invoiceId},estimate_id.eq.${estimateId}`)
      : query.eq("invoice_id", invoiceId);
    return query;
  });
}

/**
 * An organisation's active/action-required/processing online payment requests
 * for one document. At most one is used, but the number is not unique.
 */
export function listExistingManualPaymentRequests(
  supabase: ServerClient,
  organizationId: string,
  method: string,
  document: { invoiceId: string | null; estimateId: string | null },
  limit: number,
) {
  return readAtMost(
    "backend.listExistingManualPaymentRequests",
    () => {
      let query = supabase
        .from("payment_requests")
        .select("id")
        .eq("organization_id", organizationId)
        .contains("allowed_methods", [method])
        .in("status", ["submitted", "processing"]);
      query = document.invoiceId
        ? query.eq("invoice_id", document.invoiceId)
        : query.eq("estimate_id", document.estimateId!);
      return query;
    },
    limit,
  );
}

/** Helcim payments still `processing` — the reconciliation sweep's work list. */
export function listPendingHelcimPayments(supabase: ServerClient, limit: number) {
  return readAtMost(
    "backend.listPendingHelcimPayments",
    () =>
      supabase
        .from("payments")
        .select("provider_transaction_id")
        .eq("provider", "helcim")
        .eq("normalized_status", "processing")
        .order("submitted_at", { ascending: true }),
    limit,
  );
}

/** Payments for one estimate, for milestone/ACH-hold decisions. */
export function listPaymentsForEstimate(
  supabase: ServerClient,
  organizationId: string,
  estimateId: string,
) {
  return readAll("backend.listPaymentsForEstimate", () =>
    supabase
      .from("payments")
      .select(
        "id, base_amount_minor, amount_minor, refunded_minor, normalized_status, method, submitted_at",
      )
      .eq("organization_id", organizationId)
      .eq("estimate_id", estimateId),
  );
}

/** Milestones still awaiting a transfer to clear — the held-deposits office review list. */
export function listProcessingMilestonesForOrg(
  supabase: ServerClient,
  organizationId: string,
  limit: number,
) {
  return readAtMost(
    "backend.listProcessingMilestonesForOrg",
    () =>
      supabase
        .from("payment_milestones")
        .select("id, label, amount_minor, schedule_id")
        .eq("organization_id", organizationId)
        .eq("status", "processing")
        .is("released_at", null)
        .order("created_at", { ascending: true }),
    limit,
  );
}

/** Whether any milestone on this schedule carries a recorded ACH-hold override release. */
export function listReleasedMilestones(
  supabase: ServerClient,
  organizationId: string,
  scheduleId: string,
  limit: number,
) {
  return readAtMost(
    "backend.listReleasedMilestones",
    () =>
      supabase
        .from("payment_milestones")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("schedule_id", scheduleId)
        .not("released_at", "is", null),
    limit,
  );
}

/** The milestones on one payment schedule, in display order. */
export function listPaymentMilestones(
  supabase: ServerClient,
  organizationId: string,
  scheduleId: string,
) {
  return readAll("backend.listPaymentMilestones", () =>
    supabase
      .from("payment_milestones")
      .select("id, label, status, amount_minor, calculation_type, sort")
      .eq("organization_id", organizationId)
      .eq("schedule_id", scheduleId)
      .order("sort"),
  );
}

/** Payment schedules by id, for resolving a milestone back to its estimate. */
export function listPaymentSchedulesByIds(
  supabase: ServerClient,
  organizationId: string,
  ids: string[],
) {
  if (!ids.length) return Promise.resolve([]);
  return readAll("backend.listPaymentSchedulesByIds", () =>
    supabase
      .from("payment_schedules")
      .select("id, estimate_id")
      .eq("organization_id", organizationId)
      .in("id", ids),
  );
}

/** Estimates by id with their customer name, for the held-deposits review list. */
export function listEstimatesForHeldDeposits(
  supabase: ServerClient,
  organizationId: string,
  ids: string[],
) {
  if (!ids.length) return Promise.resolve([]);
  return readAll("backend.listEstimatesForHeldDeposits", () =>
    supabase
      .from("estimates")
      .select(`id, number, ${ESTIMATE_CUSTOMER}(name)`)
      .in("id", ids)
      .eq("organization_id", organizationId),
  );
}

/** Failed receipt notifications ready for another attempt. */
export function listFailedReceiptNotifications(supabase: ServerClient, limit: number) {
  return readAtMost(
    "backend.listFailedReceiptNotifications",
    () =>
      supabase
        .from("payment_notifications")
        .select("payment_id")
        .eq("status", "failed")
        .lt("attempts", 3)
        .order("updated_at", { ascending: true }),
    limit,
  );
}

/** A duplicate check for a webhook-recorded payment, by Stripe payment-intent id. */
export function listPaymentsByStripeIntent(
  supabase: ServerClient,
  intentId: string,
  limit: number,
) {
  return readAtMost(
    "backend.listPaymentsByStripeIntent",
    () => supabase.from("payments").select("id").eq("stripe_payment_intent_id", intentId),
    limit,
  );
}

// ===========================================================================
// app/api/calls/incoming, app/api/sms/incoming — resolving an inbound
// contact to a customer by phone number, scoped to the tenant the tracked
// number already resolved to.
// ===========================================================================

/** Every customer's id and phone for one organisation — inbound call routing. */
export function listCustomerPhonesForOrg(supabase: ServerClient, organizationId: string) {
  return readAll("backend.listCustomerPhonesForOrg", () =>
    supabase
      .from("customers")
      .select("id,phone")
      .eq("organization_id", organizationId)
      .is("deleted_at", null),
  );
}

/** Every customer's id and phone (excluding blanks) for one organisation — inbound SMS routing and opt-out/opt-in. */
export function listCustomerPhonesWithPhoneForOrg(supabase: ServerClient, organizationId: string) {
  return readAll("backend.listCustomerPhonesWithPhoneForOrg", () =>
    supabase
      .from("customers")
      .select("id, phone")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .not("phone", "is", null),
  );
}

// ===========================================================================
// app/api/privacy/export/[requestId] — the GDPR-style subject access export.
// A truncated legal export is the same defect as the accounting export this
// data layer exists to fix, with a compliance consequence instead of a
// financial one.
// ===========================================================================

export function listAllJobsForCustomerExport(supabase: ServerClient, customerId: string) {
  return readAll("backend.listAllJobsForCustomerExport", () =>
    supabase.from("jobs").select("*").eq("customer_id", customerId),
  );
}

export function listAllEstimatesForCustomerExport(supabase: ServerClient, customerId: string) {
  return readAll("backend.listAllEstimatesForCustomerExport", () =>
    supabase
      .from("estimates")
      .select("*,estimate_items!estimate_items_estimate_id_fkey(*)")
      .eq("customer_id", customerId),
  );
}

export function listAllInvoicesForCustomerExport(supabase: ServerClient, customerId: string) {
  return readAll("backend.listAllInvoicesForCustomerExport", () =>
    supabase
      .from("invoices")
      .select("*,invoice_items!invoice_items_invoice_id_fkey(*)")
      .eq("customer_id", customerId),
  );
}

export function listAllMessagesForCustomerExport(supabase: ServerClient, customerId: string) {
  return readAll("backend.listAllMessagesForCustomerExport", () =>
    supabase.from("messages").select("*").eq("customer_id", customerId),
  );
}

export function listSmsForCustomerExport(supabase: ServerClient, customerId: string) {
  return readAll("backend.listSmsForCustomerExport", () =>
    supabase
      .from("sms_messages")
      .select("id,to_phone,body,status,created_at,sent_at")
      .eq("customer_id", customerId),
  );
}

export function listConsentEventsForCustomerExport(supabase: ServerClient, customerId: string) {
  return readAll("backend.listConsentEventsForCustomerExport", () =>
    supabase
      .from("consent_events")
      .select("channel,purpose,granted,source,policy_version,proof,recorded_at")
      .eq("customer_id", customerId)
      .order("recorded_at"),
  );
}

export function listCallEventsForCustomerExport(supabase: ServerClient, customerId: string) {
  return readAll("backend.listCallEventsForCustomerExport", () =>
    supabase
      .from("call_events")
      .select(
        "direction,status,from_number,to_number,reason,outcome,notes,recording_consent,started_at,answered_at,ended_at,duration_seconds",
      )
      .eq("customer_id", customerId)
      .order("started_at"),
  );
}

export function listPaymentsForInvoicesExport(supabase: ServerClient, invoiceIds: string[]) {
  if (!invoiceIds.length) return Promise.resolve([]);
  return readAll("backend.listPaymentsForInvoicesExport", () =>
    supabase
      .from("payments")
      .select(
        "id,invoice_id,amount_minor,currency,status,provider,normalized_status,refunded_minor,paid_at,settled_at,created_at",
      )
      .in("invoice_id", invoiceIds),
  );
}

// ===========================================================================
// app/api/booking/[org]/slots, app/api/booking/[org]/submit
// ===========================================================================

/** Jobs occupying time on one day for one organisation — the availability calculator's busy windows. */
export function listJobBusyWindowsForDay(
  supabase: ServerClient,
  organizationId: string,
  date: string,
) {
  return readAll("backend.listJobBusyWindowsForDay", () =>
    supabase
      .from("jobs")
      .select("start_time,end_time")
      .eq("organization_id", organizationId)
      .eq("scheduled_date", date)
      .is("deleted_at", null)
      .neq("status", "cancelled"),
  );
}

// NOTE: the approved-time-off read for these two routes is deliberately kept
// INLINE in each route file rather than centralised here — see the comments
// at both call sites (app/api/booking/[org]/slots/route.ts and .../submit/
// route.ts). tests/availability.test.mjs reads each route's own source to
// prove they apply the identical technician_time_off filter, and moving the
// query here would move that text out of both files at once.

/** Active service areas for one organisation, with the columns the booking form's area check needs. */
export function listServiceAreasForBooking(supabase: ServerClient, organizationId: string) {
  return readAll("backend.listServiceAreasForBooking", () =>
    supabase
      .from("service_areas")
      .select("area_type,values_json,active")
      .eq("organization_id", organizationId)
      .eq("active", true),
  );
}

// ===========================================================================
// app/api/sync/job-status
// ===========================================================================

/** An organisation's job-status names, for mapping the offline outbox's start/complete actions to the right stage. */
export function listJobStatusNamesForOrg(supabase: ServerClient, organizationId: string) {
  return readAll("backend.listJobStatusNamesForOrg", () =>
    supabase
      .from("job_statuses")
      .select("name,is_done,sort")
      .eq("organization_id", organizationId)
      .order("sort"),
  );
}

// ===========================================================================
// app/api/calendar/[token]
// ===========================================================================

/** Jobs in a feed's window, for the subscribable iCal feed. Deliberately narrow columns — see the route for why. */
export function listJobsForCalendarFeed(
  supabase: ServerClient,
  input: {
    organizationId: string;
    start: string;
    end: string;
    profileId: string | null;
    limit: number;
  },
) {
  return readAtMost(
    "backend.listJobsForCalendarFeed",
    () => {
      let query = supabase
        .from("jobs")
        .select(
          `id, service, status, scheduled_date, end_date, start_time, end_time, job_address, job_city, updated_at, ${CUSTOMER}(name)`,
        )
        .eq("organization_id", input.organizationId)
        .is("deleted_at", null)
        .gte("scheduled_date", input.start)
        .lte("scheduled_date", input.end)
        .order("scheduled_date", { ascending: true });
      if (input.profileId) query = query.eq("assigned_to", input.profileId);
      return query;
    },
    input.limit,
  );
}
