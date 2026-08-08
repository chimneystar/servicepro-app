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
| 0022 | `022_operations_privacy_team_admin.sql` | Personal appearance, last-owner protection, finance/tax/settlement/disputes, privacy/retention, and service-role-only platform administration |
| — | `016_isolation_tests.sql` | Runnable proof that cross-tenant writes are rejected — **a test script, not a migration.** Never part of the build sequence; run it afterwards. |

> **There is no `016_*` migration.** The numbering skips from 0015 to 0017 because
> `016_isolation_tests.sql` is a test. This gap is deliberate — do not "fix" it,
> and do not let it make you stop the sequence early.

## Building a database from zero

For a brand-new project (E2E testing, a fresh environment, or disaster recovery).
Run each file **in this exact order** in the Supabase SQL Editor:

```
schema.sql
002_batch1.sql
003_team.sql
004_sharing.sql
005_more.sql
006_job_types.sql
007_v9.sql
008_v10.sql
009_v11.sql
010_v13.sql
011_v14.sql
012_v15.sql
013_security_hardening.sql
014_tenant_isolation.sql
015_indexes.sql
017_helcim_payments.sql
018_product_foundation.sql
019_operations_growth.sql
020_booking_experience.sql
021_job_history_warranty_calls.sql
022_operations_privacy_team_admin.sql
```

That is **21 files**: the baseline plus 20 migrations.

Then:

1. Create the two storage buckets — see *Manual dashboard settings* below.
2. Run `016_isolation_tests.sql` and confirm it prints `✔ ALL ISOLATION TESTS PASSED`.
   If it does not, **stop** — the database is not safe to use.

### Verifying you actually finished

Stopping early produces a database the application cannot run against, and the
failure is quiet — most pages just render empty. Confirm the last four migrations
landed before you trust the result:

```sql
select
  to_regclass('public.booking_services')     is not null as "020_booking",
  to_regclass('public.job_warranties')       is not null as "021_warranty",
  to_regclass('public.privacy_requests')     is not null as "022_privacy",
  to_regclass('public.profile_capabilities') is not null as "018_permissions";
```

All four must return `true`. A complete build has exactly **97 base tables** in
`public` (the 21 files above create 97 distinct tables between them):

```sql
select count(*) from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE';
```

## ⚠️ A second, parallel migration system exists

There are **two** migration conventions in this repository:

| Location | Convention | Status |
|---|---|---|
| `db/*.sql` | Hand-numbered `002_` … `022_` | The system this document describes; on `main` |
| `supabase/migrations/*.sql` | Supabase CLI timestamps | **Only on the unmerged branch `feature/live-communications-payments`** |

`supabase/migrations/20260727000100_live_communications_payments.sql` creates five
tables — `communications`, `conversations`, `communication_attachments`,
`integration_connections`, `provider_webhook_events` — and **it has been applied to
the production database even though the branch was never merged into `main`.**

Consequences to be aware of:

- Production currently has **102** base tables. A database built from `main` per
  this document has **97**. The five-table difference is entirely the above file.
- `provider_webhook_events` has RLS enabled with **no policies**, so nothing can
  read or write it under normal credentials.
- A fresh E2E database built from `main` will therefore *not* match production.
  That is the correct behaviour — build from `main` — but if a test fails against
  a table that exists in production and not in your fresh database, this is why.

Pick one convention and retire the other before the divergence grows.

## Going live on an existing project

If a project already has 0001–0011 applied, run **`GO-LIVE.sql`** once — it bundles
0012 → 0015 in order. **`GO-LIVE.sql` stops at 0015.** You must then apply
`017_*` through `022_*` individually, as listed above, before the application will
work. Finish with `016_isolation_tests.sql`.

## Manual dashboard settings (not SQL)

1. **Auth → Providers → Email → enable "Leaked password protection"**
   (HaveIBeenPwned check). Verify it is actually on — Supabase's database linter
   reports it as disabled by default, and the application's own password rule is
   only "8 characters with a letter and a number".
2. **Storage** must contain the `job-photos` (private) and `item-photos` (public)
   buckets.
