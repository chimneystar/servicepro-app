/**
 * Query shapes that belong to `reports/`, `settings/` and `finance/` but don't
 * match any existing repository exactly.
 *
 * Owned by the 6.2 migration of those three trees. A shape goes here rather
 * than bending a call site to a near-miss in `invoices.ts`/`payments.ts`/
 * `jobs.ts`/`operations.ts`/`profiles.ts` — see those files first; several
 * report shapes already live there because more than one screen used them.
 */

import type { ServerClient } from "@/lib/supabase/server";
import { readAll, readAtMost, DataError } from "./db";

/** Job statuses with only the "done" flag — the commission report's completion test. */
export function listJobStatusesForCommission(supabase: ServerClient) {
  return readAll("reporting.listJobStatusesForCommission", () =>
    supabase.from("job_statuses").select("name, is_done"),
  );
}

/** Active staff with their commission percentage — the commission report. */
export function listActiveProfilesForCommission(supabase: ServerClient) {
  return readAll("reporting.listActiveProfilesForCommission", () =>
    supabase.from("profiles").select("id, full_name, commission_pct").eq("active", true),
  );
}

/**
 * Paid invoices in a window with just the technician attribution — the custom
 * report's narrower read. Differs from `invoices.listPaidInWindow` by column
 * list (no discount/tax/issue_date, and the `jobs` embed omits `assigned_to`),
 * so it gets its own shape rather than bending the call site to the near-match.
 */
export function listPaidInWindowForCustomReport(
  supabase: ServerClient,
  start: string,
  end: string,
) {
  return readAll("reporting.listPaidInWindowForCustomReport", () =>
    supabase
      .from("invoices")
      .select("id, total_minor, jobs(profiles!jobs_assigned_to_fkey(full_name))")
      .eq("status", "paid")
      .is("deleted_at", null)
      .gte("issue_date", start)
      .lte("issue_date", end),
  );
}

// --- scheduled / emailed reports --------------------------------------------

/** Configured report schedules, most recently created first — the schedule settings screen. */
export function listReportSchedules(supabase: ServerClient) {
  return readAll("reporting.listReportSchedules", () =>
    supabase
      .from("report_schedules")
      .select(
        "id, name, frequency, enabled, recipient_profile_ids, last_period_key, last_run_at, last_error",
      )
      .order("created_at", { ascending: false }),
  );
}

/** Active staff eligible to receive an emailed report, with their notification opt-in. */
export function listActiveProfilesForReportSchedules(supabase: ServerClient) {
  return readAll("reporting.listActiveProfilesForReportSchedules", () =>
    supabase
      .from("profiles")
      .select("id, full_name, role, active, notify_email_opt_in")
      .eq("active", true)
      .order("full_name"),
  );
}

/** The most recent report-delivery runs — the schedule screen's history. The bound is required. */
export function listRecentReportDeliveries(supabase: ServerClient, limit: number) {
  return readAtMost(
    "reporting.listRecentReportDeliveries",
    () =>
      supabase
        .from("report_deliveries")
        .select("id, period_key, status, reason, recipients, created_at")
        .order("created_at", { ascending: false }),
    limit,
  );
}

// --- privacy & retention -----------------------------------------------------

/** Live customers with contact fields — the privacy centre's subject picker. */
export function listCustomersForPrivacy(supabase: ServerClient) {
  return readAll("reporting.listCustomersForPrivacy", () =>
    supabase.from("customers").select("id,name,email,phone").is("deleted_at", null).order("name"),
  );
}

/** Recent consent events, most recent first — the privacy centre's consent log. The bound is required. */
export function listRecentConsentEvents(supabase: ServerClient, limit: number) {
  return readAtMost(
    "reporting.listRecentConsentEvents",
    () =>
      supabase
        .from("consent_events")
        .select("id,channel,purpose,granted,source,recorded_at,customers(name)")
        .order("recorded_at", { ascending: false }),
    limit,
  );
}

