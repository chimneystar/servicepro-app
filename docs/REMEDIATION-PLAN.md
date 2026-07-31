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
| 1.18 | **REGRESSION FOUND while writing 0.6 — migration 023 §4 was a no-op.** It dropped `job_time_entries_select/_write/_rw`, but migration 009 created them as `time_entries_select` and `time_entries_write` (`db/009_v11.sql:94-100`). Permissive policies are OR'd, so the old org-only pair survived and still granted what the new pair was written to deny — a technician could read and rewrite a colleague's timesheet, and task 1.4 was not actually done. **FIXED:** 023 now drops both real names (plus the wrong ones defensively, since a previous run may have created them). `tests/policy-replacement.test.mjs` covers the CLASS — it asserts that a migration replacing a table's policy set drops every policy an earlier migration created there, and was proven both ways by removing the fix and watching it fire. The three assertions in `db/ci/30_tenant_assertions.sql` should now pass; that remains UNCONFIRMED until the CI database job actually runs. | DONE |
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
| 5.2 | Tips — collect at checkout, not just read in receipts | DONE — offered on `/p/[token]`, charged on top of the balance, recorded in `payments.tip_minor`. See note. |
| 5.3 | Saved payment methods | **PARTIAL — deliberately not built.** No Helcim card-tokenisation (vault) credentials exist in this environment and there is no table to hold a token, so a card cannot be stored. The switch is now presented as unavailable, says why, and the stored preference is preserved rather than silently rewritten. Nothing fakes a saved card. See note. |
| 5.4 | ACH hold-until-settled — make the toggle do something | DONE — governs release of deposit-gated work; `can_override_ach_holds` releases early, on the record. See note. |
| 5.5 | Payment schedules / milestones — tables exist, zero app references | **PARTIAL — minimum coherent slice.** A deposit now creates a real schedule with milestones that advance from the payments recorded. No milestone editor, no arbitrary N-step builder, no per-milestone customer checkout. See note. |
| 5.6 | Org default deposit — saved but never read by document code | DONE — applied at estimate insert by `apply_default_estimate_deposit()` (migration 031). See note. |
| 5.7 | Booking deposit — actually charge it | DONE — computed from `booking_settings`, raised as a real estimate, paid through the existing `/p/[token]` screen; the job is not created until the money is in. See note. |
| 5.8 | Automation rules — build the executor | DONE (see note) |
| 5.9 | Campaigns + referral programmes — build the sender | PARTIAL — sending works; referral **redemption** unbuilt (see note) |
| 5.10 | Custom fields — definitions and values have no UI at all | DONE — defined on `/settings/custom-fields`, filled in and shown on customers and jobs, F21 closed at the database and mirrored in the action. See note. |
| 5.11 | Inventory movement ledger + parts consumption from jobs | DONE — ledger + derived quantity + job consumption (migration `033_inventory_movements.sql` must be RUN); see note |
| 5.12 | Feature flags — nothing reads them | PARTIAL — two keys gate real code; the three seeded platform keys still have no consumer (see note) |
| 5.13 | Push notification delivery — subscriptions stored, no sender | DONE — sender built (`lib/push.ts` + `lib/core/push.mjs`), triggered by technician assignment; dead endpoints removed; unavailability is reported, never silent. See note. |
| 5.14 | Photo "customer visible" flag — selected, never used | DONE |
| 5.15 | Call `lib/core/scheduling.mjs` transition rules from app code (written + tested, never invoked) | DONE |
| 5.16 | Tax jurisdictions — feed `computeDocument` instead of display-only | **PARTIAL** — effective-dated single-rate resolution + customer exemptions now price every document; `applies_to` of labour/materials/custom is NOT charged and says so. See note. |
| 5.17 | Support sessions — grant actual access | PARTIAL — the session is now the gate for tenant data in `/admin`, revocation is immediate, every attempt is audited. What remains is listed in the note: most platform screens still read tenant metadata on `platform_admins` alone, and no `guided_write` write path exists yet. |
| 5.18 | Invitation email delivery — token generated, never sent | DONE — the email is sent, the link carries the token, and `accept_invitation(token)` requires token + invited email. 023's owner-invite guard preserved verbatim. See note. |
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

**Notes on 5.8, 5.9 and 5.12 — migration `db/032_automation_execution.sql` must be RUN; the code
assumes it.** All three land together because they share one execution path: the daily cron.

