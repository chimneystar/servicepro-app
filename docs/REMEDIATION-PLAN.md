# ServicePro — Remediation Plan (living state)

**Branch:** `fix/production-hardening` (off `main` @ `30ec629`)
**Goal:** fix **everything**, not just the blockers. Target: production-grade for a real company.
**Started:** 2026-07-31

> **This file is the hand-off.** It is written so a cold session with no memory of this work can pick
> it up: read `docs/AUDIT-2026-07-31.md` (evidence), `docs/FEATURE-INVENTORY.md` (what must not be
> lost), then this file (what to do next). Update the status column the same turn anything changes.

## Ground rules for this branch

1. **Nothing gets dropped.** `docs/FEATURE-INVENTORY.md` is the contract. Any capability listed there
   must still exist (or be deliberately, explicitly removed with a note) when this branch merges.
2. **Every fix ships its probe.** A regression that reaches a real company is the failure mode we are
   here to prevent. Each defect fixed gets a test that fails before and passes after.
3. **Security fixes land first**, because they gate go-live regardless of anything else.
4. **The threat model is PostgREST, not the UI.** An attacker skips server actions and talks to
   `/rest/v1/` with the anon key. Every policy change is judged against that, not against the screen.
5. **Verify at the database, not by reading.** Static confidence is not proof; where a live Postgres
   is available, prove the exploit fails after the fix.

## Phase order

| Phase | Content | Gate to leave the phase |
|---|---|---|
| 0 | Test harness works at all | `npm test` green, all 10 files runnable, CI-able |
| 1 | Security blockers (§4 items 1-6, 17-21) | each exploit re-run and refused |
| 2 | Money correctness (deposits, balances, reporting) | integer-exact assertions on each path |
| 3 | Data-integrity + ops (migrations, monitoring, backup) | fresh-DB rebuild reproduces prod schema |
| 4 | Correctness bugs (dispatch pollution, sync, races) | probes for each |
| 5 | Missing high-value features | per feature: works end to end |
| 6 | Architecture + maintainability (types, data layer, design system, a11y) | typecheck strict, a11y lint green |

## Live task ledger

Status: `TODO` / `WIP` / `DONE` / `BLOCKED`. Keep this honest — a status doc that lies is worse than none.

### Phase 0 — make the harness real
| # | Task | Status |
|---|---|---|
| 0.1 | Fix `tests/booking.test.mjs` (imports `.ts` under `node --test`) — move pure booking logic to `lib/core/booking.mjs` | DONE |
| 0.2 | Wire ALL test files into `npm test` (7 of 10 are currently orphaned, including the two best) | DONE |
| 0.3 | Replace tautological RLS greps in `feature-preservation.test.mjs` with real assertions | DONE |
| 0.4 | Add `test:e2e` script + Playwright `webServer` + auth setup project | DONE |
| 0.5 | Add CI workflow: typecheck + lint + test on every push | DONE |