/** Every data-subject privacy request, newest first — the privacy centre's queue. */
export function listPrivacyRequests(supabase: ServerClient) {
  return readAll("reporting.listPrivacyRequests", () =>
    supabase
      .from("privacy_requests")
      .select(
        "id,request_type,status,requester_name,requester_email,received_at,due_at,identity_verified_at,completion_notes,customer_id,customers(name)",
      )
      .order("received_at", { ascending: false }),
  );
}

/** Active retention holds, newest first — the privacy centre's legal-hold list. */
export function listRetentionHolds(supabase: ServerClient) {
  return readAll("reporting.listRetentionHolds", () =>
    supabase
      .from("retention_holds")
      .select("id,category,reason,expires_at,released_at,customers(name)")
      .order("created_at", { ascending: false }),
  );
}

/** Recent retention-enforcement runs — the privacy centre's audit trail. The bound is required. */
export function listRecentRetentionRuns(supabase: ServerClient, limit: number) {
  return readAtMost(
    "reporting.listRecentRetentionRuns",
    () =>
      supabase
        .from("retention_runs")
        .select("id,mode,status,summary,started_at")
        .order("started_at", { ascending: false }),
    limit,
  );
}

// --- payments settings -------------------------------------------------------

/** Manual payment submissions awaiting verification — the payments settings screen. The bound is required. */
export function listPendingManualPaymentSubmissions(supabase: ServerClient, limit: number) {
  return readAtMost(
    "reporting.listPendingManualPaymentSubmissions",
    () =>
      supabase
        .from("manual_payment_submissions")
        .select(
          "id, payment_request_id, method, amount_minor, reference, mailed_on, submitted_at, status",
        )
        .eq("status", "verification_pending")
        .order("submitted_at", { ascending: false }),
    limit,
  );
}

/**
 * Settled or partially-refunded payments against one invoice, for a balance
 * check — the manual-payment review action's "is this invoice now paid off"
 * test. Narrower than `payments.listCollectedForInvoices` (no `invoice_id` or
 * `amount_minor` column, and scoped to one invoice rather than a set).
 */
export function listSettledPaymentAmountsForInvoice(supabase: ServerClient, invoiceId: string) {
  return readAll("reporting.listSettledPaymentAmountsForInvoice", () =>
    supabase
      .from("payments")
      .select("base_amount_minor, refunded_minor, normalized_status")
      .eq("invoice_id", invoiceId)
      .in("normalized_status", ["settled", "partially_refunded"]),
  );
}

// --- security & audit --------------------------------------------------------

/** One member's recent account-security events — the security centre's own-account timeline. The bound is required. */
export function listAccountSecurityEvents(
  supabase: ServerClient,
  profileId: string,
  limit: number,
) {
  return readAtMost(
    "reporting.listAccountSecurityEvents",
    () =>
      supabase
        .from("account_security_events")
        .select("id, event_type, ip, ip_trusted, device_label, details, at")
        .eq("profile_id", profileId)
        .order("at", { ascending: false }),
    limit,
  );
}

/**
 * Recent permission changes, sign-in attempts and e-signature evidence across
 * the WHOLE organisation — the audit log's three side tabs. None of these
 * filter by `organization_id` in the query: row-level security (migration 038
 * §8) is what scopes them, matching how the screen that reads them documents
 * its own access model. The bound is required on each.
 */
export function listRecentPermissionChanges(supabase: ServerClient, limit: number) {
  return readAtMost(
    "reporting.listRecentPermissionChanges",
    () =>
      supabase
        .from("permission_change_log")
        .select(
          "id, subject_profile_id, actor_profile_id, source_table, operation, changes, ip, at",
        )
        .order("at", { ascending: false }),
    limit,
  );
}

export function listRecentLoginAttempts(supabase: ServerClient, limit: number) {
  return readAtMost(
    "reporting.listRecentLoginAttempts",
    () =>
      supabase
        .from("auth_login_attempts")
        .select("id, email_key, success, reason, ip, ip_trusted, device_label, at")
        .order("at", { ascending: false }),
    limit,
  );
}

export function listRecentSignatureEvents(supabase: ServerClient, limit: number) {
  return readAtMost(
    "reporting.listRecentSignatureEvents",
    () =>
      supabase
        .from("document_signature_events")
        .select(
          "id, document_type, document_id, signer_name, capture, ip, ip_trusted, device_label, signature_sha256, signed_at",
        )
        .order("signed_at", { ascending: false }),
    limit,
  );
}

