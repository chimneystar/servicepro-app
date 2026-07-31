# ServicePro — Database migrations

Migrations are plain SQL, applied **in numeric order** by a runner that records
every one of them in the database. Every file is idempotent.

> **The authority is `public.schema_migrations`, not this document.**
>
> It used to be the other way round, and that is how this went wrong. There was
> no record in any database of which files had run, so this file *was* the
> ledger — and it was kept by hand, and it drifted. It stopped at `017_`,
> silently omitting migrations 018–022: roughly 1,370 lines of DDL covering
> permissions, dispatch, custom fields, booking, warranties, call tracking,
> privacy and platform administration. Followed as a disaster-recovery runbook
> it produced a database the application **cannot run against**, and nothing
> anywhere noticed.
>
> The sequence table below is now **generated from the files on disk**
> (`npm run db:docs`), and `tests/migrations-doc.test.mjs` fails the build if it
> and `db/` ever disagree. It can no longer stop early.

---

## The commands

| Command | What it does | Needs a database |
|---|---|---|
| `npm run db:plan` | Prints the sequence and checks `db/` is coherent — no gaps, no duplicate numbers, nothing unclassified | no |
| `npm run db:status` | What this database has applied, what is pending, what is wrong | yes |
| `npm run db:migrate` | Applies everything pending, in order, recording each | yes |
| `npm run db:migrate -- adopt --yes` | Records the sequence as already applied **without executing it** | yes |
| `npm run db:docs` | Regenerates the table below from `db/` | no |
| `npm run db:schema:dump` | Writes `db/schema.generated.sql` — a `pg_dump` of a database built from this sequence | yes |

Set `DATABASE_URL` (Supabase: *Project Settings → Database → Connection string*).
The runner shells out to `psql`; it adds no driver dependency.

---

## Migration identity — read this before renaming anything

**A migration is identified by its three-digit version prefix. Nothing else.**

`public.schema_migrations.version` holds `001`, `002`, … `041`. The slug after
the number (`_helcim_payments`) and the filename as a whole are recorded, but
they are *informational*. Two consequences, both deliberate:

- **Renaming a file does not re-run it.** `042_add_widgets.sql` →
  `042_add_gadgets.sql` is still migration `042`. The runner notices the change,
  reports it as a rename, and **refuses to continue** until you pass
  `--accept-renames` — so it is never silent, but it never re-applies DDL to a
  live database either.
- **Editing an applied file is refused.** The checksum is what we *check*, so it
  cannot also be what we look the row up by; if identity were the checksum, a
  tampered file would simply become a new migration and re-run itself silently.

### Why the baseline is now `001_schema.sql`

`db/schema.sql` had no number, so under filename ordering it sorted *after*
`041_`. It was renamed to `db/001_schema.sql`, which is safe precisely because
of the rule above:

1. **No identity changed — one was assigned.** `schema.sql` had no version, and
   no database anywhere held a ledger row for it, because no ledger existed.
   There was nothing to orphan.
2. **`001` is what production actually applied.** The owner's own Supabase
   bundle already ships the baseline as `001_schema.sql`; the live database was
   built from a file with that name. Our identity assignment agrees with the
   artifact that really ran, rather than inventing one.
3. **It fixes a real ordering bug.** Sorting last meant every tool that walked
   `db/*.sql` in filename order — including the repository's own policy-
   replacement guard — treated the baseline as the *newest* file and never
   compared anything against it.

### Adopting an existing database

A database that already carries this schema (production does) must **not** have
these files re-run against it. Bring it under the ledger instead:

```bash
DATABASE_URL=... npm run db:migrate -- adopt --yes
```

`adopt` records every migration as applied, with `origin = 'adopted'`, and
**executes nothing**. Checksums are taken from the files on disk at that moment:
that is the honest thing to record — it pins the content the environment is
declared to match, so any later edit is caught even though the original
application was never observed. Verify the schema really is there first (see
*Verify the rebuild*). After adopting, `npm run db:status` should report
everything applied and nothing pending.

Use `--through NNN` if the environment is only partway through the sequence.

---

## What the runner refuses to do

Failing loudly is the entire point; silence is what got this project here. Every
one of these stops the run, and every one is unit-tested in both directions —
firing on a planted defect and staying quiet on the good tree — in
`tests/migration-runner.test.mjs`.

