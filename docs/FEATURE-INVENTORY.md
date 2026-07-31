# ServicePro — Feature Inventory (preservation contract)

**Date:** 2026-07-31. **Purpose:** an exhaustive list of every user-facing capability in the product,
so that no functionality is silently lost — whether the codebase is repaired in place or rebuilt.

**Status key**
- **REAL** — the flow reads and writes real data and completes end to end in code.
- **PARTIAL** — it works, but a named sub-piece is missing, hardcoded, or wrong. The gap is stated.
- **STUB** — the UI, setting or table exists but nothing executes behind it. **These are the items
  most likely to be mistaken for working features.**

Counts: **~190 capabilities — 138 REAL, 33 PARTIAL, 19 STUB.**

---

## 1. Jobs and field work

| Capability | Entry point | Users | State |
|---|---|---|---|
| Job list with stage tabs, tag filter, text search, aging | `/jobs` | owner/office/tech | PARTIAL — server caps at 500 rows, filtering is client-side, so older jobs vanish from tabs and counts |
| Create job (customer, service, tech, date, times, price, address, notes) | `/jobs`, `/schedule` | owner/office | REAL |
| Inline "new customer" while booking a job | `/schedule` | owner/office | REAL |
| Job-type defaults (duration auto-fills end time, default price) | JobForm | owner/office | REAL |
| Multi-day jobs (`end_date`) | `/schedule` | owner/office | PARTIAL — honoured by dispatch, but the calendar renders the job only on its start date |
| Double-booking prevention | DB exclusion constraint | — | REAL at DB level; surfaced as a clear message only on create, not on dispatch reassignment |
| Job detail with 11 tabs (details, items, payments, estimates, invoices, attachments, history, warranty, tasks, equipment, checklists) | `/jobs/[id]` | owner/office/tech | REAL |
| Change job stage (+ legacy enum sync, `stage_changed_at`) | `/jobs/[id]` | owner/office/tech | REAL — but no role check and no transition guard |
| Create invoice from job (line items or fallback, real numbering) | `/jobs/[id]` | owner/office | REAL |
| Service-address override per job | `/jobs/[id]` | owner/office | PARTIAL — action has no role gate |
| Job line items: add / delete | `/jobs/[id]` | owner/office | REAL |
| Job tasks: add / toggle / delete | `/jobs/[id]` | owner/office/tech | REAL |
| Checklists: add / toggle / delete | `/jobs/[id]` | owner/office/tech | REAL |
| Customer equipment register: add / delete | `/jobs/[id]` | owner/office/tech | REAL |
| Photo and video upload (Storage + signed URLs) | `/jobs/[id]` | owner/office/tech | REAL — 15 MB / 100 MB limits enforced client-side only |
| Photo markup / annotation saved as a linked copy | `/jobs/[id]` | tech | REAL |
| Photo "customer visible" flag | `job_photos.customer_visible` | — | **STUB** — column is selected and passed to the component but never rendered, toggled, or used to filter |
| Record payment against an invoice from the job | `/jobs/[id]` | owner/office | REAL |
| AI job-summary draft and approve | `/jobs/[id]` | owner/office/tech | PARTIAL — without an AI endpoint configured it writes a templated local summary; approve has no role check |
| Job history timeline (audit + notes + follow-ups + calls + warranty, merged) | `/jobs/[id]` | owner/office/tech | REAL |
| Add note / follow-up task with due date and assignee | `/jobs/[id]` | owner/office/tech | REAL — techs may only add notes and complete their own |
| Job completion report + print to PDF | `/jobs/[id]/report` | all + customer | REAL |
| "On my way" timestamp + customer SMS | `/tech`, `/jobs/[id]` | tech | PARTIAL — SMS only fires if Twilio is configured *and* an enabled template exists |
| Clock in / clock out, total hours on job | `/jobs/[id]` | tech | PARTIAL — no DB guard against duplicate open entries; a double-click double-counts hours |
| Complete job with canvas signature and signer name | `/jobs/[id]` | tech + customer | REAL |
| Job tags editor | `/jobs/[id]` | owner/office | REAL |
| Job expenses (feeds commission) | `/jobs/[id]` | owner/office | REAL |