*5.8 — what executes now.* `runAutomationRules()` (`lib/cron-tasks.ts`, called from
`/api/cron/daily`) evaluates every enabled rule each night. Supported pairs, and only these:
job completed → send SMS / send email / create task; estimate sent → send SMS / send email;
invoice overdue (issue date + N days, N from `condition_json.overdue_days`, default 14) → send SMS /
send email. **`create_task` is refused for the estimate and invoice triggers** — `job_tasks.job_id`
is NOT NULL, `estimates` has no job at all and `invoices.job_id` is nullable, so those rules could
only ever fire into a void. `createAutomation` now rejects them at creation with the reason instead
of storing a rule that silently never fires; `validateAutomationRule` is the single source of that
matrix and is proven both ways in `tests/automation.test.mjs`.

Idempotency: `automation_runs` is both the claim and the audit record. `uq_automation_runs_rule_source`
(migration 032) makes the insert the arbiter between concurrent runs, so a re-run cannot double-fire.
A failure is written back as `failed` with its message and re-claimed by compare-and-set on later
nights, up to three attempts; a *deliberate* skip (opt-out, no phone, no email) is recorded as
`skipped` **with its reason** and is terminal. A run stuck in `running` — process killed mid-send —
is deliberately NOT re-fired, because nothing can tell whether the SMS went out; it is logged loudly
and shown on `/operations`. Firing is bounded twice: never before the rule's own `created_at`, and
never more than two days back, so switching a rule on cannot text five years of finished jobs and a
cron outage cannot produce a burst of back-dated messages.

*5.9 — what executes now, and what was refused.* `runGrowthOutreach()` sends **campaigns** (status
`scheduled` and due) and **estimate follow-ups**. `createCampaign` only ever produced drafts, so a
`scheduleCampaign` / `pauseCampaign` pair was added — without it even a working sender had nothing to
send. Per-recipient claims live in the new `campaign_deliveries` table (unique on campaign+customer+
channel), so a campaign that dies half-way through resumes instead of re-texting the first half, and
a campaign with retryable failures goes back to `scheduled` rather than being declared `sent`.
Follow-ups retry three times and then fail visibly with `error_message`. **Opt-out is enforced for
every recipient** through `contactEligibility` — one pure, separately tested rule reading
`customers.sms_opt_in` / `email_opt_in`, refusing an *unset* flag as well as a false one (a query
that forgets to select the column would otherwise look like universal consent). Segments are
`all_customers`, `past_due` (unpaid ≥14 days, the same definition the overdue nudge uses) and
`inactive` (no job in 365 days); an unknown segment is refused, never widened to "everyone".

Referral **issuance** was the genuinely missing executor: nothing in the product had ever created a
`referrals` row, so no code was ever delivered. `issueReferral` now creates the code and sends it,
consent-checked, marking the row `sent_at` or leaving it visibly undelivered with its error. Referral
**redemption and reward payment** were NOT built — there is no attribution path (nothing sets
`referred_customer_id` or `reward_status`) and inventing one would mean guessing at the business
rules. That is why 5.9 is PARTIAL, not DONE.

*5.12 — an honest consumer, and an honest admission.* `feature_flags` is service-role only by
construction (migration 022 revokes it from `anon` and `authenticated`), so the only possible
consumer is trusted server code. Two keys now gate real work: `automation_rules` and
`growth_outreach`, evaluated by `lib/feature-flags.ts` + `lib/core/feature-flags.mjs` with
blocklist > kill switch > allowlist > deterministic rollout bucket, seeded **enabled at 100%** so
nothing silently stops working. This is a real kill switch on the two things in the codebase that
spend a business's money and text its customers on a timer.

What was NOT done: the three keys migration 022 seeded — `finance_operations`, `privacy_center`,
`support_access` — still gate nothing. Their workspaces are outside this scope
(`admin/**`, `settings/payments/**`), and wiring a flag to a screen nobody agreed to gate would be
inventing a use. **Stated plainly rather than papered over**, per the item's own instruction. A flag
read failure falls back to the configured default (on) and logs, because failing closed would make a
transient PostgREST error indistinguishable from the stored-but-inert defect being removed.

*Probes:* `tests/automation.test.mjs` (22), `tests/outreach.test.mjs` (18),
`tests/feature-flags.test.mjs` (15). Suite: 284 → 339, all green. Every structural assertion strips
comments first and is verified against the pre-change source (the old `operations/actions.ts` stored
`trigger_type` straight from the form and the old `cron-tasks.ts` contained none of
`contactEligibility`, `automation_runs` or `featureFlagEvaluator`, so all of them were RED before).

**Note on 5.13 — push notifications now actually arrive.**