### Phase 1 — security blockers
| # | Task | Status |
|---|---|---|
| 1.1 | **Migration 023:** constrain `role`, `commission_pct`, `active`, `organization_id` in `profiles_self_update` WITH CHECK | DONE |
| 1.2 | **Migration 023:** restrict `invitations` writes to owner; reject `role='owner'` inside `accept_invitation()` | DONE |
| 1.3 | **Migration 023:** mirror `jobs_update` USING predicate into WITH CHECK | DONE |
| 1.4 | **Migration 023:** `job_time_entries` — constrain `user_id = auth.uid()` for non-owner/office | DONE |
| 1.5 | **Migration 023:** add role predicate to the 24 blanket-select tables from migration 019 | DONE |
| 1.6 | **Migration 023:** `TO authenticated` + explicit anon revokes on the 32 legacy tables | DONE |
| 1.7 | **Migration 023:** `approve_document` — guard on `signed_at is null`, add rate limit | DONE |
| 1.8 | **Migration 023:** portal token expiry (180d, enforced on lookup) + `rotate_customer_portal_token()` + payload narrowed to 24 months. **Nested document tokens KEPT** — see 1.9. | DONE |
| 1.9 | ~~Remove payout details (Zelle/check) from `public_payment_options`~~ — **REJECTED after review, not skipped.** Those fields *are* the payment instructions: a customer cannot mail a cheque without the payee address, and cannot open their invoice without its token. Removing them breaks the feature. The actual exposure was the *permanent, irrevocable* portal link that chained to them, which 1.8 closes. Revisit only if a tighter model is wanted (e.g. per-document short-lived tokens). | REJECTED |
| 1.10 | **Migration 023:** `item-photos` storage policies | DONE |
| 1.11 | **Migration 023:** `subscriptions` — make billing state service-role only | DONE |
| 1.12 | Cron route: fail **closed** when `CRON_SECRET` unset; timing-safe compare; stop leaking error strings | DONE |
| 1.13 | SMS webhook: validate Twilio signature; resolve org from the `To` number, not a global scan | DONE |
| 1.14 | `deletePhoto`: derive path from the row, add role check | DONE |
| 1.15 | `autoSendDocument`: derive `origin` server-side, assert org match, escape HTML | DONE |
| 1.16 | Security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy) in `next.config.mjs` | DONE |
| 1.17 | Rate limiting on all unauthenticated endpoints | DONE |

### Phase 2 — money correctness
| # | Task | Status |
|---|---|---|
| 2.1 | Link invoices to their originating estimate; credit paid deposits (**overbilling**) | DONE |
| 2.2 | Stripe deposit webhook: set `estimate_id` so deposits are not orphaned | DONE |
| 2.3 | Invoice detail: filter to settled payments, subtract refunds | DONE |
| 2.4 | Reports: collected revenue from payments, not invoice totals; fix margin to include discount/tax | DONE |
| 2.5 | Commission from collected money, not quoted price | DONE |
| 2.6 | Idempotency: `convertEstimateToInvoice`, manual submissions, Stripe replay window | DONE |
| 2.7 | Replace float money maths in finance/growth/operations with `parseAmountToMinor` | DONE |
| 2.8 | Payments export: filter in SQL, remove silent truncation | DONE |
| 2.9 | **DECIDED: USD only.** Remove ILS/EUR from the onboarding currency choice and the `organizations.currency` check, so nobody can select a currency the payment path rejects. Hebrew UI is unaffected — language and currency are independent. | DONE |

### Phase 3 — data integrity + operations
| # | Task | Status |
|---|---|---|
| 3.1 | Migration ledger table + runner; rename baseline `001_`; regenerate `schema.sql` | TODO |
| 3.2 | Rewrite `MIGRATIONS.md` DR runbook (currently omits 018-022); delete `GO-LIVE.sql` | DONE |
| 3.3 | Env-var validation at boot (zod), fail loudly not at 3am | DONE |
| 3.4 | Error monitoring + structured logging; cron must report failure, not always `ok:true` | DONE |
| 3.5 | Backup/restore + rollback runbook | DONE |
| 3.6 | Add the ~12 missing hot indexes | DONE |

### Phase 4 — correctness bugs
| # | Task | Status |
|---|---|---|
| 4.1 | `end_date` NOT NULL + default; fix both recurring generators (dispatch pollution) | DONE |
| 4.2 | Recurring `next_due` catch-up; prevent duplicate generation | TODO |
| 4.3 | Offline sync: close time entries, drop rejected events | DONE |
| 4.4 | `clockIn` race — DB uniqueness on open entries | TODO |
| 4.5 | Dispatch reassignment: remove stale lead assignment; surface double-book conflict | TODO |
| 4.6 | Search: parameterise the PostgREST `.or()` filter injection | DONE |
| 4.7 | Pagination on `/jobs`, `/schedule`, `/messages`, dashboard, reports | TODO |
| 4.8 | Booking: timezone support **DONE**; polygon service areas **PARTIAL — see note below** | PARTIAL |
| 4.9 | Reminders: mark sent AFTER send; allow retry | DONE |
| 4.10 | Surface swallowed errors (26 discarding call sites, 21 void actions) | TODO |
| 4.11 | Crew assignment must respect the no-double-book constraint | TODO |