## 2. Scheduling, dispatch and routing

| Capability | Entry point | Users | State |
|---|---|---|---|
| Calendar — day / week / month, job-type colours | `/schedule` | owner/office | PARTIAL — loads **every** job in the org with no date filter or limit |
| Dispatch board — drag a job between technician columns | `/dispatch` | owner/office | REAL — validates the target is in the org, optimistic UI with rollback |
| Add / remove extra crew on a job | `/dispatch` | owner/office | PARTIAL — reassigning a lead leaves the previous lead's assignment row behind |
| Dispatch date navigation | `/dispatch` | owner/office | REAL |
| Technician workspace — today + upcoming, start/complete | `/tech` | tech | REAL |
| Offline outbox — queue start/complete, auto-flush on reconnect, pending badge | `/tech`, `/offline` | tech | PARTIAL — rejected events are never dropped, so the badge can stick forever; completing offline never closes the timer |
| Offline snapshot of today's jobs | `/offline` | tech | REAL |
| Daily route sheet + one-click multi-stop Google Maps | `/route` | tech/office | REAL |
| GPS location sharing with consent record | `/fleet`, `/tech` | tech | PARTIAL — consent row is written implicitly by the first location POST rather than by an explicit consent step |
| Fleet view of last-known technician locations | `/fleet` | owner/office | REAL |
| Status-transition rules (done/cancelled terminal) | `lib/core/scheduling.mjs` | — | **STUB** — the logic exists and is well tested, but **no application code calls it** |
| Push notification enrolment (VAPID) | `/api/devices/push` | tech | **STUB** — subscriptions are stored; **no sender exists anywhere**, so no push is ever delivered |

## 3. Customers, leads and communications

