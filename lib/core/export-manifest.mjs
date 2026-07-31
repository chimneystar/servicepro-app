/**
 * Whole-business data export — the manifest and the redaction rule (ledger 6a.7).
 *
 * Before this, the only ways data left the product were three per-entity CSVs
 * (invoices, payments, expenses over a date range) and a per-customer GDPR JSON.
 * An owner could not take their own business out of the product. This module is
 * the pure, testable half of the export: WHICH tables, keyed by WHICH column,
 * and WHAT never leaves regardless of who asks.
 *
 * ---------------------------------------------------------------------------
 * WHAT A BUSINESS OWNER LEGITIMATELY NEEDS vs WHAT IS A CREDENTIAL
 * ---------------------------------------------------------------------------
 * The existing GDPR export (app/api/privacy/export/[requestId]/route.ts) gets
 * this backwards: it selects `customers.*` and both documents' `*`, so it hands
 * the REQUESTER — a member of the public who asked for their own data —
 * `portal_token`, the estimate and invoice `public_token`s, and the business's
 * internal `cost_minor` margins. Those are two different mistakes:
 *
 *   - A token is a BEARER CREDENTIAL. `customers.portal_token` is the whole of
 *     the authentication for /portal/<token>; `public_token` is the whole of the
 *     authentication for /p/<token>, where a document can be signed and paid.
 *     Anyone holding the string is the customer. It is never business data —
 *     not for the requester, and not for the owner either, because an export
 *     file is copied, emailed and left in a downloads folder, and a leaked
 *     export would then be a live session for every customer at once. Tokens
 *     are therefore redacted here even though this export goes to the owner.
 *
 *   - Cost and margin ARE the owner's own data. `invoice_items.cost_minor`,
 *     `price_book.cost_minor`, `jobs.job_expenses_minor`, `profiles.commission_pct`
 *     are wrong to send to a customer and exactly right to send to the owner —
 *     without them the export is not a copy of the business. They are INCLUDED.
 *
 * So the line is not "sensitive vs not". It is: does the value AUTHENTICATE
 * someone? If yes it is withheld from everyone. If it merely describes the
 * business, the business gets it.
 *
 * Redacted keys are replaced with REDACTED rather than dropped, so the owner can
 * see that the column exists and was deliberately withheld — a silently missing
 * key is indistinguishable from a bug.
 */

export const REDACTED = "[redacted — credential, not exported]";

/**
 * Exact column names that authenticate someone. Every one verified to exist in
 * db/*.sql; see the pattern list below for anything added later.
 */
export const SECRET_COLUMNS = new Set([
  "portal_token", // customers — the entire auth for /portal/<token>
  "public_token", // estimates, invoices, payment_requests — the entire auth for /p/<token>
  "helcim_checkout_token", // payment_requests — live checkout session
  "token", // invitations — accepting an invite joins the organisation
  "auth_secret", // device_subscriptions — Web Push credential
  "p256dh", // device_subscriptions — Web Push credential
  "endpoint", // device_subscriptions — a push endpoint IS the capability
  "encrypted_api_token", // merchant_secrets (table also excluded outright)
  "encrypted_secret_token", // payment_checkout_secrets (table also excluded outright)
]);

/**
 * A column added tomorrow must not leak just because this file was not updated.
 * These patterns are the safety net, deliberately biased towards over-redaction:
 * they also catch `portal_token_expires_at` / `portal_token_rotated_at`, which
 * are only timestamps. Losing two timestamps beats shipping a live token.
 */
export const SECRET_PATTERNS = [
  /(^|_)(token|secret|password|passphrase|credential)s?(_|$)/i,
  /^(api|private|signing|encryption)_key$/i,
];

export function isSecretColumn(name) {
  const key = String(name ?? "");
  if (SECRET_COLUMNS.has(key)) return true;
  return SECRET_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Redact by key name, RECURSIVELY.
 *
 * The recursion is not decoration: `audit_log.old_data` / `new_data` are whole
 * row snapshots stored as jsonb, so a flat top-level pass would export every
 * `portal_token` and `public_token` the business has ever had inside the audit
 * trail while the customers table itself looked clean.
 */
export function redactDeep(value, depth = 0) {
  if (depth > 24 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => redactDeep(entry, depth + 1));
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = isSecretColumn(key) ? REDACTED : redactDeep(entry, depth + 1);
  }
  return out;
}

