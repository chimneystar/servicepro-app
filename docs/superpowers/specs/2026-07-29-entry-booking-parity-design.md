# ServicePro Entry, Booking, and Prototype-Parity Upgrade

**Date:** 2026-07-29  
**Status:** Implementation authorized by the product owner  
**Scope:** Sign-in, account creation, public online booking, booking administration, and production restoration of the strongest prototype interactions

## 1. Problem

The production CRM preserves the original business modules and now contains the Priority 0–3 foundation release, but three problems remain:

1. Sign-in and account creation share a small generic card and do not communicate the product, guide a new owner, recover access, or prevent common password mistakes.
2. Online booking is a single request form. It does not yet offer real service selection, service-area validation, availability, approval rules, booking deposits, intake questions, source tracking, or an embeddable guided flow.
3. Several useful prototype interactions did not reach production: the role-aware focus card, chronological job pulse, actionable attention queue, and persistent quick-create control.

This upgrade is additive. It may not remove, rename, hide, or replace an existing CRM route or setting.

## 2. Approaches considered

### A. Visual refresh only

Replace inline styles and make the existing forms prettier. This is fast but would leave the booking and onboarding capability gap unchanged. Rejected.

### B. Complete scheduling and payment platform rewrite

Build a new booking calendar, pricing engine, payment target, and public customer identity system at once. This could reach maximum parity, but it creates too much migration and payment risk in one release. Rejected for this release.

### C. Guided entry and provider-ready booking engine

Keep the working authentication and lead pipeline, separate sign-in from account creation, introduce a configurable booking model, validate service areas and capacity in the database, and submit either an approval request or an unassigned confirmed job. Deposit rules are stored and shown, while actual Helcim collection activates only when production credentials are connected. Chosen.

## 3. Experience direction

The entry experience uses the existing ServicePro blue-and-yellow system, with a calmer “dispatch desk at first light” visual: deep operational blue, thin route lines, and one warm yellow next-action marker. It avoids decorative dashboards and stock photography.

### Tokens

- Deep route blue: `#0B1F44`
- Service blue: `#2B66F6`
- Signal yellow: `#F8C928`
- Cloud canvas: `#F4F7FB`
- Paper: `#FFFFFF`
- Operational ink: `#172033`

### Signature

A compact route line moves from “Lead” to “Booked” to “Paid” on the authentication pages. In booking it becomes a real progress rail showing the customer’s current step. Motion lasts 160–220ms, explains state change, and is disabled under reduced-motion preferences.

## 4. Authentication design

### Sign-in

- Dedicated `/login` page with product promise, language control, email, password, show/hide password, “Forgot password,” and a clear link to account creation.
- Errors use natural English or Hebrew and explain the next action.
- The password manager can identify the fields with correct autocomplete attributes.
- A safe return path may bring invited users back to the intended screen.

### Account creation

- Dedicated `/signup` page.
- Collect owner name, business name, phone, email, password, password confirmation, preferred language, and agreement to terms.
- Show live password requirements and prevent mismatched passwords.
- Put business and owner values in Supabase user metadata, then continue to the existing trade and catalog onboarding.
- Verification-email state is a full success screen, not a temporary blue message inside the form.

### Password recovery

- `/forgot-password` sends a reset email using the active locale.
- `/reset-password` accepts the recovery session and saves a new validated password.

## 5. Online-booking design

### Customer flow

1. **Service** — choose a bookable service with description, duration, starting price, and whether it books a job or estimate.
2. **Location** — enter address, city, and ZIP. Validate against active service areas and show a call option if outside the area.
3. **Time** — choose a day and an available arrival window calculated from business hours, minimum notice, duration, active technicians, and existing jobs.
4. **Details** — name, phone, email, contact preference, urgency, notes, and configured intake questions.
5. **Review** — show service, location, time, price/deposit policy, consent text, and one unambiguous confirmation action.

The result is either:

- an approval request in Leads, or
- a confirmed, unassigned Job plus matched or newly created Customer, depending on the business setting.

Duplicate customers are matched by normalized phone/email where possible. Every booking stores source and campaign values from the link.

### Business settings

`/settings/booking` controls:

- enabled/disabled state;
- request approval or automatically create job;
- business hours and closed days;
- minimum notice and maximum booking horizon;
- arrival-window duration and capacity behavior;
- available services, description, duration, price, booking type, and sort order;
- no payment, fixed deposit, percentage deposit, or full payment;
- service-area enforcement;
- success message and urgent-call message;
- share link and embeddable widget code;
- source/campaign parameters and booking preview.

### Security and failure behavior

- Public functions are `security definer` with an empty search path, explicit grants, length limits, rate limits, and no exposure of private organization fields.
- Capacity is rechecked at submission time. A slot that filled while the customer was typing returns a specific “choose another time” response.
- Public booking never returns technician names, customer data, private notes, or exact internal schedules.
- Payment is not claimed or captured when Helcim is unavailable. The UI states that the deposit will be collected after confirmation.

## 6. Prototype restoration

The production dashboard will restore the prototype concepts with real data:

- **Role focus:** owner sees collection risk, office sees unassigned work, technician sees the next assigned stop. Users do not impersonate roles with a cosmetic switcher.
- **Job pulse:** today’s jobs appear on a chronological route strip with status, time, customer, service, and a direct job link.
- **Needs attention:** overdue invoices, unassigned jobs, unanswered leads/messages, and estimates waiting for follow-up appear in one actionable queue.
- **Quick create:** a persistent top-bar control opens Job, Customer, Estimate, and Invoice actions on desktop and mobile.
- **Plain-language cards:** dense generic metrics remain available, but the first screen answers “what needs my attention next?” before showing reporting detail.

## 7. Complete roadmap gap audit

Status definitions: **Live** means a usable production workflow exists; **Partial** means a foundation or limited workflow exists; **Missing** means no usable implementation exists.

### Priority 0

| Requirement | Status | Gap to close |
|---|---|---|
| Complete English/Hebrew audit | Partial | New modules are bilingual and keys match, but older screens still contain inline English and some provider errors bypass the dictionary. |
| Role and permission center | Partial | Twelve overrides exist; route/action checks do not yet consume every override consistently, and last-owner protection needs a database constraint. |
| Fixed navigation/design system | Live | Navigation is fixed and blue/yellow; older inline-styled pages still need token/component migration. |
| Mobile technician workspace | Partial | One-thumb core actions and offline status exist; encrypted job bundles, conflict review, and full offline media/forms are missing. |
| Push notifications | Partial | Subscriptions/events exist; delivery worker, VAPID configuration, preferences, retries, and all event producers are missing. |
| Onboarding and sample data | Partial | Trade/catalog/sample import exists; operating area, team, booking, payment, email/SMS, and guided completion are not one coherent wizard. |
| Regression protection | Partial | Route/settings/i18n tests exist; schema contracts, visual snapshots, mobile role smoke tests, and release-manifest diff are missing. |
| Activity history | Partial | Timelines exist on core records; meaningful before/after field rendering and coverage for new modules are incomplete. |
| Production errors/backups/monitoring | Partial | Error boundary and health endpoint exist; correlation IDs, owner status card, error provider, retry dashboard, and backup verification are missing. |

### Priority 1

| Requirement | Status | Gap to close |
|---|---|---|
| Drag-and-drop dispatch | Partial | Technician reassignment works; time-slot dragging, conflict preview, keyboard drag alternative, and undo are missing. |
| Multiple technicians/crews | Partial | Multiple technicians work; crew membership and lead-tech management UI are incomplete. |
| Multi-day jobs | Partial | End date exists; per-day job segments, per-day technicians, billing, and calendar rendering are missing. |
| Live GPS map | Partial | Consent and last-known points exist; continuous work-hours tracking, map tiles, accuracy/stale controls, and location history policy are missing. |
| Traffic route optimization | Missing | Existing route view does not call a traffic provider or optimize by windows, skills, territories, and hours. |
| Geographic service areas | Partial | ZIP/city/polygon data exists; booking enforcement, map editing, technician assignment, and trip charges are incomplete. |
| Custom fields | Partial | Tables exist; definition builder, record editors, validation, search/filter, documents, import mapping, and exports are missing. |
| Automation builder | Partial | Basic rule creation exists; conditions, multiple actions, preview, templates, execution worker/history/retries, and emergency stop are missing. |
| Photo annotations/video | Partial | Upload and canvas markup exist; robust video capture/transcoding, captions, customer visibility, and mobile/offline queue are incomplete. |
| Offline technician mode | Partial | Status outbox sync exists; encrypted full bundle, notes/forms/media/payment queue, conflict UI, and background sync are missing. |
| Purchase orders/vendors | Partial | Create/list foundation exists; approvals, receiving, bills, attachments, inventory posting, and lifecycle UI are missing. |
| Subcontractor management | Partial | Directory exists; documents, insurance alerts, service areas, job/cost assignment, and restricted portal are missing. |
| Customer portal | Partial | History, documents, payments, communication preferences, and change requests exist; secure customer profile editing, calendar files, bulk payment, direct policy-compliant rescheduling, and portal login management are missing. |