`lib/core/push.mjs` implements Web Push end to end with no new dependency: RFC 8291 `aes128gcm`
(ECDH P-256 → HKDF-SHA256 → AES-128-GCM) and RFC 8292 VAPID (ES256 over `node:crypto`).
`lib/push.ts` is the sender: it reads the technician's enabled `device_subscriptions` with the
service role (RLS on that table is own-profile-only, so a dispatcher legitimately cannot see them),
sends one encrypted message per device in that device's own language, and writes the outcome to
`push_notification_events` — a table that existed and had never been written to.

*The trigger:* assigning a technician to a job. `moveDispatchJob`, `addJobTechnician` and
`createJob` (when it is booked straight onto someone) all call `notifyJobAssigned`. Delivery failure
is logged and never fails the assignment.

*Dead endpoints:* a push service answering 404 or 410 means the browser threw the subscription away,
so the row is deleted. `public/sw.js` now also handles `pushsubscriptionchange`, re-subscribing and
re-registering when the browser rotates a subscription — the other half of the same problem.

*Unavailability is stated, never silent.* With no (or mismatched) VAPID keys, `/api/devices/push`
answers `delivery: "unavailable"` with a bilingual reason and `/tech` says "this device is enrolled,
but notifications will NOT be delivered: …". The attempt is recorded with status `unavailable`.
`lib/core/env-check.mjs` validates the key lengths and the subject scheme; `lib/env.ts` additionally
proves the pair is a pair, because a mismatched pair is accepted by the browser and refused by every
push service for ever. `.env.example` carries the three variables EMPTY with generation instructions.

*Proof:* `tests/push.test.mjs` — 18 assertions including a full decrypt of what the sender produces
by a stand-in subscriber, a wrong-subscriber decrypt that must fail, and ES256 verification of the
VAPID assertion against both the right and the wrong public key. **Never executed against a real push
service** — there are no VAPID keys and no browser on this machine. The crypto is verified against
the RFCs by round trip; the HTTP exchange with FCM/Mozilla is not.

**Note on 5.17 — why this is PARTIAL, and what a session now really governs.**

`support_sessions` recorded a time-boxed, reason-bound, revocable grant that **no code anywhere
read**. `lib/platform-admin.ts` gated on `platform_admins` alone, so opening a session, letting it
expire and revoking it were all the same to the system.

What now depends on the session: `openBusinessSnapshot()` in `/admin` — the only call in the product
that reaches a specific business's own data (customer/job/invoice/team counts and the last ten
`audit_log` entries). It is refused, with the specific reason, unless a session for that admin and
that business is active, started, unexpired, unrevoked and of sufficient level. Every attempt,
granted or refused, is written to `support_session_events` (new in 034, service-role only like the
rest of the platform tables).

*Revocation is immediate and this is proven, not assumed:* the session row is re-read on every
attempt — nothing is cached anywhere — and `tests/support-access.test.mjs` flips `revoked_at` between
two evaluations of the same row and asserts the answer flips from granted to refused. A revoked
session that is still inside its time window is refused because revocation is checked first.

*What remains, and why this is not DONE:* the rest of `/admin` (the business registry, member counts,
privacy-configured flag, merchant status) still renders on `platform_admins` alone. Putting that
behind a session is a redesign of the console — staff need a business list *before* they can open a
case against one — and it is tenant metadata rather than tenant data. `guided_write` is implemented
and tested in the rules, but no tenant-write path exists for it to gate yet. Neither gap is claimed
as finished.

**Note on 5.18 — the invitation is sent, and the token finally means something.**

Two defects, both closed. (1) No email was ever sent — there was no `sendEmail` anywhere in the team
flow, and the screen told the owner to notify the person out of band. `inviteMember` now builds the
link from the server-side app URL, sends it through Resend, and records `delivery_status` /
`sent_at` / `delivery_error` on the invitation. When no provider is connected the invitation is still
created and the owner is told **in plain words that nobody was emailed**, with the link to send by
hand — the pending list shows per-invite delivery state, and a Resend button covers a bounce or an
invitation created before delivery existed. (2) `accept_invitation()` matched on **email alone**, so
the generated token protected nothing. `accept_invitation(token)` (migration 034) requires a token
matching an open, unexpired invitation **and** that invitation's email to equal the caller's auth
email. `/join?token=` parks the token in an httpOnly, SameSite=Lax cookie and `/onboarding` redeems
it.

*023 is not weakened:* the owner-invite guard added by 023 §2 (an `owner` invitation is honoured only
if an owner issued it) is carried over verbatim, and `tests/invitations.test.mjs` asserts it is still
in the SQL.