/**
 * Every table the business owns, with the column that scopes it to one tenant.
 * Generated from db/*.sql and checked by tests/business-export.test.mjs against
 * the same files, so a new migration that adds a table fails the test rather
 * than quietly leaving it out of everyone's backup.
 *
 * `order` is the column paged on. It must be stable or paging can repeat and
 * skip rows: `id` everywhere it exists, and the natural key on the handful of
 * single-row-per-org settings tables that have no `id`.
 */
export const EXPORT_TABLES = [
  { table: "audit_log", orgKey: "organization_id", order: "id" },
  { table: "automation_rules", orgKey: "organization_id", order: "id" },
  { table: "automation_runs", orgKey: "organization_id", order: "id" },
  { table: "booking_questions", orgKey: "organization_id", order: "id" },
  { table: "booking_services", orgKey: "organization_id", order: "id" },
  { table: "booking_settings", orgKey: "organization_id", order: "organization_id" },
  { table: "call_events", orgKey: "organization_id", order: "id" },
  { table: "campaign_deliveries", orgKey: "organization_id", order: "id" },
  { table: "campaigns", orgKey: "organization_id", order: "id" },
  { table: "catalog_import_batches", orgKey: "organization_id", order: "id" },
  { table: "consent_events", orgKey: "organization_id", order: "id" },
  { table: "crew_members", orgKey: "organization_id", order: "id" },
  { table: "crews", orgKey: "organization_id", order: "id" },
  { table: "custom_field_definitions", orgKey: "organization_id", order: "id" },
  { table: "custom_field_values", orgKey: "organization_id", order: "id" },
  // Added when migration 036 introduced them. The guard test below catches a
  // tenant table that is neither exported nor excused — it caught these two
  // the moment the document-integrity work merged, which is the point of it.
  { table: "credit_notes", orgKey: "organization_id", order: "id" },
  // Account-security records. All are the BUSINESS's own audit trail — who
  // signed in, from where, what permissions changed, who signed what. An owner
  // needs them in a copy of the business, and they are the evidence half of the
  // e-signature work.
  //
  // profile_security holds MFA/session TIMESTAMPS only — no TOTP secret, no
  // recovery code. Verified against db/038 before adding it here; Supabase holds
  // the factor secrets and they never enter this database.
  { table: "auth_login_attempts", orgKey: "organization_id", order: "id" },
  { table: "account_security_events", orgKey: "organization_id", order: "id" },
  { table: "permission_change_log", orgKey: "organization_id", order: "id" },
  { table: "profile_security", orgKey: "organization_id", order: "profile_id" },
  { table: "document_signature_events", orgKey: "organization_id", order: "id" },
  { table: "staff_notifications", orgKey: "organization_id", order: "id" },
  { table: "dunning_events", orgKey: "organization_id", order: "id" },
  { table: "customer_statements", orgKey: "organization_id", order: "id" },
  { table: "report_schedules", orgKey: "organization_id", order: "id" },
  { table: "report_deliveries", orgKey: "organization_id", order: "id" },
  { table: "bulk_operations", orgKey: "organization_id", order: "id" },
  { table: "accounting_exports", orgKey: "organization_id", order: "id" },
  { table: "accounting_export_rows", orgKey: "organization_id", order: "id" },
  // The `token` column is redacted by SECRET_COLUMNS, so what exports is the
  // record that a feed existed, its scope and when it was revoked — not a live
  // subscribable URL. A calendar feed token is a read capability over the
  // schedule; an export file must never carry one.
  { table: "calendar_feed_tokens", orgKey: "organization_id", order: "id" },
  { table: "estimate_options", orgKey: "organization_id", order: "id" },
  { table: "estimate_option_items", orgKey: "organization_id", order: "id" },
  { table: "technician_time_off", orgKey: "organization_id", order: "id" },
  { table: "technician_skills", orgKey: "organization_id", order: "id" },
  // Payroll. Included deliberately: the export is owner-only, and a pay rate is
  // the business's own record — without it the file is not a copy of the
  // business. It does not AUTHENTICATE anyone, which is the line this manifest
  // draws. It is owner-only in the app for the same reason it is here.
  { table: "technician_pay_rates", orgKey: "organization_id", order: "id" },
  // The `token` column is already in SECRET_COLUMNS, so the rows are exported
  // with the credential redacted — the link history is the business's record,
  // the live link is not.
  { table: "appointment_tokens", orgKey: "organization_id", order: "id" },
  { table: "customer_portal_requests", orgKey: "organization_id", order: "id" },
  { table: "customer_tax_exemptions", orgKey: "organization_id", order: "id" },
  { table: "customers", orgKey: "organization_id", order: "id" },
  { table: "device_subscriptions", orgKey: "organization_id", order: "id" },
  { table: "email_messages", orgKey: "organization_id", order: "id" },
  { table: "estimate_followups", orgKey: "organization_id", order: "id" },
  { table: "estimate_items", orgKey: "organization_id", order: "id" },
  { table: "estimates", orgKey: "organization_id", order: "id" },
  { table: "expenses", orgKey: "organization_id", order: "id" },
  { table: "inventory_items", orgKey: "organization_id", order: "id" },
  { table: "inventory_movements", orgKey: "organization_id", order: "id" },
  { table: "invitations", orgKey: "organization_id", order: "id" },
  { table: "invoice_items", orgKey: "organization_id", order: "id" },
  { table: "invoices", orgKey: "organization_id", order: "id" },
  { table: "job_actions", orgKey: "organization_id", order: "id" },
  { table: "job_assignments", orgKey: "organization_id", order: "id" },
  { table: "job_checklist_items", orgKey: "organization_id", order: "id" },
  { table: "job_equipment", orgKey: "organization_id", order: "id" },
  { table: "job_items", orgKey: "organization_id", order: "id" },
  { table: "job_photos", orgKey: "organization_id", order: "id" },
  { table: "job_statuses", orgKey: "organization_id", order: "id" },
  { table: "job_summary_drafts", orgKey: "organization_id", order: "id" },
  { table: "job_tasks", orgKey: "organization_id", order: "id" },
  { table: "job_time_entries", orgKey: "organization_id", order: "id" },
  { table: "job_types", orgKey: "organization_id", order: "id" },
  { table: "job_warranties", orgKey: "organization_id", order: "id" },
  { table: "jobs", orgKey: "organization_id", order: "id" },
  { table: "lead_attribution_costs", orgKey: "organization_id", order: "id" },
  { table: "leads", orgKey: "organization_id", order: "id" },
  { table: "manual_payment_submissions", orgKey: "organization_id", order: "id" },
  { table: "merchant_connections", orgKey: "organization_id", order: "organization_id" },
  { table: "message_templates", orgKey: "organization_id", order: "id" },
  { table: "messages", orgKey: "organization_id", order: "id" },
  { table: "migration_batches", orgKey: "organization_id", order: "id" },
  { table: "organization_industries", orgKey: "organization_id", order: "id" },
  { table: "organization_privacy_settings", orgKey: "organization_id", order: "organization_id" },
  { table: "organizations", orgKey: "id", order: "id" },
  { table: "payment_disputes", orgKey: "organization_id", order: "id" },
  { table: "payment_events", orgKey: "organization_id", order: "id" },
  { table: "payment_milestones", orgKey: "organization_id", order: "id" },
  { table: "payment_notifications", orgKey: "organization_id", order: "id" },
  { table: "payment_refunds", orgKey: "organization_id", order: "id" },
  { table: "payment_requests", orgKey: "organization_id", order: "id" },
  { table: "payment_schedules", orgKey: "organization_id", order: "id" },
  { table: "payment_settings", orgKey: "organization_id", order: "organization_id" },
  { table: "payments", orgKey: "organization_id", order: "id" },
  { table: "price_book", orgKey: "organization_id", order: "id" },
  { table: "privacy_requests", orgKey: "organization_id", order: "id" },
  { table: "profile_capabilities", orgKey: "organization_id", order: "profile_id" },
  { table: "profile_payment_permissions", orgKey: "organization_id", order: "profile_id" },
  { table: "profiles", orgKey: "organization_id", order: "id" },
  { table: "purchase_order_items", orgKey: "organization_id", order: "id" },
  { table: "purchase_orders", orgKey: "organization_id", order: "id" },
  { table: "push_notification_events", orgKey: "organization_id", order: "id" },
  { table: "recurring_plans", orgKey: "organization_id", order: "id" },
  { table: "referral_programs", orgKey: "organization_id", order: "id" },
  { table: "referrals", orgKey: "organization_id", order: "id" },
  { table: "reminder_log", orgKey: "organization_id", order: "id" },
  { table: "retention_holds", orgKey: "organization_id", order: "id" },
  { table: "retention_runs", orgKey: "organization_id", order: "id" },
  { table: "reviews", orgKey: "organization_id", order: "id" },
  { table: "service_areas", orgKey: "organization_id", order: "id" },
  { table: "settlement_batches", orgKey: "organization_id", order: "id" },
  { table: "settlement_payment_links", orgKey: "organization_id", order: "id" },
  { table: "sms_messages", orgKey: "organization_id", order: "id" },
  { table: "subcontractor_assignments", orgKey: "organization_id", order: "id" },
  { table: "subcontractors", orgKey: "organization_id", order: "id" },
  { table: "subscriptions", orgKey: "organization_id", order: "organization_id" },
  { table: "support_cases", orgKey: "organization_id", order: "id" },
  { table: "support_session_events", orgKey: "organization_id", order: "id" },
  { table: "support_sessions", orgKey: "organization_id", order: "id" },
  { table: "sync_outbox_receipts", orgKey: "organization_id", order: "id" },
  { table: "tax_filings", orgKey: "organization_id", order: "id" },
  { table: "tax_jurisdictions", orgKey: "organization_id", order: "id" },
  { table: "technician_location_consents", orgKey: "organization_id", order: "profile_id" },
  { table: "technician_locations", orgKey: "organization_id", order: "id" },
  { table: "tracked_phone_numbers", orgKey: "organization_id", order: "id" },
  { table: "vendors", orgKey: "organization_id", order: "id" },
  { table: "warranty_callbacks", orgKey: "organization_id", order: "id" },
];

