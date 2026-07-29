# ServicePro — Database migrations (recorded history)

Migrations are plain SQL, applied in numeric order in the Supabase SQL Editor.
Every file is **idempotent** (safe to re-run).

## Ordered history

| # | File | What it does |
|---|------|--------------|
| 0001 (baseline) | `schema.sql` | Complete baseline: all tables, custom types, RLS policies, functions, triggers, indexes, the no-double-book constraint. Run this first on a brand-new project. |
| 0002 | `002_batch1.sql` | Item cost + image; job-photos storage policies |
| 0003 | `003_team.sql` | `accept_invitation()` |
| 0004 | `004_sharing.sql` | Public document token + `public_document` / `approve_document` |
| 0005 | `005_more.sql` | `organizations.job_types` |
| 0006 | `006_job_types.sql` | `job_types` table |
| 0007 | `007_v9.sql` | Job/billing address, message templates, job tasks/equipment/checklist, payments cols |
| 0008 | `008_v10.sql` | Item title/taxable/photo, price-book library, deposits, doc customization, archive |
| 0009 | `009_v11.sql` | Leads + booking RPCs, tech field tools, deposits, invoice online-pay cols |
| 0010 | `010_v13.sql` | Customer portal, inventory, SMS direction, deposit in public_document |
| 0011 | `011_v14.sql` | Recurring plans, reminder log, review URL, onboarding flag |
| 0012 | `012_v15.sql` | Custom job statuses, job stage/tags/expenses, technician commission % |
| 0013 | `013_security_hardening.sql` | **Go-live:** fixed search_path, EXECUTE lockdown, booking rate-limit, webhook_events policy, btree_gist move |
| 0014 | `014_tenant_isolation.sql` | **Go-live:** composite tenant FKs + org-guard triggers |
| 0015 | `015_indexes.sql` | **Go-live:** high-volume access-path indexes |
| 0017 | `017_helcim_payments.sql` | Helcim connected accounts, provider-neutral payments, schedules, manual verification, and payment settings |
| 0018 | `018_product_foundation.sql` | Permissions, industry onboarding catalogs, device subscriptions, and push-event foundation |
| 0019 | `019_operations_growth.sql` | Dispatch crews, custom fields, automations, operations, growth, migration, offline receipts, and customer portal |
| 0020 | `020_booking_experience.sql` | Availability-aware bilingual online booking, intake questions, and booking settings |
| 0021 | `021_job_history_warranty_calls.sql` | Unified job actions, warranties, callbacks, linked return visits, and call tracking |
| — | `016_isolation_tests.sql` | Runnable proof that cross-tenant writes are rejected (not a migration) |

## Going live now (single run)

Your project already has 0001–0011 applied. To go live, run **`GO-LIVE.sql`** once —
it bundles 0012 → 0015 in order. Then run **`016_isolation_tests.sql`** and confirm
you see `✔ ALL ISOLATION TESTS PASSED`.

## Two manual dashboard settings (not SQL)

1. **Auth → Providers → Email → enable "Leaked password protection"** (HaveIBeenPwned check).
2. Confirm **Storage** has the `job-photos` (private) and `item-photos` (public) buckets.

## Fresh project (disaster recovery)

Run `schema.sql`, then `002_*` … `015_*`, followed by `017_*`, then create the two storage buckets.