| Refusal | What it catches |
|---|---|
| `checksum_mismatch` | An applied migration's file has been edited. The database was built from SQL that no longer exists. Write a new migration instead |
| `sequence_gap` | A version between the lowest and highest has no file at all — some environment applied a file this checkout cannot even name |
| `duplicate_version` | Two files claim the same number, so application order would be arbitrary and the ledger could record only one |
| `out_of_order` | A never-applied migration numbered *below* one that has been applied — merged behind the high-water mark, and would run against a newer schema than it was written for |
| `partially_applied` | A ledger row that was started and never finished. The files carry no transaction of their own, so part of one may have landed |
| `applied_file_missing` | The ledger names a migration this checkout does not have — the environment was migrated from a different branch. **This is the production situation today** |
| `renamed_migration` | A version's filename changed since it was applied |
| `unclassified_file` | A `.sql` file in `db/` that is neither numbered nor declared in `db/migrations.manifest.json` |
| `declared_file_missing` | The manifest declares a non-migration file that does not exist — a declaration with nothing behind it could hide a gap |
| `duplicate_ledger_row` | The ledger holds two rows for one version — that table is corrupt |

Checksums are taken over the file with **CRLF normalised to LF and any BOM
stripped**. That is not tidiness: the repository is developed on Windows with
`core.autocrlf=true` and built on Linux in CI, so the same commit produces
different bytes in the two trees — measurably so (`001_schema.sql` is 29,548
bytes with LF and 30,107 with CRLF, same 559 lines). A raw-byte checksum would
report tampering on every checkout that crossed a platform, and a guard that
cries wolf gets switched off.

---

## Building a database from zero (new project, or disaster recovery)

```bash
DATABASE_URL=... npm run db:migrate
```

That applies everything below, in order, and records it. To do it by hand,
`npm run db:plan` prints the exact ordered list.

<!-- BEGIN GENERATED SEQUENCE -->

<!-- Generated by `npm run db:docs`. Do not edit between these markers; edit
     db/migrations.manifest.json instead. tests/migrations-doc.test.mjs fails if
     this table and the files in db/ ever disagree. -->

**41 migrations**, applied in this order.