| Capability | Entry point | Users | State |
|---|---|---|---|
| Customer list / create / edit / delete | `/customers` | owner/office | REAL — validated; delete restricted to owner/office |
| Customer detail — KPIs, job history, reviews, portal link, create estimate/invoice | `/customers/[id]` | owner/office | REAL |
| Add customer review (1-5) | `/customers/[id]` | owner/office | REAL |
| CSV paste import (≤5,000 rows) | `/customers/import` | owner/office | REAL — naive comma split, no quoted-field support |
| Leads pipeline — status board, convert to customer, delete, shareable booking link | `/leads` | owner/office | REAL |
| Call log with filters and missed/follow-up/booked stats | `/calls` | owner/office | REAL |
| Manual call logging with auto customer match | `/calls` | owner/office | PARTIAL — matches within the first 1,000 customers only; beyond that the call silently fails to link |
| Inbound call webhook — signature check, customer match, forwarding, recording notice | `/api/calls/incoming` | customer | REAL |
| Call status / recording webhook | `/api/calls/status` | — | REAL |
| Tracked phone numbers (label, source, campaign, forward-to, recording) | `/calls` | owner | PARTIAL — create and update only; no deactivate or delete |
| SMS inbox threads | `/messages` | owner/office | PARTIAL — fetches every message and every customer with no limit |
| SMS thread view and send (Twilio, or hand off to the phone's SMS app) | `/messages/[phone]` | owner/office | REAL |
| Inbound SMS webhook | `/api/sms/incoming` | customer | **PARTIAL / UNSAFE** — no signature validation and cross-tenant attribution (see audit §2.10) |
| Global search across clients, jobs, invoice/estimate numbers | `/search` | owner/office | PARTIAL — jobs match on service text only, not customer name; documents match only an exact number |
| Automatic review request on completion + manual "ask for review" | `/jobs/[id]` | owner/office | PARTIAL — needs a review URL configured; otherwise falls back to manual send |

## 4. Estimates, invoices and money

| Capability | Entry point | Users | State |
|---|---|---|---|
| Estimate list and create with line items (per-item taxable, cost, photo) | `/estimates` | owner/office | REAL |
| Estimate detail, PDF print, activity timeline | `/estimates/[id]` | owner/office | REAL |
| Estimate edit — items, discount, deposit amount | `/estimates/[id]/edit` | owner/office | REAL |
| Estimate status draft / sent / approved / rejected | `/estimates` | owner/office | REAL |
| Estimate duplicate and soft-delete | `/estimates` | owner/office | REAL |
| Convert estimate to invoice | `/estimates/[id]` | owner/office | **PARTIAL — a paid deposit is NOT credited; the customer is billed the full amount again.** No idempotency guard either |
| Deposit request on an estimate | `/estimates/[id]` | owner/office → customer | PARTIAL — amount typed by hand; paid state never shown internally |
| Organisation default deposit (percent / fixed) | `/settings/payments` | owner | **STUB** — saved to settings, never read by any document code |
| Invoice list and create | `/invoices` | owner/office | REAL |
| Invoice detail with paid / balance tiles | `/invoices/[id]` | owner/office | PARTIAL — **counts failed and in-flight payments as collected** |
| Invoice edit / duplicate / soft-delete | `/invoices/[id]` | owner/office | REAL |
| Mark invoice paid / unpaid by hand | `/invoices` | owner/office | PARTIAL — un-paying leaves the payment row behind; marking paid skips the insert if any payment exists |
| Line items — qty in milliunits, unit price in minor units, cost, taxable flag, image | everywhere | all | REAL |
| Tax — org rate, per-item taxable, applied on top | engine | all | REAL |
| Document-level discount with proportional taxable split | engine | all | REAL |
| Price book CRUD + auto-save items from documents | `/pricebook` | owner/office | REAL |
| Public pay link → Stripe Checkout (legacy path) | `/p/[token]` | customer | PARTIAL — coexists with Helcim, not balance-aware |
| Stripe webhook → record payment, mark paid | `/api/stripe/webhook` | system | PARTIAL — no amount check, no replay-timestamp tolerance, insert errors ignored |
| Helcim card checkout (HelcimPay.js) | `/p/[token]` | customer | REAL |
| Helcim ACH checkout (submit ≠ settle) | `/p/[token]` | customer | REAL |
| Helcim Fee Saver surcharge with graceful fallback | `/p/[token]` | customer | REAL |
| Helcim confirm with hash verification | `/api/pay/helcim/confirm` | customer | REAL |
| Zelle payment submission | `/p/[token]` | customer | REAL |
| Mailed-check submission (payee, address, mailed-on) | `/p/[token]` | customer | REAL |
| Manual payment review — confirm / reject | `/settings/payments` | owner, or office with permission | PARTIAL — no balance re-check at confirm time, so a late confirm can double-credit |
| Helcim merchant onboarding (partner registration) | `/settings/payments` | owner | REAL |
| Connected-account webhook → store encrypted API token | `/api/payments/connected-account` | system | REAL |
| Payment receipts by email and SMS, with dedupe lock | system | customer | REAL |
| Receipt retry job | daily cron | system | REAL |
| ACH reconciliation of processing payments | daily cron | system | REAL |
| Helcim transaction webhook → reconcile | `/api/payments/provider-events` | system | REAL |
| **Refunds** | — | — | **STUB** — a `can_refund_payments` permission exists and `refunded_minor` is read everywhere, but nothing ever writes it. No action, no route, no UI |
| **Tips** | settings toggle | — | **STUB** — `tip_minor` is read in receipts; never collected |
| **Saved payment methods** | settings toggle | — | **STUB** |
| **Hold job until ACH settles** | settings toggle | — | **STUB** — nothing reads it |
| **Payment schedules / milestones** | DB tables | — | **STUB** — tables and foreign keys exist; zero application references |
| Expenses CRUD, month total, net vs sales | `/expenses` | owner/office | REAL |

## 5. Reporting and finance operations

| Capability | Entry point | Users | State |
|---|---|---|---|
| Reports dashboard — revenue, gross, expenses, net, by-tech, aging | `/reports` | owner/office | PARTIAL — "revenue collected" ignores partial payments and refunds; gross-profit KPI excludes discount and tax, so margin reads high |
| Custom report builder (5 sections, date range, print) | `/reports/custom` | owner/office | REAL |
| Accounting CSV export — invoices / payments / expenses | `/reports/export` | owner/office | PARTIAL — the payments export filters in JS after an unbounded fetch, so it silently truncates |
| Commission report with editable % and CSV | `/reports/commission` | owner edit, office view | PARTIAL — pays on quoted `price_minor`, not money actually collected |
| Timesheet report and export | `/reports/timesheets` | owner/office | REAL |
| Tax jurisdictions and rules | `/finance` | owner + permission | **STUB** — display only; never feeds the tax calculation |
| Tax filings ledger | `/finance` | owner + permission | PARTIAL — every figure hand-entered, nothing derived |
| Settlement batches (gross / fees / refunds / chargebacks / net) | `/finance` | owner + permission | PARTIAL — manual entry only; nothing auto-matches provider payouts |
| Settlement status workflow | `/finance` | owner + permission | REAL |
| Disputes / chargebacks record and workflow | `/finance` | owner + permission | PARTIAL — hand-entered; no provider ingestion; disputing does not touch the payment or invoice |

## 6. Inventory, purchasing and growth

| Capability | Entry point | Users | State |
|---|---|---|---|
| Inventory items CRUD, low-stock, quantity +/- | `/inventory` | owner/office | REAL |
| Inventory movement ledger | — | — | **STUB** — no movement table exists; only a mutable quantity column with a lossy read-then-write |
| Vendors | `/operations` | owner/office | REAL |
| Purchase orders | `/operations` | owner/office | PARTIAL — a single line item, status never advances, no receive step, no inventory link |
| Subcontractors (trades, insurance expiry) | `/operations` | owner/office | REAL |
| Crews and service areas | `/operations` | owner/office | REAL |
| Automation rules | `/operations` | owner/office | **STUB** — stored; no executor exists |
| Campaigns / referral programmes / estimate follow-ups | `/growth` | owner/office | **STUB** — stored; nothing ever sends them |
| Ad spend and lead attribution | `/growth` | owner/office | PARTIAL — spend recorded, never joined to lead revenue |
| Custom field definitions and values | DB tables | — | **STUB** — tables exist, zero application references |

## 7. Recurring work and warranties

| Capability | Entry point | Users | State |
|---|---|---|---|
| Recurring maintenance plans CRUD | `/recurring` | owner/office | REAL |
| "Generate N due" jobs and roll the schedule forward | `/recurring` | owner/office | PARTIAL — one interval per click, so an overdue plan stays overdue and repeated clicks duplicate jobs; generated jobs also pollute the dispatch board permanently |
| Nightly recurring generation | daily cron | system | REAL (same `end_date` defect) |
| Day-before appointment SMS reminders | daily cron | system | PARTIAL — marked sent before sending, so a provider failure suppresses them permanently |
| Weekly overdue-invoice SMS nudges | daily cron | system | PARTIAL — same defect |
| Warranty coverage save (type, dates, terms) | `/jobs/[id]` | owner/office | REAL |
| Report a warranty callback (issue, priority, responsibility) | `/jobs/[id]` | owner/office | REAL |
| Schedule a return visit — creates a linked job | `/jobs/[id]` | owner/office | REAL — the RPC re-checks role and org, locks the row, and is idempotent |
| Resolve / deny a callback with internal cost | `/jobs/[id]` | owner/office | REAL |
| Warranty centre — open/urgent/scheduled counts, 30-day expiry list | `/warranties` | owner/office | REAL |

## 8. Customer-facing surfaces

| Capability | Entry point | Users | State |
|---|---|---|---|
| Public booking — 5-step wizard, EN/HE toggle, RTL | `/book/[org]` | anonymous | REAL |
| Booking availability slots API | `/api/booking/[org]/slots` | anonymous | REAL — unauthenticated and unthrottled; exposes the org's busy calendar |
| Booking submission → lead (+ auto customer and job when auto-approve) | `/api/booking/[org]/submit` | anonymous | REAL — rate limit is per-org and racy |
| Booking confirmation with reference number | `/book/[org]` | anonymous | REAL |
| Booking UTM / source / campaign capture | `/book/[org]` | anonymous | REAL |
| Booking deposit mode (none / fixed / percentage / full) | `/settings/booking` | owner | **STUB** — stored and shown as copy; no deposit is ever charged from booking |
| Service-area enforcement (ZIP / city) | `/settings/booking` | owner | REAL — out-of-area addresses are refused |
| Service-area enforcement (polygon) | `/settings/booking` | owner | PARTIAL — polygons need geocoding this product does not have, so they are never checked. No longer a silent accept: a polygon-only org holds every booking in Leads for manual approval, and the settings screen says enforcement is not active. See REMEDIATION-PLAN 4.8 |
| Business timezone for booking | `/settings/booking` | owner | REAL — `booking_settings.timezone`; slot maths runs on the business's clock, not the server's |
| Customer portal via magic link, no login | `/portal/[token]` | customer | REAL — but the token never expires and cannot be revoked |
| Portal — next appointment, invoices, estimates, service history | `/portal/[token]` | customer | REAL |
| Portal — request reschedule or message (rate-limited) | `/portal/[token]` | customer | REAL |
| Portal — email/SMS opt-in preferences | `/portal/[token]` | customer | PARTIAL — this branch bypasses the rate limit |
| Public document view (estimate/invoice), branded, print to PDF | `/p/[token]` | customer | REAL |
| Public approve + canvas e-signature | `/p/[token]` | customer | PARTIAL — **re-signable indefinitely by anyone with the link** |
| Public payment options (card / ACH / Zelle / check, fee saver) | `/p/[token]` | customer | REAL |
| Branding — logo, accent colour, tagline on all public surfaces | `/settings` | owner | REAL |

## 9. Account, team and settings

| Capability | Entry point | Users | State |
|---|---|---|---|
| Signup with password strength meter and terms gate | `/signup` | anonymous | REAL — surfaces raw provider errors, enabling account enumeration |
| Login | `/login` | staff | REAL |
| Forgot password / set new password | `/forgot-password`, `/reset-password` | anonymous | REAL |
| Org creation, owner profile, 14-day trial | `/onboarding` | owner | REAL |
| Auto-join an invited org on first login | `/onboarding` | staff | REAL |
| Onboarding locale / currency / tax label / tax rate | `/onboarding` | owner | REAL |
| Industry pack selection — 12 trades, EN+HE, services and parts | `/onboarding` | owner | REAL |
| Pack seeding into price book, job types, bookable services | `/onboarding` | owner | REAL |
| Sample customer and job seeding | `/onboarding` | owner | REAL |
| Team invite by email and role | `/team` | owner | PARTIAL — **no email is ever sent**; the invite token is generated and unused |
| Cancel a pending invitation | `/team` | owner | REAL |
| Change a member's role (+ capability reset) | `/team` | owner | REAL — silently discards hand-tuned capabilities |
| Remove a member (last owner protected) | `/team` | owner | REAL |
| Per-member capability toggles (12 keys) | `/team` | owner | REAL — but **never enforced** in job/schedule server actions |
| Per-member payment permissions | `/team` | owner | REAL |
| Capability-aware navigation | all | staff | REAL |
| Business profile, language, currency, tax settings | `/settings` | owner | REAL |
| Document accent colour, terms, footer, review link | `/settings` | owner | REAL |
| Invoice / estimate next-number override | `/settings` | owner | REAL |
| Job types editor; job statuses editor | `/settings` | owner/office | REAL |
| Customer SMS templates (booked, day-before, on-the-way, completed) | `/settings/messages` | owner | REAL |
| Online-booking settings — hours, notice, horizon, interval, capacity, services, questions, messages | `/settings/booking` | owner | REAL |
| Payments setup and manual review queue | `/settings/payments` | owner | REAL |
| Appearance — theme, high contrast, large text, reduce motion | `/appearance` | staff | REAL |
| Bilingual UI — English + Hebrew, 240 keys each, RTL | everywhere | all | PARTIAL — dictionaries are complete and symmetric, but `/archive`, `/archive/import` and `/customers/import` are hardcoded English |

## 10. Privacy, compliance and administration

| Capability | Entry point | Users | State |
|---|---|---|---|
| Privacy settings — contact details, 5 retention periods | `/settings/privacy` | owner | REAL |
| Consent history (append-only, channel/purpose/proof) | `/settings/privacy` | owner | REAL |
| Privacy request queue (access, export, correction, deletion, opt-out) | `/settings/privacy` | owner | REAL |
| Identity verification on a request | `/settings/privacy` | owner | PARTIAL — a single self-attested button, no evidence captured, yet it gates both export and irreversible anonymisation |
| Data export (JSON download) | `/api/privacy/export/[requestId]` | owner | REAL — but exports portal and document tokens and internal margins to the requester |
| Deletion = customer anonymisation, blocked on unpaid invoices | `/settings/privacy` | owner | REAL |
| Retention holds (all / location / calls / comms / media / audit) | `/settings/privacy` | owner | REAL |
| Retention preview, enforce-now, run history | `/settings/privacy` | owner | PARTIAL — media and audit are counted but never deleted (by design) |
| Automatic daily retention enforcement | daily cron | system | REAL — **reachable unauthenticated if `CRON_SECRET` is unset** |
| Platform admin console | `/admin` | platform staff | REAL |
| Support cases | `/admin` | platform staff | REAL |
| Time-boxed support access sessions | `/admin` | platform staff | PARTIAL — recorded only; no code grants access from a session |
| Feature flags with rollout % | `/admin` | platform staff | **STUB** — no application code ever reads them |
| Controlled releases with regression checklist gate | `/admin` | platform staff | REAL |
| Business health overview | `/admin` | platform staff | REAL |
| Migration import (Workiz / Housecall Pro / spreadsheet) | `/migration` | owner/office | PARTIAL — customers only; no jobs, invoices or history |
| Migration batch rollback | `/migration` | owner | REAL |
| Legacy archive import + browse/search + restore | `/archive` | owner/office | REAL |
| PWA install, service worker, offline navigation fallback | all | staff | REAL |
| Health check (DB reachability + latency) | `/api/health` | anonymous | REAL — unauthenticated, uses the service-role key |

---

## Summary of what is NOT real

If this product is rebuilt or repaired, these are the items that **look** finished in the UI but have
nothing behind them. They are the most likely source of "but it used to do that" surprises — because
it never did.

**Complete stubs (19):** refunds · tips · saved payment methods · ACH hold-until-settled · payment
schedules and milestones · organisation default deposit · booking deposit charging · automation rules
· campaigns · referral programmes · custom fields (definitions and values) · inventory movement ledger
· feature flags · push notification delivery · photo "customer visible" flag · scheduling
transition-rule engine (written and tested, never called) · tax-jurisdiction calculation · support-session
access granting · invitation email delivery.

**Highest-impact PARTIALs:** estimate deposits not credited to the converted invoice (overbilling) ·
invoice screen counting unsettled payments as collected · revenue and margin reporting · commission on
quoted rather than collected money · recurring jobs polluting dispatch permanently · re-signable public
documents · un-revocable portal links.
