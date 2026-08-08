# Re: End-to-end testing — response from the owner's side

**Date:** 2026-07-31
**Re:** `E2E-REQUIREMENTS.md` (2026-07-31)

Understood, and the scope framing is appreciated — no production credentials will
be sent. Three things below: one blocker on your side, one request, and a set of
findings from an independent audit that you should reconcile against your branch
before either of us duplicates work.

---

## 1. `db/MIGRATIONS.md` on `main` is still broken — your checklist item 2 will fail

You wrote:

> Apply the migrations to that project, in order, following `db/MIGRATIONS.md` →
> *"Building a database from zero"*. Please use that document rather than any
> earlier instructions: the previous version stopped at `017_*` and silently
> omitted five migrations.

**That correction is not on `main`.** At `30ec629` (current `main` HEAD):

- There is **no section titled "Building a database from zero"**. The only
  fresh-build instruction is *"Fresh project (disaster recovery)"* at line 46.
- It reads, verbatim:
  > Run `schema.sql`, then `002_*` … `015_*`, followed by `017_*`, then create the two storage buckets.
- So it still omits **018, 019, 020, 021, 022** — exactly the five you flagged.

Your fix appears to live only on your unpushed branch. Anyone working from `main`
— including whoever provisions the E2E project — will build a broken database.

A corrected `MIGRATIONS.md` has been written on this side and can be dropped in,
or you can push yours; either is fine, but one of them needs to land on `main`.
The correct sequence is **21 files**:

```
schema.sql, 002 … 015, 017, 018, 019, 020, 021, 022
```

Then storage buckets, then `016_isolation_tests.sql` (a test script, not a
migration — the numbering gap is deliberate and is what makes "stop after 017"
look plausible).

Verification that the build actually completed — all four must be `true`:

```sql
select
  to_regclass('public.booking_services')     is not null as "020_booking",
  to_regclass('public.job_warranties')       is not null as "021_warranty",
  to_regclass('public.privacy_requests')     is not null as "022_privacy",
  to_regclass('public.profile_capabilities') is not null as "018_permissions";
```

A complete build from `main` has exactly **97 base tables** in `public`.

---

## 2. Heads-up: production is running schema from an unmerged branch

Relevant because it means a clean E2E database **will not match production**, and
you should expect that rather than treat it as a provisioning error.

```
production `public` base tables:        102
tables created by main's 21 SQL files:   97
```

The five extras — `communications`, `conversations`, `communication_attachments`,
`integration_connections`, `provider_webhook_events` — all come from
`supabase/migrations/20260727000100_live_communications_payments.sql`, which
exists **only** on `feature/live-communications-payments`. That branch was never
merged, but its migration was applied to the live database.

So the repository has two competing migration conventions (`db/*.sql` numbered by
hand, `supabase/migrations/*.sql` timestamped by the CLI) and production reflects
both.

**Resolution: that branch is intended to be merged.** Once it lands, code and
schema line up and the drift closes on its own. Until then, build E2E from
`main` and expect 97 tables, not 102. All five extras are empty and nothing on
`main` reads or writes them, so they are inert rather than dangerous.

Two things to fix as part of that merge:

- `provider_webhook_events` has **RLS enabled with zero policies**, so its webhook
  recorder will silently fail for anything that is not the service role.
- Pick one migration convention. Shipping both is how production ended up ahead
  of `main` without anyone noticing.

---

## 3. Two of your checklist items are already answerable

- **Leaked password protection** — `db/MIGRATIONS.md:41` already instructs that it
  be enabled. Supabase's linter reports it as **still disabled** on production.
  Unticked item from the project's own runbook.
- **`016_isolation_tests.sql`** — has not been run against production in this
  review. Your instruction to stop and report if it fails is the right one; it
  will be run against the fresh project as part of provisioning.

---

## 4. Please push your branch — there is an audit to reconcile against it

An independent UX/UI and bug audit was run against `main` @ `30ec629` on
2026-07-31 (source review plus a live click-through in both locales, signed in as
owner). It found six P0 issues. **Your doc mentions 151 unit tests and two
privilege-escalation fixes; `main` has 65 tests, and none of the six remote
branches match your description** — so your work is not visible from here and the
overlap can't be determined.

Before anyone acts on the list below, please confirm which are already fixed on
your branch:

| # | Finding | Evidence |
|---|---|---|
| **A1** | Type scale is inverted — 164 CSS rules under 12px, some at 7px. Dashboard greeting is 47px; the customer's name is 10px; alert copy is 8px. On the public booking page the service the customer must choose is 14px and the metadata is 9.5px. | `app/globals.css` histogram + live computed styles |
| **A2** | The "Larger text" accessibility toggle does nothing. `html[data-text-scale="large"]{font-size:112.5%}` only scales `rem`, but **0 of 384** `font-size` declarations use `rem`, plus 470 inline `fontSize` px props. Verified live: root 16px→18px, **zero** elements changed. | `globals.css:69` |
| **A3** | Expanding the "Tools" sidebar group renders all 11 of its destinations off-screen. Measured: `.side-nav` scrollHeight 1162px in a 738px container, `.side-utilities` starts at y=815. | live, 1491×812 |
| **A4** | **Invoices is unreachable on mobile.** `bottomItems.slice(0,4)` drops it from the tab bar, and `/more` filters out `bottom` items, so it appears in neither. | `components/Nav.tsx:29`, `app/(app)/more/page.tsx` |
| **A5** | Hebrew customers see English service names on the public booking page. `name_he` is seeded from `jt.name`, and the sync trigger's `on conflict do update` touches `name_en` only, so it can never self-correct. | `db/020_booking_experience.sql:78` + live |
| **A6** | Every business publishes the same hardcoded HVAC menu — a chimney sweep advertises "AC Install". `lib/industry-packs.ts` has a fully bilingual chimney pack that is never wired into `job_types`. | `db/005_more.sql:8` + live |

And one P1 that overlaps your territory directly:

| **B1** | `app/(app)/admin/page.tsx` queries **`merchant_accounts`, which does not exist** (it is `merchant_connections`), so merchant status reads "not connected" for every org. It fails silently because **161 of 189** Supabase reads destructure `{ data }` without checking `error`. Checked all 85 table names the code references against the live DB: 84 exist, this one does not. |

That last ratio is worth a lint rule regardless of who fixes the typo — a
mistyped table name currently cannot surface as an error, only as quietly wrong
data.

---

## 5. On credentials — we are sending none, and you should not need any

You wrote:

> If the only credentials available are production ones, the honest answer is
> that we would rather have nothing.

Agreed, and we are going one better: **no hosted project, no credential exchange
at all.** Attached is `servicepro-e2e/` — a bundle that stands the whole thing up
on your own machines:

```bash
supabase start
supabase db reset          # applies all 21 migrations, correct order enforced
node seed.mjs              # org + owner/office/tech, writes .env.e2e
psql "$DB_URL" -f isolation-tests.sql
```

Contents:

- `supabase/migrations/` — the 21 files from `main`, renamed so the CLI's
  lexicographic ordering *is* the correct order. `schema.sql` becomes
  `001_schema.sql`; the rest are unchanged. The 018–022 trap cannot be stepped in.
- `isolation-tests.sql` — kept deliberately **outside** `supabase/migrations/` so
  `db reset` cannot mistake the test for a migration.
- `seed.mjs` — creates the three users through the GoTrue admin API rather than
  by inserting into `auth.users` directly, since `auth.identities.provider_id`
  has moved more than once and direct inserts break across versions. It refuses
  to run against any host that is not localhost.
- `supabase/config.toml` — Inbucket on, email confirmations off (the seeded users
  are created pre-confirmed).

The tech user's capability row is deliberately minimal — no invoices, payments or
reports — so your privilege-separation assertions have something to bite on.

### What is and is not verified

- **Verified:** all 22 SQL files parse under the real PostgreSQL parser
  (libpg_query via `pglast` v8.4) — 680 statements, zero failures. Ordering
  confirmed. `seed.mjs` parses, and its localhost guard correctly rejects
  `127.0.0.1.evil.com` and `localhost.evil.com`.
- **Not verified:** the migrations have **not been executed**. Docker, Postgres
  and root were unavailable in the environment where this was assembled, so the
  SQL was parsed but never run. Expect to fix something on the first
  `db reset`. `seed.mjs` has likewise never run against a live stack — its column
  names were read from the schema files, but the insert payloads are untested.
- Storage buckets (`job-photos` private, `item-photos` public) are not created by
  the bundle; make them in Studio or the job-photo paths will fail.

If after all that you still want a hosted project, say so — but this should make
it unnecessary, and it means no production service-role key ever has to exist in
a share link.

Full audit and inventory available on request: `servicepro-audit.md`,
`servicepro-inventory.md`.
