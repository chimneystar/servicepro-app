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
| 0.6 | **A real database in CI.** `.github/workflows/db.yml` stands up `postgres:16`, applies `schema.sql` + all 26 numbered migrations in order, runs `db/016_isolation_tests.sql` (which nothing had ever executed), then runs 85 adversarial assertions in `db/ci/` as impersonated users — tech, office, owner, other-tenant owner, anon. Closes the gap that every security assertion in the suite was static analysis of SQL text, which cannot prove a policy refuses a query. | **WIP — WRITTEN, NEVER EXECUTED.** No Postgres, Docker or psql on the authoring machine. Verified only by inspection: bash syntax, YAML parse, balanced dollar-quoting, and a grep-derived inventory of the Supabase objects the shim must provide. Nobody may call this DONE until a green run exists in Actions. |

**What 0.6 actually contains** — `db/ci/00_supabase_shim.sql` (the `anon`/`authenticated`/`service_role`
roles, `auth.uid()` backed by a settable `request.jwt.claim.sub` GUC, `auth.users`, `storage.objects`
+ `storage.foldername()`, `pgcrypto`, `btree_gist`, and the Supabase default grants **without which
migration 023 §8's revoke-from-anon would be a no-op and prove nothing**);
`10_fixtures.sql` (two tenants, five identities, fixed literal UUIDs); `20_privilege_assertions.sql`
(§2.1 + §2.12); `30_tenant_assertions.sql` (cross-tenant read/write on customers, jobs, invoices,
payments, plus timesheet privacy); `40_document_assertions.sql` (`approve_document` signs once);
`run.sh`. Every assertion proves **both directions** — the forbidden action is refused *and* the
legitimate equivalent still succeeds — because a suite that only ever refuses would pass against a
completely broken database. `run.sh` also enforces a minimum assertion count, so a suite that
silently stops running cannot go green.

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
| 1.18 | **REGRESSION FOUND while writing 0.6 — migration 023 §4 is a no-op.** It drops `job_time_entries_select`, `job_time_entries_write` and `job_time_entries_rw`, but migration 009 created those policies under different names: `time_entries_select` and `time_entries_write` (`db/009_v11.sql:94-100`). Both survive 023, both are PERMISSIVE, and both are org-only with no `user_id` predicate. Permissive policies are OR'd, so the old pair still grants what the new pair was written to deny: **a technician can still read and rewrite a colleague's timesheet**, exactly as audit §2.20 described. Task 1.4 is therefore not actually done. Fix: a migration that drops `time_entries_select` and `time_entries_write` by their real names. Three assertions in `db/ci/30_tenant_assertions.sql` are written against the correct behaviour and are expected RED until it lands. | TODO |
| 1.19 | Every other `drop policy if exists` in migration 023 was checked by hand against the migration that created the policy (`profiles_self_update`, `invitations_rw`, `jobs_update`, `subscriptions_rw`, the 019 `<t>_select` loop) and all of them match. `job_time_entries` is the only name mismatch found by inspection — but inspection is exactly what missed it for the whole life of the branch, so treat this row as provisional until the CI job in 0.6 has actually run. | DONE (by inspection only) |

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
| 4.2 | Recurring `next_due` catch-up; prevent duplicate generation | DONE |
| 4.3 | Offline sync: close time entries, drop rejected events | DONE |
| 4.4 | `clockIn` race — DB uniqueness on open entries | DONE |
| 4.5 | Dispatch reassignment: remove stale lead assignment; surface double-book conflict | DONE |
| 4.6 | Search: parameterise the PostgREST `.or()` filter injection | DONE |
| 4.7 | Pagination on `/jobs`, `/schedule`, `/messages`, dashboard (reports covered by 2.4/2.8) | DONE — dashboard money cards now read a rolling 12 months and are RELABELLED accordingly; see note |
| 4.8 | Booking: timezone support **DONE**; polygon service areas **PARTIAL — see note below** | PARTIAL |
| 4.9 | Reminders: mark sent AFTER send; allow retry | DONE |
| 4.10 | Surface swallowed errors (25 discarding call sites across 18 components, 10 void actions) | DONE |
| 4.11 | Crew assignment must respect the no-double-book constraint | DONE (migration `028_crew_double_book.sql` must be RUN — code assumes it) |

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


**4.7 — what was actually changed, and the one honest trade-off.** `/schedule` now loads the anchor
month ±14 days and `components/Calendar.tsx` re-fetches when the user pages outside it (the
containment invariant is proven exhaustively over eight years of dates in
`tests/query-window.test.mjs`, so it can neither loop nor show a falsely empty month). `/messages`
reads a page of recent messages and resolves customer names with a chunked SQL `or=` instead of the
whole customers table; `/messages/[phone]` filters the thread in SQL. `/jobs` keeps a limit but now
counts the real total at the database and says *"showing the 500 most recent of N"* with a Load more
link. `logCall` matches the caller with `ilike` on a digit-only suffix and re-checks the normalized
number — the old 1000-row scan was not merely slow, it was **wrong** past 1000 customers.

The dashboard is the trade-off: it cannot show an all-time collected total without reading every
invoice ever issued. It now reads a rolling 12 months (plus *all* open receivables and live
estimates, regardless of age, so nothing outstanding falls off the edge) and the Collections and
Sales cards are **relabelled** to say "last 12 months" instead of "all time". No card was removed;
the figure is narrower and the label now matches it. The setup checklist still uses exact
`count: exact, head: true` queries, because "have you ever created an estimate" must not be answered
from a rolling window. If an all-time figure is wanted back, it needs a materialised total or
PostgREST aggregates — not a wider `select`.

**4.10 — 25 discarding call sites across 18 components**, plus the 10 `void` actions in
`/operations` and `/growth`, which now return the `{ ok, error }` contract from
`app/(app)/customers/actions.ts` and are rendered through `components/ActionForm.tsx`. Two
success-shown-as-failure colour bugs went with them: `JobActions` inferred success from a leading
`"✓"` that the success string never had, and `RecurringClient` painted its error banner green.

### Phase 5 — finish the half-built screens
**SCOPE DECIDED 2026-07-31: every screen stays. Nothing is deleted; the unfinished third gets
finished.** These are the 19 items catalogued as STUB in `docs/FEATURE-INVENTORY.md` — UI or tables
that exist with nothing behind them.

| # | Stub to finish | Status |
|---|---|---|
| 5.1 | Refunds — write `refunded_minor`, wire `can_refund_payments`, provider refund call | PARTIAL — record + ledger + permission + audit trail DONE and tested; the Helcim provider call is implemented but has NEVER run (no sandbox credentials). Manual refunds are complete and exact. |
| 5.2 | Tips — collect at checkout, not just read in receipts | TODO |
| 5.3 | Saved payment methods | TODO |
| 5.4 | ACH hold-until-settled — make the toggle do something | TODO |
| 5.5 | Payment schedules / milestones — tables exist, zero app references | TODO |
| 5.6 | Org default deposit — saved but never read by document code | TODO |
| 5.7 | Booking deposit — actually charge it | TODO |
| 5.8 | Automation rules — build the executor | TODO |
| 5.9 | Campaigns + referral programmes — build the sender | TODO |
| 5.10 | Custom fields — definitions and values have no UI at all | TODO |
| 5.11 | Inventory movement ledger + parts consumption from jobs | DONE — ledger + derived quantity + job consumption (migration `033_inventory_movements.sql` must be RUN); see note |
| 5.12 | Feature flags — nothing reads them | TODO |
| 5.13 | Push notification delivery — subscriptions stored, no sender | TODO |
| 5.14 | Photo "customer visible" flag — selected, never used | DONE |
| 5.15 | Call `lib/core/scheduling.mjs` transition rules from app code (written + tested, never invoked) | DONE |
| 5.16 | Tax jurisdictions — feed `computeDocument` instead of display-only | TODO |
| 5.17 | Support sessions — grant actual access | TODO |
| 5.18 | Invitation email delivery — token generated, never sent | TODO |
| 5.19 | Purchase orders — multi-line, status advance, receive step, inventory link | DONE — actions + `/inventory/receiving` workspace; the `/operations` create form still posts one line (that file is owned elsewhere), see note |

**Note on 5.11 / 5.19 — what shipped, and the negative-stock decision.**

`db/033_inventory_movements.sql` adds `inventory_movements`, an append-only
ledger of every receipt, consumption and adjustment with its reason and actor.
`inventory_items.quantity` keeps working for every existing reader but is now a
DERIVED cache (alongside the exact `quantity_milli`) maintained by trigger from
the ledger, and a hand-written quantity is refused — so it cannot drift from the
ledger the way the old read-then-write did. `addJobPart` in
`app/(app)/jobs/[id]/actions.ts` writes the job line **and** the consumption, and
copies the item's `cost_minor` onto the line, so job cost includes materials for
the first time (this is also most of 6c.1). Removing the line returns the stock
as a NEW movement, never by deleting one.

*The negative-stock decision: refused by default, allowed when acknowledged.*
The guard runs inside a `BEFORE INSERT` trigger that first takes `select … for
update` on the item row, so two technicians consuming the last unit are
serialised and exactly one succeeds — the second is told there is none left.
That is the concurrency requirement. But a technician who has physically fitted
the part must still be able to record it: refusing outright would leave the count
wrong AND the job uncosted, which is strictly worse. So the refusal comes back
with `code: "insufficient_stock"`, and the UI offers to record it anyway; that
path requires `allow_negative` plus a reason of real length, drives the balance
negative, and the item is flagged on `/inventory` as needing a stock count until
someone reconciles it. Silent drift is impossible; acknowledged, attributed,
audited drift is possible, which is what the real world does.

*Purchase orders (5.19).* Multi-line create and `addPurchaseOrderLine`, a
lifecycle (`draft → ordered → partially_received → received`, plus `cancelled`)
enforced BOTH in `lib/core/inventory.mjs` and by a database trigger, and
`receive_purchase_order_line()` — one database function that locks the line,
records what arrived, writes the inventory receipt and advances the PO status in
a single transaction, so a double-click cannot receive twice. `total_minor` is
now derived from the lines. `purchase_order_items.quantity` was the only raw
float quantity left in the product; `qty_milli` / `received_qty_milli` are now
the truth and the numeric column is kept in step as a mirror (nothing dropped).
The new `/inventory/receiving` workspace is where POs are ordered, extended and
received.

*What is NOT done.* The `/operations` PO create form still posts a single line —
`app/(app)/operations/page.tsx` is owned by another workstream this session, so
only the action was changed (it accepts one or many identically). Nothing has
been executed against a live Postgres: the triggers, the lock and the RPC are
verified by inspection and by 25 probes in `tests/inventory.test.mjs`, each
proven to fail on the broken case and pass on the fixed one, but the row-lock
behaviour itself needs the 0.6 CI database to be proven rather than reasoned
about.

### Phase 6 — new capabilities (from the gap analysis)
| # | Capability | Status |
|---|---|---|
| 6a.1 | Credit notes / invoice void (no way to correct an issued invoice today) | TODO |
| 6a.2 | Audit trigger on `payments` — the money table has no change history | DONE — audit trigger on payments and payment_refunds (migration 030) |
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
| 6c.1 | Parts consumption: job → inventory → job cost | PARTIAL — job → stock → line `cost_minor` shipped with 5.11, and it reaches the margin report through `invoice_items.cost_minor`; the **commission** report still costs a job only from the hand-typed `jobs.job_expenses_minor`, so materials are invisible there until it also sums the line costs |
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
