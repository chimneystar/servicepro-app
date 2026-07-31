# ServicePro — Database migrations

Migrations are plain SQL, applied **in numeric order** in the Supabase SQL Editor.
Every file is **idempotent** — safe to re-run.

> **Read this before touching production.** The previous version of this document
> described a disaster-recovery procedure that stopped at `017_*`, silently
> omitting migrations 018–022 — roughly 1,370 lines of DDL covering permissions,
> dispatch, custom fields, booking, warranties, call tracking, privacy and
> platform administration. Following it produced a database the application
> **cannot run against**. The procedure below is the corrected one.

---

## Building a database from zero (new project, or disaster recovery)

Run these **in this exact order**. Every file, no gaps.

| Order | File | What it adds |
|---|---|---|
| 1 | `schema.sql` | Baseline: core tables, types, RLS, functions, triggers, indexes, the no-double-book constraint |
| 2 | `002_batch1.sql` | Item cost + image; job-photos storage policies |
| 3 | `003_team.sql` | `accept_invitation()` |
| 4 | `004_sharing.sql` | Public document token, `public_document` / `approve_document` |
| 5 | `005_more.sql` | `organizations.job_types` |
| 6 | `006_job_types.sql` | `job_types` table |
| 7 | `007_v9.sql` | Job/billing address, message templates, job tasks/equipment/checklists |
| 8 | `008_v10.sql` | Item title/taxable/photo, price book, deposits, document customisation, archive |
| 9 | `009_v11.sql` | Leads + booking RPCs, technician field tools, invoice online-pay columns |
| 10 | `010_v13.sql` | Customer portal, inventory, SMS direction |
| 11 | `011_v14.sql` | Recurring plans, reminder log, review URL |
| 12 | `012_v15.sql` | Custom job statuses, job stage/tags/expenses, commission % |
| 13 | `013_security_hardening.sql` | Fixed `search_path`, EXECUTE lockdown, booking rate limit, `webhook_events` policy |
| 14 | `014_tenant_isolation.sql` | Composite tenant FKs + org-guard triggers |
| 15 | `015_indexes.sql` | High-volume access-path indexes |
| 16 | `017_helcim_payments.sql` | Helcim connected accounts, provider-neutral payments, payment settings |
| 17 | `018_product_foundation.sql` | Per-member permissions, industry onboarding, device subscriptions |
| 18 | `019_operations_growth.sql` | Dispatch crews, custom fields, automations, operations, growth, customer portal |
| 19 | `020_booking_experience.sql` | Availability-aware bilingual online booking |
| 20 | `021_job_history_warranty_calls.sql` | Job actions, warranties, callbacks, call tracking |
| 21 | `022_operations_privacy_team_admin.sql` | Appearance, last-owner protection, finance/tax/settlement, privacy/retention, platform admin |
| 22 | `023_authorization_hardening.sql` | **Closes two privilege-escalation paths.** Not optional |
| 23 | `024_deposit_credit.sql` | Links invoices to their originating estimate so deposits are credited |
| 24 | `025_job_end_date_default.sql` | Stops jobs with a null `end_date` haunting the dispatch board |
| 25 | `026_usd_only.sql` | Aligns the currency constraint with what the payment layer can process |
| 26 | `027_hot_path_indexes.sql` | Indexes the lookups the app makes on every request |
| 27 | `028_crew_double_book.sql` | Extends the no-double-book guarantee to crew (`job_assignments`), not just the lead |
| 28 | `029_booking_timezone.sql` | `booking_settings.timezone` — booking slot maths runs on the business's clock, not the server's |
| 29 | `030_refunds.sql` | Refund ledger, derived refunded_minor, refund permission, and the audit trail payments never had |
| 30 | `032_automation_execution.sql` | Automation-run uniqueness, per-recipient campaign delivery claims, and outreach send tracking |
| 31 | `033_inventory_movements.sql` | Append-only stock ledger, derived `inventory_items.quantity`, concurrency guard, multi-line purchase orders with a receive step |
| 32 | `034_notifications_support.sql` | Push event tracing, the support-access audit table, and an `accept_invitation(token)` that actually requires the emailed token |
| 33 | `035_custom_fields_tax.sql` | Guards `custom_field_values.entity_id` (audit F21 — polymorphic, no FK, no org check); adds opt-in `organizations.tax_mode` and `document_tax_context()` so tax jurisdictions and customer exemptions can price a document |
| 34 | `037_recovery.sql` | `deleted_by` on the four soft-deletable tables (backfilled from `audit_log`), the restore-consistency and privacy-erasure triggers behind `/trash`, and indexes for listing deleted rows |

There is **no file numbered 016**: `016_isolation_tests.sql` is a *test*, not a
migration. Run it after step 15 (and again at the end) and confirm you see
`✔ ALL ISOLATION TESTS PASSED`.

`GO-LIVE.sql` is **not** part of this sequence — see "Deprecated files" below.

### Then, outside SQL

1. **Storage buckets** — create `job-photos` (private) and `item-photos` (private).
2. **Auth → Providers → Email → enable "Leaked password protection"**.
3. Set every environment variable in `.env.example`. The app validates these at
   boot (`lib/env.ts`) and refuses to start if a required one is missing, so a
   misconfiguration surfaces immediately rather than at the first customer payment.

### Verify the rebuild

```sql
-- Expect 97+ tables, and ZERO rows from this query.
select c.relname as table_without_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
```

Then run `016_isolation_tests.sql` and confirm it passes.

---

## Applying a new migration to an existing database

1. Apply files in numeric order; never skip one.
2. Re-run `016_isolation_tests.sql` afterwards.
3. Record the file name and date in the log below.

**There is no automated migration ledger.** Nothing in the database records which
files have been applied, so this document *is* the ledger — keep it accurate. If
you are unsure whether a file has been applied, every file is idempotent: running
it again is safe.

### Applied log

| Date | Environment | Through migration | By |
|---|---|---|---|
| _(record each production application here)_ | | | |

---

## Rolling back

**There are no down-migrations.** Every file is additive: it creates tables,
adds columns, or replaces functions. None drops a table or a column, so applying
one cannot destroy data.

To undo a migration you must therefore either:

- **Replace the function** — most behavioural changes (`approve_document`,
  `public_customer_portal`, `accept_invitation`) are `create or replace function`.
  Re-run the earlier migration's version of that function to revert it.
- **Drop the added policy or constraint** — e.g. to relax `026`:
  `alter table public.organizations drop constraint organizations_currency_check;`
- **Restore from backup** — for anything structural. See the backup runbook in
  `docs/RUNBOOK.md`.

Reverting `023_authorization_hardening.sql` **re-opens two privilege-escalation
paths**. Do not do it to work around a permissions complaint; fix the policy
instead.

---

## Deprecated files

`GO-LIVE.sql` is a byte-identical concatenation of `012 + 013 + 014 + 015`,
created as a one-shot convenience for a specific deployment that had already
applied 0001–0011. It is now **seven migrations stale**, it is not self-standing
(it aborts partway on a fresh database because `accept_invitation()` does not yet
exist), and it duplicates ~320 lines that must otherwise be edited in two places.

**Do not run it.** It is retained only so that an operator who used it previously
can identify what they applied. Use the numbered sequence above.