*The zero-argument `accept_invitation()` is NOT dropped* — it is replaced with a body that only
answers "which business am I already in?", so its grants and any caller survive while email alone
stops being a credential. To make sure that cannot strand anyone, `pending_invitation_hint()` tells a
signed-in user that an invitation is waiting for their address (without revealing the token) instead
of letting them create a second business by mistake.

*Not verified against a live database.* The migration is static-checked — it drops nothing, every
create is guarded, and every column it reads is asserted to exist in `schema.sql` / `018` / `022` —
but no Postgres was available here, so the SQL has never been executed. The same caveat as 0.6.

**Note on 5.10 — custom fields.** `custom_field_definitions` and `custom_field_values` were created by
migration 019 and had **zero** references in `app/`, `components/` or `lib/`. Now: definitions are
managed on `/settings/custom-fields` (owner) — text / number / date / choice / checkbox, required,
sort order, hide (keeps recorded values) or delete (cascades them, with a warning that says so);
values are captured and displayed on `/customers/[id]` and `/jobs/[id]`, editable by owner/office and
read-only for a technician, which is exactly what 019's `_manage` policy allows, so the screen and
the database agree.

The typing and the guard are pure and tested in `lib/core/custom-fields.mjs` — `value_json` is jsonb
and will store the string "banana" in a number field, so every value is coerced or rejected before it
is written. **Audit F21 is closed**: `custom_field_values.entity_id` is polymorphic with no foreign
key and no organisation guard, and 019's own trigger only ever checked the *definition*. Migration
035 adds `custom_field_values_entity_guard`, which refuses a value whose entity does not exist,
belongs to another tenant, or is the wrong kind of thing for its definition (a "customer" field
hanging off a job). `assertEntityReference` applies the identical rule in the server action so the
user gets a sentence rather than a 500, and the definition list is re-read from the database scoped
to the organisation, so a forged definition id in the form body is discarded, not written.

**Note on 5.16 — why it is PARTIAL and not DONE.**

*What now works.* `resolveTaxJurisdictions` in `lib/core/money.mjs` selects the rules in force on the
document's date — inactive, not-yet-effective and expired rules are excluded and each one says which
— and combines the rest **additively** into one effective rate, which is how US sales tax works
(state 6.25 + county 1 + city 1 is charged as 8.25% of the base, not three multiplications). The rates
are summed *before* the multiply, so there is a single half-up rounding for the whole document; a
20,000-case assertion proves the resolved path is cent-for-cent identical to the flat path at the same
effective rate. `customer_tax_exemptions` is now capturable on the customer record and zeroes the tax
while the certificate is valid, reporting the base as `exemptMinor` so exempt sales are not lost to a
filing. `computeDocument` was extended **additively**: every pre-existing test passes unmodified, and
a caller that passes only `taxRateBps` gets byte-identical results.

*Two things are deliberately not claimed.*

1. **`applies_to` of `labor` / `materials` / `custom` is not charged.** Line items in this product
   carry a `taxable` boolean and nothing else — no column anywhere classifies a line as labour or as
   materials — so the base such a rule applies to cannot be identified. Applying it to everything
   would overcharge; applying it to nothing quietly would undercharge. It is therefore excluded and
   **named on the Finance screen** as not charged, with the reason. Closing this needs a tax-class
   column on `estimate_items` / `invoice_items` / `price_book` and a control in the line-item editor.
2. **No address → jurisdiction matching.** Which rules apply is a per-organisation set, not a
   per-customer lookup. Customers store address *text*; nothing is geocoded and there is no
   state/county/city on the record, so a business trading across a tax boundary must still pick one
   set of rules. This is the same missing infrastructure that keeps 4.8's polygons open.

*Safety.* Jurisdictional tax is **opt-in** (`organizations.tax_mode`, default `'flat'`). An existing
business's documents are priced exactly as before until its owner turns it on from `/finance`, which
states what will change. Rates are read through the `document_tax_context` security-definer function
rather than a direct select, because migration 022 gated both tax tables behind `payments.manage`: an
office user with `estimates.manage` and no finance access would otherwise have read an **empty** rule
list and priced the document at 0% tax with no error at all. The function returns rates, effective
dates and exemption validity only — never a certificate number, document URL or reason.

`app/(app)/finance/actions.ts` also stopped writing `rate_bps` with `Math.round(rate * 100)`; a rate
is not money but it multiplies money, and that is the same float trap (`8.365%` was stored as
`8.36%`) with the same NaN-becomes-null failure. It uses `parsePercentToBps`.

**Notes on 5.2–5.7 (migration `db/031_payment_features.sql` — additive, drops nothing).**

