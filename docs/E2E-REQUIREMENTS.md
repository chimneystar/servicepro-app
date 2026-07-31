# End-to-end testing — what we need from you

**Audience:** the engineer (or Claude Code instance) working on the owner's side.
**Date:** 2026-07-31
**Status:** requested — not blocking. Work continues without it.

---

## Read this first: we are not touching your live system

To be explicit about scope, because it shapes every request below:

- **Everything runs on our machines, against a throwaway database.** We are not
  pointing tests at your deployed environment.
- **We do not want production credentials.** Please do not send them. Several
  code paths under test create, modify and *delete* records — including a daily
  job that permanently deletes customer data. None of that should ever run
  against a real business's records.
- **Nothing touches your deployment until the pull request is reviewed and
  approved by you.** After approval we can discuss a staging deploy; until then
  this is entirely local.

If the only credentials available are production ones, the honest answer is that
we would rather have nothing. We can prove the security properties that matter
without any credentials at all (see "What we can already do" below).

---

## What we are asking for

A **separate, disposable Supabase project** used for nothing else. Free tier is
fine. It should contain no real customer data, ever.

### 1. Supabase project details

| Variable | What it is | Where to find it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key | same page |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key | same page — **server-only, never in a browser** |

> The service-role key bypasses all row-level security. It is only acceptable to
> share here because this project holds no real data. Do not send us the
> equivalent key for any project that does.

### 2. Database schema

Apply the migrations to that project, in order, following
[`db/MIGRATIONS.md`](../db/MIGRATIONS.md) → *"Building a database from zero"*.

Please use that document rather than any earlier instructions: the previous
version stopped at `017_*` and silently omitted five migrations, producing a
database the application cannot run against.

Then run `db/016_isolation_tests.sql` and confirm it prints
`✔ ALL ISOLATION TESTS PASSED`. **If it does not, stop and tell us** — that is a
finding in itself, and more valuable than the credentials.

### 3. A seeded test user

One account we can sign in as:

- Email + password (a throwaway address is fine — e.g. `e2e@example.com`)
- Must have completed onboarding, so it belongs to an organisation
- Role: **owner** (it exercises the widest surface)

If email confirmation is enabled on the project, please confirm the address
before sending it, or disable confirmation on this project only.

**Ideally also**, so we can test that roles actually separate:

- A second user with role **office**
- A third with role **tech**, assigned to at least one job

That trio is what lets us prove a technician cannot reach financial data — one
of the two privilege-escalation issues this branch fixes.

### 4. Optional: payment provider test mode

Only if you want the payment flows covered end to end. **Test-mode keys only.**

| Variable | Notes |
|---|---|
| `HELCIM_PARTNER_TOKEN` | Helcim sandbox |
| `HELCIM_CONNECTED_WEBHOOK_VERIFIER` | sandbox |
| `HELCIM_PAYMENT_WEBHOOK_VERIFIER` | sandbox |
| `STRIPE_SECRET_KEY` | must begin `sk_test_` |
| `STRIPE_WEBHOOK_SECRET` | test endpoint |
| `TWILIO_*`, `RESEND_API_KEY` | optional; without them, SMS and email are stubbed |

If these are not provided, the payment logic is still covered by unit tests and
the flows are exercised with the providers stubbed. This is a nice-to-have.

`PAYMENT_SECRETS_KEY` we generate ourselves — do not send yours. It must decode
to exactly 32 bytes:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## How to send it

**Not** by email, chat, or committed to the repository. A leaked credential is
the one failure that cannot be undone by reverting — it has to be rotated.

Preferred, in order:

1. A password manager share link with an expiry (1Password, Bitwarden).
2. A one-time secret service (e.g. a self-destructing note).
3. If neither is available, say so and we will arrange something.

Format it exactly as `.env` lines so there is no ambiguity:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
E2E_USER_EMAIL=e2e@example.com
E2E_USER_PASSWORD=...
E2E_OFFICE_EMAIL=...
E2E_OFFICE_PASSWORD=...
E2E_TECH_EMAIL=...
E2E_TECH_PASSWORD=...
```

---

## What we can already do without any of this

So you can judge whether it is worth the effort:

| Already covered, no credentials needed | Needs the above |
|---|---|
| 151 unit tests — money arithmetic, balances, rate limiting, auth guards, environment validation | Browser tests of signed-in pages |
| Typecheck, lint, production build, all in CI on every push | End-to-end workflows (job → invoice → payment) |
| Migration hygiene checks (idempotency, no destructive DDL) | Proving role separation against a live database |
| Public-page browser tests (login, online booking, public documents) | Payment provider round-trips |
| **Tenant-isolation proof against a disposable Postgres in CI** (planned — needs no credentials) | |

The security properties that actually gate go-live — privilege escalation and
cross-tenant access — we can prove with a throwaway database we create ourselves.
What your credentials add is confidence that the *user interface* is wired
correctly on top of that, which is worth having but is a lower layer of risk.

**So: helpful, not blocking.** If it is easier to provide after the pull request
is reviewed, that is fine.

---

## Checklist

- [ ] Created a **new** Supabase project used for nothing else
- [ ] Confirmed it contains **no real customer data**
- [ ] Applied all migrations per `db/MIGRATIONS.md`
- [ ] Ran `db/016_isolation_tests.sql` — it printed `✔ ALL ISOLATION TESTS PASSED`
- [ ] Created the owner test user (onboarding completed)
- [ ] Optional: created office and tech test users
- [ ] Optional: test-mode payment keys — verified `sk_test_` prefix on Stripe
- [ ] Sent via a password manager or one-time link, **not** email or chat
- [ ] Did **not** send any production credential