/**
 * Tables deliberately left out, each with the reason. This list is shown to the
 * owner verbatim — an export that quietly omits things is the failure mode this
 * whole item exists to fix.
 */
export const EXCLUDED_TABLES = [
  { table: "merchant_secrets", reason: "Encrypted payment-provider API token. A credential, and useless outside this deployment's key." },
  { table: "payment_checkout_secrets", reason: "Short-lived checkout session credentials." },
  { table: "webhook_events", reason: "Raw provider callbacks. The table has no organization_id, so no row can honestly be attributed to your business." },
  { table: "feature_flags", reason: "ServicePro platform rollout flags, not your business data." },
  { table: "platform_admins", reason: "ServicePro staff accounts, not your business data." },
  { table: "release_records", reason: "ServicePro's own deployment history." },
  { table: "release_events", reason: "ServicePro's own deployment history." },
];

/**
 * Things a reader will assume are in the file unless told otherwise. Stated in
 * the UI and repeated inside the file itself.
 */
export const NOT_INCLUDED = [
  "Files in storage — job photos and videos, uploaded logos, imported spreadsheets. The database rows that describe them (job_photos.storage_path and so on) ARE included, so you have the full list; the binaries are not in this file. Download them from Supabase Storage.",
  "Login credentials. Passwords and the auth.users table belong to Supabase Auth and are not readable by the application. Team members appear here as their profiles row.",
  "Customer portal tokens and document share links. These are bearer credentials — anyone holding one can act as that customer — so they are redacted even for you. Existing links keep working; they are simply not written to a file.",
  "Payment-provider secrets. Card numbers and bank accounts were never stored here in the first place; they live with the provider.",
];