export type AuditLogFilters = {
  from?: string;
  to?: string;
  table?: string;
  action?: string;
  actor?: string;
};

/**
 * One page of the organisation's audit log, with the EXACT total row count
 * the filters produce — the audit log's pager.
 *
 * Neither `readAll` nor `readPage` (lib/data/db.ts) fits this: the screen
 * needs an exact total for page numbers, not `readPage`'s one-extra-row
 * `hasMore`, and getting one must not mean fetching the whole log. So this
 * calls PostgREST's `count: "exact"` directly, in the one file that needs the
 * shape, and throws on error the same way db.ts's own reads do rather than
 * reaching into that file to add a primitive only this screen uses.
 */
export async function listAuditLogPage(
  supabase: ServerClient,
  filters: AuditLogFilters,
  organizationId: string,
  page: number,
  pageSize: number,
) {
  let query = supabase
    .from("audit_log")
    .select("id, table_name, row_id, action, actor, at", { count: "exact" })
    .eq("organization_id", organizationId);
  if (filters.from) query = query.gte("at", `${filters.from}T00:00:00Z`);
  if (filters.to) query = query.lte("at", `${filters.to}T23:59:59Z`);
  if (filters.table) query = query.eq("table_name", filters.table);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.actor) query = query.eq("actor", filters.actor);
  const offset = Math.max(0, page - 1) * pageSize;
  const { data, count, error } = await query
    .order("at", { ascending: false })
    .range(offset, offset + pageSize - 1);
  if (error) throw new DataError("reporting.listAuditLogPage", error);
  return { rows: data ?? [], total: count ?? 0 };
}

// --- finance: tax, settlements, disputes -------------------------------------

/** Configured tax jurisdictions, active ones first — the finance centre's tax setup. */
export function listTaxJurisdictions(supabase: ServerClient) {
  return readAll("reporting.listTaxJurisdictions", () =>
    supabase
      .from("tax_jurisdictions")
      .select(
        "id,name,code,jurisdiction_type,rate_bps,applies_to,active,effective_from,effective_to",
      )
      .order("active", { ascending: false })
      .order("name"),
  );
}

/** Tax filing periods, most recently ending first — the finance centre's filings tab. */
export function listTaxFilings(supabase: ServerClient) {
  return readAll("reporting.listTaxFilings", () =>
    supabase
      .from("tax_filings")
      .select(
        "id,period_start,period_end,due_on,taxable_sales_minor,tax_collected_minor,tax_remitted_minor,status,confirmation_reference",
      )
      .order("period_end", { ascending: false }),
  );
}

/** Settlement batches from the payment processor, most recent first — the reconciliation tab. */
export function listSettlementBatches(supabase: ServerClient) {
  return readAll("reporting.listSettlementBatches", () =>
    supabase
      .from("settlement_batches")
      .select(
        "id,provider,provider_settlement_id,settlement_date,expected_arrival,gross_minor,fees_minor,refunds_minor,chargebacks_minor,adjustments_minor,net_minor,status,bank_reference",
      )
      .order("settlement_date", { ascending: false }),
  );
}

/** Payment disputes with the payment they reference, most recent first — the finance centre's disputes tab. */
export function listPaymentDisputes(supabase: ServerClient) {
  return readAll("reporting.listPaymentDisputes", () =>
    supabase
      .from("payment_disputes")
      .select(
        "id,provider,provider_dispute_id,reason,disputed_minor,status,opened_at,response_due_at,evidence_notes,payments(provider_transaction_id,invoice_id)",
      )
      .order("opened_at", { ascending: false }),
  );
}

/** The most recent payments, for the finance centre's reconciliation match-up. The bound is required. */
export function listRecentPaymentsForFinance(supabase: ServerClient, limit: number) {
  return readAtMost(
    "reporting.listRecentPaymentsForFinance",
    () =>
      supabase
        .from("payments")
        .select("id,provider,provider_transaction_id,amount_minor,settled_at")
        .order("created_at", { ascending: false }),
    limit,
  );
}