| Order | Version | File | What it adds |
|---|---|---|---|
| 1 | `001` | `001_schema.sql` | **Baseline.** Core tables, enums, RLS on every table, functions, triggers, indexes, the integer-minor-unit money model and the no-double-book exclusion constraint. Formerly `db/schema.sql`; renamed so it sorts first and can carry a ledger identity |
| 2 | `002` | `002_batch1.sql` | Item cost + image; job-photos storage policies |
| 3 | `003` | `003_team.sql` | `accept_invitation()` |
| 4 | `004` | `004_sharing.sql` | Public document token, `public_document` / `approve_document` |
| 5 | `005` | `005_more.sql` | `organizations.job_types` |
| 6 | `006` | `006_job_types.sql` | `job_types` table |
| 7 | `007` | `007_v9.sql` | Job/billing address, message templates, job tasks/equipment/checklists |
| 8 | `008` | `008_v10.sql` | Item title/taxable/photo, price book, deposits, document customisation, archive |
| 9 | `009` | `009_v11.sql` | Leads + booking RPCs, technician field tools, invoice online-pay columns |
| 10 | `010` | `010_v13.sql` | Customer portal, inventory, SMS direction |
| 11 | `011` | `011_v14.sql` | Recurring plans, reminder log, review URL |
| 12 | `012` | `012_v15.sql` | Custom job statuses, job stage/tags/expenses, commission % |
| 13 | `013` | `013_security_hardening.sql` | Fixed `search_path`, EXECUTE lockdown, booking rate limit, `webhook_events` policy |
| 14 | `014` | `014_tenant_isolation.sql` | Composite tenant FKs + org-guard triggers |
| 15 | `015` | `015_indexes.sql` | High-volume access-path indexes |
| 16 | `017` | `017_helcim_payments.sql` | Helcim connected accounts, provider-neutral payments, payment settings |
| 17 | `018` | `018_product_foundation.sql` | Per-member permissions, industry onboarding, device subscriptions |
| 18 | `019` | `019_operations_growth.sql` | Dispatch crews, custom fields, automations, operations, growth, customer portal |
| 19 | `020` | `020_booking_experience.sql` | Availability-aware bilingual online booking |
| 20 | `021` | `021_job_history_warranty_calls.sql` | Job actions, warranties, callbacks, call tracking |
| 21 | `022` | `022_operations_privacy_team_admin.sql` | Appearance, last-owner protection, finance/tax/settlement, privacy/retention, platform admin |
| 22 | `023` | `023_authorization_hardening.sql` | **Closes two privilege-escalation paths.** Not optional |
| 23 | `024` | `024_deposit_credit.sql` | Links invoices to their originating estimate so deposits are credited |
| 24 | `025` | `025_job_end_date_default.sql` | Stops jobs with a null `end_date` haunting the dispatch board |
| 25 | `026` | `026_usd_only.sql` | Aligns the currency constraint with what the payment layer can process |
| 26 | `027` | `027_hot_path_indexes.sql` | Indexes the lookups the app makes on every request |
| 27 | `028` | `028_crew_double_book.sql` | Extends the no-double-book guarantee to crew (`job_assignments`), not just the lead |
| 28 | `029` | `029_booking_timezone.sql` | `booking_settings.timezone` — booking slot maths runs on the business's clock, not the server's |
| 29 | `030` | `030_refunds.sql` | Refund ledger, derived refunded_minor, refund permission, and the audit trail payments never had |
| 30 | `031` | `031_payment_features.sql` | Tips, ACH release holds, payment schedules/milestones, org default deposit, booking deposits |
| 31 | `032` | `032_automation_execution.sql` | Automation-run uniqueness, per-recipient campaign delivery claims, and outreach send tracking |
| 32 | `033` | `033_inventory_movements.sql` | Append-only stock ledger, derived `inventory_items.quantity`, concurrency guard, multi-line purchase orders with a receive step |
| 33 | `034` | `034_notifications_support.sql` | Push event tracing, the support-access audit table, and an `accept_invitation(token)` that actually requires the emailed token |
| 34 | `035` | `035_custom_fields_tax.sql` | Guards `custom_field_values.entity_id` (audit F21 — polymorphic, no FK, no org check); adds opt-in `organizations.tax_mode` and `document_tax_context()` so tax jurisdictions and customer exemptions can price a document |
| 35 | `036` | `036_document_integrity.sql` | Credit notes and void (the original document and its NUMBER are kept), safe max-aware document numbering with a release-on-failure compare-and-set, the edit lock on sent/signed/paid documents and their line items, and a `version` column on both document tables. **Requires 030** — it refuses to run without `can_refund_payments()` |
| 36 | `037` | `037_recovery.sql` | `deleted_by` on the four soft-deletable tables (backfilled from `audit_log`), the restore-consistency and privacy-erasure triggers behind `/trash`, and indexes for listing deleted rows |
| 37 | `038` | `038_account_security.sql` | Request-context evidence for e-signatures (`document_signature_events`, `approve_document_with_evidence`), login attempt throttling and logging (`auth_login_attempts`, `record_login_attempt`, `login_throttle_counts`), an audit trail for role and capability changes (`permission_change_log`), per-profile security state, and `secret_key_rotations` so `PAYMENT_SECRETS_KEY` can be rotated without orphaning stored Helcim tokens. Additive: drops nothing, and preserves 023 §6's `signed_at is null` guard on `approve_document` verbatim |
| 38 | `039` | `039_scheduling_sales.sql` | Technician pay rates and labour costing, time off, skills, estimate options, appointment tokens |
| 39 | `040` | `040_communications.sql` | Staff notification inbox (claim + audit), the dunning ladder's per-rung claim, sent statements, **calendar feed tokens bounded like 023 §10's portal tokens** (NOT NULL expiry, revocation, scope), report schedules with a per-period delivery claim, the bulk-operation failure record, and accounting-export idempotency. Additive: drops nothing |
| 40 | `041` | `041_booking_locale_packs.sql` | The bilingual trade catalogue in the database, `job_types.name_en/name_he/pack_item_key`, a sync trigger that maintains the Hebrew booking-service name instead of copying the English one, a re-runnable `repair_booking_service_names()`, the pack menu for businesses that chose trades and have **no** job types (an org that already has any is skipped entirely), and an empty default for `organizations.job_types` so 005's HVAC list seeds nobody new. Additive: drops nothing |
| 41 | `042` | `042_void_signing_guard.sql` | **Security fix.** Restores `and voided_at is null` to `approve_document_with_evidence`. Migration 036 §11 added that guard so a VOIDED document could not be signed from its old public link; migration 038 replaced the function with the evidence-capturing version, carried the sign-once guard across VERBATIM and silently dropped this one. Between 038 and here, anyone holding the public token of a voided estimate or invoice could sign it into an approved, signed document. Found by executing db/ci/ for the first time (ledger 0.6). Replaces one function; drops nothing. |