**Note on 4.8 — why it is PARTIAL and not DONE.**

*Timezone: done.* `db/029_booking_timezone.sql` adds `booking_settings.timezone`
(IANA, default `America/New_York`, NOT NULL, validated against
`pg_timezone_names` by a trigger). `lib/core/booking.mjs` now converts wall clock
↔ instant through `Intl.DateTimeFormat` with an explicit `timeZone`, so the day
boundary and the minimum-notice cutoff are the business's, not the server's. No
new dependency. Owner picks the zone on `/settings/booking`. Tested with an
injected clock and named zones (Chicago / New York / Los Angeles / Phoenix /
Tokyo / UTC), including a DST transition; the suite passes identically under
`TZ=UTC`, `TZ=Pacific/Kiritimati` and `TZ=Pacific/Honolulu`.

*Polygons: NOT enforced, and cannot be without new infrastructure.* Testing a
point against a polygon needs a geocoded lat/lng for the customer's address.
This product geocodes nothing: `leads`/`customers` store address text only, there
is no PostGIS, there is no geocoding provider, and the Operations screen builds a
"polygon" by splitting a free-text box on commas — so `values_json` is not even
coordinate pairs. Implementing point-in-polygon would mean adding a geocoding
dependency and a polygon-drawing UI. That is a Phase 5/6 feature, not a bug fix,
so it is **not** claimed as done here.

What did change is that the toggle stopped lying:
- `evaluateServiceArea` is now actually called (`app/api/booking/[org]/submit`).
  "outside" → 422 as before. **"unevaluable" (polygon-only) no longer accepts
  silently**: the booking is taken but held in Leads as `requested` for manual
  approval, never auto-confirmed, and the lead carries
  `booking_answers.service_area_unverified = true`. The server logs the event.
  Customers of a misconfigured business are not turned away; no address is
  silently deemed in-area.
- `/settings/booking` warns the owner, naming the counts, and says enforcement is
  NOT active when every area is a polygon.
- `createServiceArea` refuses to create new polygon areas (the Operations form
  only ever offered ZIP/city, so this closes the server-side gap). Existing
  polygon rows are left untouched — nothing is dropped.

To close 4.8 fully, a follow-up needs: a geocoder, lat/lng on the address, a
polygon editor, and real coordinate storage. Until then this is PARTIAL.

### Phase 5 — finish the half-built screens
**SCOPE DECIDED 2026-07-31: every screen stays. Nothing is deleted; the unfinished third gets
finished.** These are the 19 items catalogued as STUB in `docs/FEATURE-INVENTORY.md` — UI or tables
that exist with nothing behind them.

| # | Stub to finish | Status |
|---|---|---|
| 5.1 | Refunds — write `refunded_minor`, wire `can_refund_payments`, provider refund call | TODO |
| 5.2 | Tips — collect at checkout, not just read in receipts | TODO |
| 5.3 | Saved payment methods | TODO |
| 5.4 | ACH hold-until-settled — make the toggle do something | TODO |
| 5.5 | Payment schedules / milestones — tables exist, zero app references | TODO |
| 5.6 | Org default deposit — saved but never read by document code | TODO |
| 5.7 | Booking deposit — actually charge it | TODO |
| 5.8 | Automation rules — build the executor | TODO |
| 5.9 | Campaigns + referral programmes — build the sender | TODO |
| 5.10 | Custom fields — definitions and values have no UI at all | TODO |
| 5.11 | Inventory movement ledger + parts consumption from jobs | TODO |
| 5.12 | Feature flags — nothing reads them | TODO |
| 5.13 | Push notification delivery — subscriptions stored, no sender | TODO |
| 5.14 | Photo "customer visible" flag — selected, never used | TODO |
| 5.15 | Call `lib/core/scheduling.mjs` transition rules from app code (written + tested, never invoked) | TODO |
| 5.16 | Tax jurisdictions — feed `computeDocument` instead of display-only | TODO |
| 5.17 | Support sessions — grant actual access | TODO |
| 5.18 | Invitation email delivery — token generated, never sent | TODO |
| 5.19 | Purchase orders — multi-line, status advance, receive step, inventory link | TODO |

