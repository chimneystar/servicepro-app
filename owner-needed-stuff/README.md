# ServicePro — local E2E database

A throwaway ServicePro database that runs entirely on your machine. **No hosted
Supabase project, no shared credentials, nothing pointed at production.**

This exists because `E2E-REQUIREMENTS.md` asked for a disposable project and
said, correctly, that no production credentials should change hands. This route
removes the need for any credential exchange at all.

---

## What you get

- All **21** migrations from `main`, in the correct order (the order in
  `db/MIGRATIONS.md` on `main` is wrong — see *Why the file numbering skips 016*).
- A real Supabase stack — Postgres, GoTrue, PostgREST, Storage — so RLS,
  `auth.uid()` and role separation behave exactly as they do in production.
- Three seeded users: **owner**, **office**, **tech**, with the tech assigned to
  a job so privilege-separation tests have something to assert against.
- Outbound mail captured locally by Inbucket. Nothing leaves the machine.

## Requirements

- Docker
- Supabase CLI — `brew install supabase/tap/supabase`
- Node 20+
- `jq` (for the one-liner below; otherwise read the key off `supabase status`)

## Setup

```bash
# 1. Copy this directory's supabase/ folder to your repo root, then:
supabase start

# 2. Apply every migration to a clean database
supabase db reset

# 3. Seed the org and the three users
export SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o json | jq -r .SERVICE_ROLE_KEY)
export SUPABASE_ANON_KEY=$(supabase status -o json | jq -r .ANON_KEY)
npm i @supabase/supabase-js        # if not already installed
node seed.mjs                      # writes .env.e2e

# 4. Prove tenant isolation holds — this is the gate
psql "$(supabase status -o json | jq -r .DB_URL)" -f isolation-tests.sql
```

Step 4 must print:

```
✔ ALL ISOLATION TESTS PASSED
```

**If it does not, stop.** As the requirements doc says, that is a finding in
itself and more valuable than any credential.

## Verify the build actually completed

Stopping migrations early produces a database the app cannot run against, and it
fails quietly — most pages just render empty. Check before trusting anything:

```sql
select
  to_regclass('public.booking_services')     is not null as "020_booking",
  to_regclass('public.job_warranties')       is not null as "021_warranty",
  to_regclass('public.privacy_requests')     is not null as "022_privacy",
  to_regclass('public.profile_capabilities') is not null as "018_permissions";

select count(*) from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE';   -- expect 97
```

All four booleans `true`, and **97** base tables.

## Running the app against it

```bash
cp .env.e2e .env.local
npm run dev
```

Sign in with any of the three addresses; passwords are in `.env.e2e`, regenerated
on every seed run and never reused.

---

## Seeded fixtures

| User | Role | Capabilities |
|---|---|---|
| `e2e-owner@example.com` | owner | All 12 — `loadCapabilities()` short-circuits for owners and never reads the table |
| `e2e-office@example.com` | office | Customers, schedule, jobs, estimates, invoices, reports. **No** payments, settings or team |
| `e2e-tech@example.com` | tech | Customers (view), schedule, jobs. **No** invoices, payments or reports |

Plus one organisation (*E2E Test Co*, USD), one customer, and one job today at
09:00 **assigned to the tech**.

The tech's capability row is the interesting one. It is deliberately minimal so
the negative assertions have something to bite on: a technician signed in as
`e2e-tech@example.com` must not be able to reach `/invoices`, `/finance`,
`/reports` or `/settings/payments`, and the corresponding server actions must
throw. That is the privilege-separation case the requirements doc describes.

---

## Why the file numbering skips 016

There is **no `016_*` migration.** `016_isolation_tests.sql` is a test script, so
the sequence runs `…015`, then `017`, `018` … `022`. The gap makes "stop after
017" look like a natural endpoint, which is exactly the mistake baked into
`db/MIGRATIONS.md` on `main`:

> Run `schema.sql`, then `002_*` … `015_*`, followed by `017_*`, then create the two storage buckets.

That omits **018, 019, 020, 021, 022** — permissions, operations/growth, the
entire booking experience, warranties and call tracking, and privacy/finance/
admin. The migrations in this bundle are already renumbered so the Supabase CLI
applies them in the right order and the trap cannot be stepped in:

```
001_schema.sql                        ← db/schema.sql, renamed so it sorts first
002_batch1.sql … 015_indexes.sql      ← unchanged
017_helcim_payments.sql … 022_*.sql   ← unchanged
```

`016_isolation_tests.sql` is deliberately kept **outside** `supabase/migrations/`,
at the top level as `isolation-tests.sql`, so `supabase db reset` cannot pick it up.

## A note on production drift

Production currently has **102** base tables; a clean build from `main` has
**97**. The five extras — `communications`, `conversations`,
`communication_attachments`, `integration_connections`, `provider_webhook_events`
— come from `supabase/migrations/20260727000100_live_communications_payments.sql`
on the unmerged branch `feature/live-communications-payments`, which was applied
to the live database anyway.

**This is expected, not a provisioning error.** Build from `main`. If a test
fails against a table that exists in production and not here, that branch is why.
All five are empty and nothing on `main` reads or writes them.

---

## What was and was not verified

Stated plainly, because untested setup instructions are worse than none:

**Verified**
- All 22 SQL files parse with the real PostgreSQL parser (libpg_query via
  `pglast` v8.4) — 680 statements, zero failures.
- Migration ordering: the 21 filenames sort into the intended sequence under the
  CLI's lexicographic ordering.
- `seed.mjs` parses under Node, and its localhost guard was tested against
  `127.0.0.1.evil.com` and `localhost.evil.com`, both correctly rejected.
- The 97-table figure is a count of distinct `create table` targets across the
  21 files, cross-checked against the live database.

**Not verified**
- **The migrations have not been executed.** Docker, Postgres and root were all
  unavailable in the environment where this bundle was built, so the SQL was
  parsed but never run. Expect to fix something on the first `supabase db reset`.
- `seed.mjs` has not been run against a live stack. The column names were read
  from `db/schema.sql` and `db/018_product_foundation.sql`, but the insert
  payloads are untested.
- Storage buckets (`job-photos` private, `item-photos` public) are **not**
  created by this bundle. Create them in Studio at `http://localhost:54323`, or
  the job-photo paths will fail.