### `.sql` files in `db/` that are NOT migrations

| File | Why |
|---|---|
| `016_isolation_tests.sql` | A **test**, not a migration. It creates two throwaway orgs, asserts every cross-tenant write is rejected, and deletes its own data. Run it after the sequence and confirm `✔ ALL ISOLATION TESTS PASSED`. This is why the migration numbering has no 016 — and why the gap is declared here rather than being a hole the runner has to guess about |
| `GO-LIVE.sql` | **Deprecated — do not run.** A byte-identical concatenation of 012 + 013 + 014 + 015, made as a one-shot for a deployment that had already applied 001-011. It is now many migrations stale and is not self-standing (it aborts on a fresh database because `accept_invitation()` does not yet exist). Retained only so an operator who used it can identify what they applied |
| `migrations-ledger.sql` | The ledger table itself (`public.schema_migrations`). Applied idempotently by `npm run db:migrate` before every run, so a database that predates the ledger can still be brought under it. Not numbered, because it must be able to run before migration 001 and can never itself be pending |

<!-- END GENERATED SEQUENCE -->

### Then, outside SQL

1. **Storage buckets** — create `job-photos` (private) and `item-photos` (private).
2. **Auth → Providers → Email → enable "Leaked password protection"**.
3. Set every environment variable in `.env.example`. The app validates these at
   boot (`lib/env.ts`) and refuses to start if a required one is missing, so a
   misconfiguration surfaces immediately rather than at the first customer payment.

### Verify the rebuild

`016_isolation_tests.sql` is a **test**, not a migration — which is why the
numbering has no `016`. The gap is declared in `db/migrations.manifest.json`, so
the runner knows it is not a hole. Run it after the sequence:

```bash
psql "$DATABASE_URL" -f db/016_isolation_tests.sql
```

and confirm `✔ ALL ISOLATION TESTS PASSED`.

```sql
-- Expect 97+ tables, and ZERO rows from this query.
select c.relname as table_without_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
```

Then check the ledger agrees with the tree: `npm run db:status`.

---

## The expected schema is derived, not hand-maintained

`db/001_schema.sql` is **migration 001** — a historical artifact, frozen. It is
no longer "the expected schema", and editing it is a checksum violation on every
database that has applied it.

The expected schema is whatever applying `001` … `041` to an empty database
produces. `npm run db:schema:dump` makes that concrete: it runs `pg_dump
--schema-only` against a database built by the runner and writes
`db/schema.generated.sql`. `.github/workflows/db.yml` builds exactly such a
database on every push and regenerates the dump there, so the artifact is
reproducible in CI rather than on somebody's laptop.

---

## Applying a new migration

1. Number it one above the highest — `npm run db:plan` tells you what that is.
2. Add its description to `db/migrations.manifest.json`, then `npm run db:docs`.
   `npm test` fails if you skip this, so a migration cannot be merged
   undocumented.
3. `npm run db:migrate`.
4. Re-run `016_isolation_tests.sql`.

Never edit a migration that has been applied anywhere. Write the next one.

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

Whatever you do, **fix the ledger to match**, or the next run will disagree with
the database. Deleting the row for a reverted migration makes it pending again.

Reverting `023_authorization_hardening.sql` **re-opens two privilege-escalation
paths**. Do not do it to work around a permissions complaint; fix the policy
instead.

---

## Recovering from a failed run

The runner stops and leaves the ledger row for the failing migration
**unfinished** on purpose, and refuses every later run until it is resolved.

1. `npm run db:status` names the version.
2. Read the file and work out how much of it landed. The files are idempotent,
   so re-running from the top is usually safe — but check anything that is not a
   `create ... if not exists` or `create or replace`.
3. Either finish it by hand and
   `update public.schema_migrations set finished_at = now() where version = 'NNN';`
   or undo it and `delete from public.schema_migrations where version = 'NNN';`
   to make it pending again.