### Phase 6 — new capabilities (from the gap analysis)
| # | Capability | Status |
|---|---|---|
| 6a.1 | Credit notes / invoice void (no way to correct an issued invoice today) | TODO |
| 6a.2 | Audit trigger on `payments` — the money table has no change history | TODO |
| 6a.3 | Unique constraint on document numbers; gapless numbering | TODO |
| 6a.4 | Trash / restore for soft-deleted records | TODO |
| 6a.5 | Lock documents after send/payment | TODO |
| 6a.6 | Optimistic concurrency (no version column anywhere today) | TODO |
| 6a.7 | Whole-business data export | TODO |
| 6b.1 | Capture IP + user-agent (currently **zero** occurrences repo-wide) — e-sign evidence, login forensics | TODO |
| 6b.2 | Brute-force protection + login attempt log | TODO |
| 6b.3 | Permission-change history | TODO |
| 6b.4 | Admin-visible audit log UI | TODO |
| 6b.5 | Two-factor authentication | TODO |
| 6b.6 | Session management / device revocation / login alerts | TODO |
| 6b.7 | Server-side password policy | TODO |
| 6b.8 | SMS STOP handling — **DONE** in Phase 1 (opt-out now honoured by both reminder loops) | DONE |
| 6b.9 | Encryption-key rotation for provider tokens | TODO |
| 6c.1 | Parts consumption: job → inventory → job cost | TODO |
| 6c.2 | True job costing including labour | TODO |
| 6c.3 | Technician time off / non-working days | TODO |
| 6c.4 | Good/better/best estimate options | TODO |
| 6c.5 | Staff notifications (assignment, booking, payment received) | TODO |
| 6c.6 | Customer statements + structured dunning | TODO |
| 6c.7 | Calendar sync / iCal feed | TODO |
| 6c.8 | Appointment confirm/decline + "tech on the way" tracking page | TODO |
| 6c.9 | Scheduled/emailed reports | TODO |
| 6c.10 | Bulk operations on lists | TODO |
| 6c.11 | Technician skills / certifications + dispatch matching | TODO |
| 6c.12 | Accounting sync (QuickBooks / Xero) | TODO |

### Phase 7 — architecture + maintainability
| # | Task | Status |
|---|---|---|
| 6.1 | Generate Supabase types; remove `any` at the DB boundary | TODO |
| 6.2 | `lib/data/*` repository modules; mandatory pagination | TODO |
| 6.3 | One action contract; error/loading boundaries per route group; toast primitive | TODO |
| 6.4 | De-minify the 78 long-line files; Prettier + max-len lint | TODO |
| 6.5 | Design system: tokens + ~15 primitives; retire 871 inline style objects | TODO |
| 6.6 | Accessibility: label association (`htmlFor` is currently used **zero** times), focus visibility, dialog semantics, button types | TODO |
| 6.7 | Consolidate overlapping tables (line items, assignment models, permission systems) | TODO |

## Session continuity

There is no self-wake watchdog on this work. If a session ends mid-flight, recovery is:
1. `git checkout fix/production-hardening`
2. Read this file's ledger — the first `WIP` or `TODO` row is the next action.
3. Re-run `npm run typecheck && npm run lint && npm test` to establish where reality actually is
   before trusting any status above.

The ledger is the durable state. Chat is not.