### Priority 2

| Requirement | Status | Gap to close |
|---|---|---|
| Progress invoicing/payment schedules | Partial | Deposit/milestone tables and checkout exist; change orders, invoice generation per milestone, reminder automation, and accounting reconciliation are incomplete. |
| Customer financing | Missing | Provider selection, eligibility, application, offer display, webhook reconciliation, and compliance copy do not exist. |
| Review requests/tracking | Partial | Manual review link exists; automated send, delivery/click/completion tracking, stop rules, and dashboard are missing. |
| Referral program | Partial | Program records exist; unique customer links/codes, attribution, reward approvals, fraud controls, and customer UI are missing. |
| Lead source/ad ROI | Partial | Spend and lead source counts exist; campaign attribution, collected revenue, call/booking parameters, and ROI drill-down are missing. |
| Estimate follow-up | Partial | A single follow-up can be scheduled; sequences, provider delivery, stop-on-reply/decision, templates, quiet hours, and history are missing. |
| Email/SMS campaigns | Partial | Draft storage exists; consent enforcement, segmentation, scheduling, provider delivery, quiet hours, unsubscribe, and delivery analytics are missing. |
| Sales pipeline | Partial | Kanban stages exist; configurable stages, owners, tasks, probability, weighted value, SLA alerts, and conversion reports are missing. |

### Priority 3

| Requirement | Status | Gap to close |
|---|---|---|
| Natural bilingual operation | Partial | New copy is authored independently; older inline copy and operational messages still need a full human language pass. |
| AI job summaries | Partial | Safe drafts and local fallback exist; selected-photo understanding, source references, provider configuration UI, model metadata, approval history, and evaluation are incomplete. |
| Industry starter packs | Live foundation | Twelve broad bilingual packs, optional parts, blank pricing, and additive keys exist; trade-specific forms/checklists and regular catalog updates are not included. |
| Workiz/HCP/spreadsheet migration | Partial | Reversible customer CSV import works; field mapping and jobs, contacts, properties, notes, estimates, invoices, payments, catalog, and attachments are missing. |
| Exceptionally simple offline app | Partial | Mobile PWA exists; the complete offline bundle/conflict/media workflow and native iOS packaging are missing. |

### Additional competitive gaps discovered

- Configurable online booking with real availability, service pricing, deposits, service-area gating, arrival windows, intake questions, auto-job versus approval, embed/share, and attribution.
- Time off that blocks availability.
- Membership/service plans with renewal and recurring payment.
- Customer self-service profile and saved-payment management with consent.
- Two-factor authentication, active-session management, magic-link sign-in, and recovery codes.
- QuickBooks/accounting synchronization and reconciliation.
- Call tracking, recorded-call consent controls, and phone attribution.
- Equipment/asset service history by property.
- Warranty callbacks and workmanship warranty tracking.

## 8. Testing and release contract

- Authentication component tests for modes, validation, locale, recovery, and safe redirects.
- Booking domain tests for service-area rules, lead/job mode, minimum notice, booking horizon, capacity, and slot-race behavior.
- Public security tests for function grants, rate limits, field lengths, and absence of private data.
- English/Hebrew parity and RTL visual checks.
- Keyboard and mobile tests for the five-step flow and quick-create menu.
- Existing feature-preservation suite must remain green.
- Production build and live authenticated/public browser smoke tests are required before release.