*5.2 Tips.* `tips_enabled` and `suggested_tip_percents` were stored and editable; `payments.tip_minor`
was read when a receipt rendered and **written by nothing**. A customer now picks a percentage or types
an amount on `/p/[token]`. The rule, decided in `lib/core/tips.mjs` and enforced by the split in
`confirmHelcimCheckout`: **the tip is charged ON TOP of the balance and is not the business's money.**
`base_amount_minor` stays at the balance and `tip_minor` holds the tip, so the tip is automatically
outside every collected-money reader — revenue, margin, commission, invoice balance — and outside the
refundable ceiling `guard_refund_amount()` enforces (it caps at `base_amount_minor`, exactly as it
already excluded the Fee Saver surcharge). Returning a tip is a conversation, not a button. The tip is
carried on `payment_requests.tip_minor` so the client sends a *choice*, never a total; the server
recomputes it from the real balance. Zelle and cheque submissions do **not** offer a tip — the amount
there is the balance and the business verifies receipt by hand. One pre-existing wart fixed on the way:
an open checkout for a different amount used to block payment for a full hour with `session_busy`
(reachable whenever the balance changed, and constant once tips existed); it is now cancelled and
replaced.

*5.3 Saved payment methods — why PARTIAL and not DONE.* Storing a reusable card needs Helcim
tokenisation against a merchant vault. There are no such credentials in this environment (the same
reason 5.1's provider refund call has never been exercised), no table to hold a token, and no way to
prove a stored token would ever charge. Building it would mean shipping a switch that tells a business
their customers' cards are on file when nothing is stored — the exact failure mode this branch exists
to remove. The switch is therefore disabled, labelled *"not available yet"* with the reason, and
`updatePaymentSettings` preserves the stored value instead of reading a control the browser does not
submit (which would have silently written `false` on every save). To close it: Helcim vault
credentials, a `payment_methods` table with the token encrypted the way `merchant_secrets` is, an
explicit consent record, and a charge-with-token path proven against Helcim's test mode.

*5.4 ACH hold.* `ach_hold_until_settled` and the `can_override_ach_holds` permission were both read by
nothing, while the customer's screen promised "the job remains on hold until the bank confirms
settlement". The hold governs **release of deposit-gated work** — hold on (default): the work is
released when the deposit *settles*; hold off: released as soon as it is *submitted*, the business
accepting the return risk. It deliberately does **not** block a technician from completing a job in the
field: work already done is done, and refusing to record it because a customer's bank is slow would
corrupt the timesheet to no purpose. Release happens where the product actually learns a transfer
cleared — `reconcileHelcimTransaction`, which the daily cron and the provider webhook both call.
`/settings/payments` shows deposits awaiting clearance to anyone holding `can_override_ach_holds`, with
a Release button that writes `released_by` / `released_at` / `release_reason` and an `audit_log` entry.

*5.5 Schedules and milestones — what is built and what is not.* Built: a deposit creates a real
`payment_schedules` row with `payment_milestones` (deposit, then `remaining` balance so an edited total
cannot leave the schedule adding up wrong); the milestones advance `due → processing → paid` from the
payments actually recorded, which is what finally uses the `processing` status the table always had;
allocation is exact integer arithmetic with the rounding remainder placed rather than lost, and an
over- or under-allocation is reported rather than swallowed. **Not built:** no milestone editor, no
arbitrary N-step builder, no per-milestone customer checkout screen (`payment_requests.milestone_id`
and `document_type = 'milestone'` still have no writer), and no invoice-side schedules. Those are a
feature, not a repair.

*5.6 Organisation default deposit.* Applied by a `before insert` trigger on `estimates`, not by
application code, because `lib/documents.ts` is the single insert path for both estimates and invoices
and returns no id — an after-the-fact update would have to guess which estimate it had just made. The
rule fires only when `deposit_minor` is 0 (the column default, and the only available signal for "the
caller did not ask"), and clamps to the document total. `lib/core/deposits.mjs` holds the same
arithmetic, is unit-tested, and drives the worked example now shown under the setting so the owner can
see what it will do. **Untested against a live Postgres** — there is none on this machine; the SQL is
verified by inspection and by structural assertion only.

*5.7 Booking deposit.* `payment_mode` / `deposit_value` were echoed to the customer as "a secure
payment link will be sent after confirmation" and no link was ever produced. A booking that owes a
deposit now mints a real estimate for the service and returns its `/p/<token>` link, so the deposit is
paid through the checkout that already exists and already works — card, ACH, Zelle, cheque, Fee Saver,
receipts, reconciliation. No second payment path was invented. `deposit_value`'s units were undefined
in the schema; they are now stated: whole percent for `percentage`, whole currency units for `fixed`
(the settings input is `step=1` and cannot express cents), the whole price for `full`. The booking is
held in Leads until the money is in, which is where a booking already lands when `approval_required` is
on — and a business that requires approval still gets to approve, because only a booking that would
have auto-confirmed releases itself. A service with no price collects no deposit.

**Known gap, reported not fixed:** `lib/documents.ts:211` (`duplicateDocument`) omits `deposit_minor`,
so duplicating an estimate silently drops its deposit. Out of scope for this pass — `documents.ts` is
owned by another workstream on this branch.

### Phase 6 — new capabilities (from the gap analysis)
| # | Capability | Status |
|---|---|---|
| 6a.1 | Credit notes / invoice void (no way to correct an issued invoice today) | DONE — void + credit-note ledger, migration `036_document_integrity.sql` must be RUN. See note |
| 6a.2 | Audit trigger on `payments` — the money table has no change history | DONE — audit trigger on payments and payment_refunds (migration 030) |
| 6a.3 | Unique constraint on document numbers; gapless numbering | **PARTIAL — gapless is deliberately NOT delivered; see the numbering decision in the note.** The constraint, safe allocation and number release are DONE |
| 6a.4 | Trash / restore for soft-deleted records | DONE — `/trash` lists every soft-deleted customer, job, estimate and invoice with who deleted it and when (`deleted_by`, migration 037, backfilled from `audit_log`), and restores it. Owner/office, matching deletion. Restore is parent-first and enforced by trigger as well as by the action; a privacy-erased customer is never restorable. See 6a.4 note below |
| 6a.5 | Lock documents after send/payment | DONE (migration 036) — see note |
| 6a.6 | Optimistic concurrency (no version column anywhere today) | DONE (migration 036) — see note |
| 6a.7 | Whole-business data export | DONE — `/api/export/business`, owner-only, streams all 94 tenant tables paginated at 1000 rows, tenant-scoped explicitly on every query, bearer tokens redacted at every depth including inside `audit_log` jsonb. `/reports/export` states what is and is not in the file. See 6a.7 note below |

**Note on 6a.1 / 6a.3 / 6a.5 / 6a.6 — migration `db/036_document_integrity.sql` must be RUN; the
code assumes it. It drops nothing and refuses to run unless 030 has been applied.**

*6a.1 — correcting an issued document.* The product had exactly two ways to change an invoice a
customer already held: edit it in place (which rewrites the figures on the `/p/<token>` link they were
sent, retroactively and with nothing recording it) and soft-delete (which takes its number out of the
sequence). Now there are two proper instruments, and the choice between them is not cosmetic.
**Void** cancels a document nothing has been collected against; the row, its figures and its NUMBER
are all kept, `voided_at` / `void_reason` / `voided_by` are written, and the database refuses to sign
it (`approve_document`) or to open a `payment_requests` row against it — so the void holds for card,
ACH, Zelle and cheque without the checkout code knowing anything about it. **Credit notes** are the
instrument once money has changed hands: `credit_notes` is an append-only ledger with its own number
sequence, `invoices.credited_minor` is a derived cache maintained by trigger, and a trigger caps the
total at the invoice. Same shape as `030_refunds.sql`. A credit note issued in error is CANCELLED
(recorded, with its own reason), never deleted, so the credit-note sequence has no holes either.
A credit note deliberately does **not** move money — if the customer already paid and it is going
back, that is a refund as well, recorded separately, because they are separate events.

*6a.3 — THE NUMBERING DECISION: gaps are accepted, numbers are never reused.* A reused number puts
two different documents bearing the same number into two customers' hands and no filing untangles
that afterwards; a gap is only a question. So the item is marked **PARTIAL**, because "gapless
numbering" as written is not what shipped and claiming it would be a lie. What did ship makes the
gaps rare and the question answerable: **voiding preserves the number** (the ordinary cause of a
missing number now appears in the sequence as a cancelled entry rather than as nothing); allocation
takes `for update` on the organisation row and returns `greatest(counter, max(number in use)) + 1`,
so the `/settings` next-number override can no longer walk the counter backwards onto an issued
number; a failed insert hands its number back through `release_document_number()`, an exact
compare-and-set that returns it only if the counter has not moved and nothing has taken it; and a
genuine collision is retried rather than surfaced as a raw `23505`. **One correction to the item's
premise, stated because it was checked:** `db/schema.sql` DOES declare `unique (organization_id,
number)` inline on both tables (lines 163 and 196), so a database built from that baseline already
had it. 036 adds it only when no unique constraint over exactly those two columns exists, so an
existing database does not end up with a second redundant index.

*6a.5 — the lock.* `updateInvoice` had no status guard whatsoever. The lock now lives in three
places on purpose: `lib/core/documents.mjs` (the rule), the server action (which adds the one thing a
row trigger cannot see — money settled against the document), and a `before update` trigger on both
document tables **and both line-item tables**, because the threat model on this branch is PostgREST
rather than the UI, and locking the stored total while leaving the items writable would be worse than
either alone. `MATERIAL_FIELDS` and the SQL column list are asserted to be the same set.
`number` is immutable always. Coming OUT of a lock is refused too — the status dropdown's
approved → draft was a one-click unlock — with two deliberate exemptions: **`paid` is exempt**
(the Mark due button and `refundInvoicePayment` in `lib/payments/refunds.ts` both legitimately un-pay
an invoice, and breaking those would be a regression), and a **sent, approved or rejected estimate
can be REOPENED** with a reason recorded in the same statement. That exit exists because an estimate
is a negotiation, not a tax document; a signed one has no exit, and an invoice has none at all.
`sent_at` is new — nothing in the product tracked "sent" at all, which is precisely why an invoice
could be repriced after the customer received it. It is stamped where the link actually reaches the
customer: the Send dialog and the copy-link button, in **both** `DocDetailActions` and `DocList`.

*6a.6 — versioning.* `version` on `estimates` and `invoices`, bumped by trigger on every update. The
edit form carries the version it loaded; `updateDocument` puts it in the WHERE clause and reads the
affected rows back, so a second writer matches zero rows and is told — naming both version numbers,
saying plainly that nothing was saved, and saying to reload. A form that omits the field is refused
rather than quietly given the old last-write-wins behaviour.

*Probes: `tests/document-integrity.test.mjs` (57). Suite 510 → 567, all green.* Every assertion was
proven RED as well as green: the pure rules were re-run with `documentLock` forced to "unlocked",
`assertVersionMatch` forced to accept, and allocation reverted to `counter + 1` (12 failures); the
structural SQL assertions were re-run with the unlock guard removed, a material field dropped from
the trigger's list, 023's sign-once guard lost while copying `approve_document` forward, the
max-aware allocation reverted and DELETE granted on the ledger (5 failures); and the six wiring
assertions were re-run against the pre-change `lib/documents.ts`, `components/Doc*.tsx` and both
`actions.ts` files (6 failures). Structural checks strip comments first, so a comment describing a
guard cannot satisfy a check for the guard.

*What is NOT done, stated rather than papered over.*
1. **Nothing here has been executed against a live Postgres.** The same caveat as 0.6 and every
   migration since: the triggers, the row lock and the compare-and-set are verified by inspection and
   by the probes above, never run. The row-lock behaviour in particular needs the 0.6 CI database.
2. **The public `/p/[token]` screen does not yet show a void or a credit note.** `app/p/**` is
   outside this pass's file scope. A voided document cannot be paid or signed (both enforced in the
   database) and an invoice void reaches the screen through `status = 'void'`, but a voided ESTIMATE
   still renders as live. `public_document_correction(token)` was added for whoever owns that screen;
   `public_document()` was deliberately NOT rewritten, because reproducing its whole body to add one
   key is a needless risk to a function the customer-facing page depends on.
3. **`openBalance()` in `lib/payments/server.ts` does not subtract `credited_minor`.** That file is
   owned by another workstream. The consequence is narrow but real: the office screens and the
   invoice list net credit notes off correctly, the customer's checkout balance does not yet.
4. **Numbering is per-organisation and per-kind only.** No per-year or per-series numbering, which
   some jurisdictions want.

*One fix taken outside the four items, because the file was in scope:* `duplicateDocument` omitted
`deposit_minor`, so duplicating an estimate silently dropped its deposit request. Reported as a known
gap under 5.7 and closed here.

*Out-of-scope observations from this pass.* (a) `/settings` lets an owner set the next document
number by hand with no validation at all; 036 makes that safe by construction, but the screen should
still say what it will do. (b) `app/(app)/share-actions.ts` (`autoSendDocument`) is where a document
is genuinely emailed or texted, and it is the natural place to stamp `sent_at` — it was left alone
because it is outside this pass's file list, so a send that goes only through that path does not lock
the document. (c) `setInvoicePaid(false)` still leaves the payment row behind, already noted as
PARTIAL in `docs/FEATURE-INVENTORY.md`; with the lock in place that row is now what keeps the invoice
locked, which is the right outcome but is coincidental rather than designed.
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

*6a.4 Trash / restore — the rule that was chosen, and why.* Restore is **parent-first and never
cascades downward**. A job, estimate or invoice comes back only when every parent it points at is
already live (customer always; for an invoice also `job_id` and `estimate_id` when set). The
alternative — restore it anyway — produces an invoice sitting in the ledger attached to a customer no
screen can open: a record that looks whole and is not, which is the same class of failure as the
truncated export. Restoring a parent does **not** drag its children back, because they were deleted by
separate decisions. Two more refusals: a customer erased to satisfy a **completed privacy deletion
request** is never restorable (that erasure is a legal obligation, and the identifying columns were
overwritten anyway — "restoring" would yield a shell named `Deleted customer · 1a2b3c4d`), and a job
whose technician slot is now occupied is refused by the existing `jobs_no_double_book` exclusion
constraint, whose `23P01` is translated into an instruction instead of leaking. All three rules live in
`lib/core/recovery.mjs` (proven both ways) **and** as triggers in `db/037_recovery.sql`; the action
checks first so the user gets a readable reason naming the parent, the trigger is the authority because
a check-then-write in a server action is a race and covers only that one caller.

**Out-of-scope observations found while building it.** (a) `deleteCustomer`
(`app/(app)/customers/actions.ts:66`) calls `.delete()`, a HARD delete — it does not set `deleted_at`
at all. `customers_delete` RLS permits it for owner/office, and `jobs.customer_id` is `on delete
restrict`, so a customer with jobs fails (PostgREST reports the FK error) while a customer without jobs
is destroyed outright and can never appear in the trash. (b) Consequently the only writers of
`customers.deleted_at` are the privacy anonymiser and the migration-batch rollback, and the only writer
of `jobs.deleted_at` is the migration-batch rollback; the everyday mis-click path is
`softDeleteDocument` on estimates and invoices. The trash screen covers all four regardless, but
customers will not benefit until `deleteCustomer` is converted to a soft delete. Both files are owned
by other workstreams on this branch.

*6a.7 Whole-business export — what is in the file and what is not.* One owner-only streaming JSON
document at `/api/export/business` covering **all 94 tables that carry `organization_id`** (plus
`organizations` itself, keyed on `id`), paged 1000 rows at a time through the same `fetchAllPages` /
`pageThrough` pair the accounting CSVs now use — a second copy of "read all of it" would eventually
disagree with the first. Every query carries an explicit `.eq(orgKey, orgId)` taken from the session
profile, never from the request, on top of RLS.

The include/exclude line is **not "sensitive vs not" — it is "does this value authenticate someone?"**
The existing GDPR export gets this backwards in both directions at once: it ships `customers.portal_token`
and both documents' `public_token` (bearer credentials — holding the string *is* being that customer)
**and** internal `cost_minor` margins to a member of the public. Here: tokens are redacted even though
the file goes to the owner, because an export is copied, emailed and left in a downloads folder, and a
leaked one would otherwise be a live session for every customer at once; cost, margin, commission and
job expenses are **included**, because without them the file is not a copy of the business. Redaction is
by column name, recursive, and therefore also strips tokens out of `audit_log.old_data` / `new_data`,
which are whole-row jsonb snapshots — a top-level-only pass would have exported every token the business
ever had while the `customers` rows looked clean. Redacted keys are kept with a `[redacted …]` value so a
deliberate omission cannot be mistaken for a bug.

Excluded outright, each with the reason shown in the UI and repeated inside the file: `merchant_secrets`,
`payment_checkout_secrets` (credentials), `webhook_events` (no `organization_id` — no row can honestly be
attributed to one business), and `feature_flags` / `platform_admins` / `release_records` / `release_events`
(ServicePro's own platform data). **Not included, stated plainly on the screen:** files in Storage — job
photos and videos, logos, imported spreadsheets. The rows describing them (`job_photos.storage_path`, and
so on) are exported, so the owner has the full list, but the binaries are not in the JSON. Also excluded:
login credentials, which live in Supabase Auth and are not readable by the application. `meta` is written
**last**, as a trailer carrying `status`, per-table `rowCounts` and any `problems`; the screen tells the
owner to check that `meta.status` reads `complete`. A table that fails to read is recorded and the whole
file is marked `incomplete` rather than quietly shrinking, and a mid-stream failure aborts the response so
the file does not parse — a backup that fails loudly beats one that ends early and looks finished.

**Not verified against a live Postgres** — there is none on this machine. `db/037_recovery.sql` and the
manifest's 94 table/column pairs are checked by inspection and by structural assertion against `db/*.sql`
(`tests/business-export.test.mjs` fails if a future migration adds a tenant table that is neither
exported nor excused).

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