/** Everything the UI needs to describe the export truthfully, in one place. */
export function exportContract() {
  return {
    tableCount: EXPORT_TABLES.length,
    tables: EXPORT_TABLES.map((entry) => entry.table),
    excluded: EXCLUDED_TABLES,
    notIncluded: NOT_INCLUDED,
    redactedColumns: [...SECRET_COLUMNS].sort(),
    format: "JSON",
  };
}

/**
 * PostgREST caps a response at 1000 rows. The accounting export shipped an
 * incomplete ledger for exactly this reason before it was paged; a backup that
 * stops at row 1000 and still says "complete" is the worse version of that bug,
 * because it is only discovered when it is needed. Kept here so the page size,
 * the ceiling and the tests all read the same number.
 */
export const EXPORT_PAGE_SIZE = 1000;

/** 500k rows in one table: refuse loudly rather than page forever. */
export const EXPORT_MAX_PAGES = 500;

/**
 * The range() bounds for a page. Off-by-one here silently drops or duplicates a
 * row every 1000 rows, which is precisely the kind of error an export hides.
 */
export function pageRange(page, size = EXPORT_PAGE_SIZE) {
  const index = Number.isInteger(page) && page >= 0 ? page : 0;
  const width = Number.isInteger(size) && size > 0 ? size : EXPORT_PAGE_SIZE;
  return { from: index * width, to: index * width + width - 1 };
}

/** A short batch means the source is exhausted; a full one never does. */
export function isLastPage(batchLength, size = EXPORT_PAGE_SIZE) {
  return batchLength < size;
}
