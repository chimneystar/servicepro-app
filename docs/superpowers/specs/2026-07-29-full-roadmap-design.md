# ServicePro Complete Product Roadmap Design

**Date:** 2026-07-29  
**Status:** Approved scope — implementation authorized  
**Launch market:** United States  
**Languages:** English and Hebrew  
**Primary users:** service-business owners, office dispatchers, field technicians, customers, subcontractors, and vendors

## 1. Objective

ServicePro will become a sellable field-service management product that competes directly with Workiz and Housecall Pro while remaining easier to learn. This expansion must preserve every existing CRM capability. A redesign is never allowed to remove a route, setting, data field, permission, or workflow without an explicit replacement and migration.

The product covers four connected workspaces:

1. **Office command center** — leads, dispatch, customers, estimates, invoices, automation, reporting, purchasing, and payments.
2. **Technician workspace** — today’s route, job details, status, notes, media, signatures, payment, and offline operation.
3. **Customer portal** — approvals, signatures, deposits, payments, rescheduling, history, and communication preferences.
4. **Business setup center** — company profile, roles, service catalog, industry starter packs, payment onboarding, imports, service areas, notifications, and integrations.

## 2. Chosen architecture

### Considered approaches

**A. Rewrite the application around the roadmap.** This creates a clean slate but repeats the exact failure that removed existing functionality. Rejected.

**B. Split immediately into separate microservices and native applications.** This gives strong long-term boundaries but would multiply deployment and consistency risk before the product model is stable. Rejected for the current stage.

**C. Expand the current Next.js and Supabase application as a modular monolith, with strict feature contracts and an offline synchronization boundary.** Chosen. It preserves working CRM behavior, ships in verifiable slices, and keeps a clean path to a native iOS shell or extracted services later.

### Application boundaries

- `lib/domain/*` contains provider-independent business rules.
- Server actions and route handlers authenticate the user, authorize the operation, validate input, call domain rules, and write through Supabase.
- Supabase remains the system of record. Every organization-owned table carries `organization_id`, tenant-safe foreign keys, RLS, explicit grants, timestamps, and audit triggers.
- The technician offline layer stores an encrypted local job bundle and an ordered outbox. Synchronization is idempotent and conflict-aware.
- External providers are adapters: Helcim, email, SMS, maps/routing, push, financing, and AI. Missing credentials disable only the related action and never break the rest of the app.

## 3. Feature-preservation contract

The following existing modules are protected: dashboard, schedule, jobs, leads, customers, messages, estimates, invoices, payments, reports, route, recurring work, inventory, price book, expenses, team, settings, search, archive/import, online booking, customer portal, signatures, photos, job tasks, equipment, checklists, commissions, timesheets, reviews, and exports.

Protection is enforced by:

- a machine-readable feature manifest containing every protected route and capability;
- route-existence and navigation-visibility tests for Owner, Office, and Technician;
- database contract tests for protected tables and columns;
- English/Hebrew key-parity tests;
- mobile and desktop smoke tests;
- migration-only schema changes, with no destructive replacement of working tables;
- a release checklist that compares the manifest before deployment.

## 4. Experience and visual system

### Direction

ServicePro uses a disciplined blue-and-yellow operations aesthetic: confident blue for navigation and action, warm yellow for attention and contrast, neutral ink for dense operational data, and restrained red/green only for destructive or final financial states. Green is not a general brand accent.

The signature interaction is the **job pulse**: one compact, chronological strip that shows where a job is now, what must happen next, and who owns the next action. It appears in dispatch, technician job view, and the customer portal with role-appropriate detail.

### Tokens

- Service blue: `#2463EB`
- Deep operations blue: `#102A56`
- Signal yellow: `#F8C928`
- Warm yellow surface: `#FFF6CC`
- Ink: `#172033`
- Canvas: `#F4F7FB`
- Success and danger are semantic only and are not brand accents.

### Navigation

- Desktop navigation is fixed to the viewport height.
- The brand and role stay at the top.
- Only the route list scrolls.
- Language and account controls stay pinned at the bottom and are always reachable.
- Mobile uses a fixed five-action technician-aware tab bar plus a clear More screen.
- Navigation is generated from the feature manifest and permission policy, so English and Hebrew never expose different modules.

### Copy

English and Hebrew are authored independently in natural spoken language. UI text avoids literal translation, technical implementation terms, and vague AI-style filler. Every empty state provides one useful next action. Every error explains what happened and what the user can do.

### Accessibility and motion

- WCAG 2.2 AA contrast and keyboard access.
- Visible focus on every interactive control.
- Minimum 44px touch targets in technician and customer surfaces.
- Motion clarifies state changes, uses short 140–240ms transitions, and respects reduced-motion preferences.

## 5. Priority 0 foundation

### Language completeness

All product strings live in typed English and Hebrew dictionaries. Dates, currency, addresses, phone numbers, tax labels, and pluralization use the active locale. CI fails if keys differ or user-facing server errors bypass the dictionary.

### Role and permission center

Base roles remain Owner, Office, and Technician. Each member also receives explicit capability overrides grouped into Customers, Scheduling, Jobs, Estimates, Invoices, Payments, Reports, Purchasing, Automations, Settings, and Team. Owner authority cannot be removed from the last owner. Users cannot grant themselves permissions.

### Mobile technician workspace

The technician home screen shows Today, Next stop, Route, Jobs, and Sync status. A job is operable with one thumb: navigate, on my way, start, checklist, notes/media, customer approval, collect payment, complete. Office-only complexity is hidden.

### Push notifications

Web push subscriptions are stored per device and user. Events include assignment, schedule change, new message, estimate decision, payment, and offline-sync conflict. Email and SMS remain fallback channels.

### Onboarding and sample data

Onboarding creates the business, selects trades, optionally imports industry parts, configures operating area and team, chooses payment methods, and offers safe sample data. Sample records are visibly labeled and removable as a unit.

### Activity history

Audit data becomes a human-readable timeline on jobs, customers, estimates, and invoices. It shows actor, action, time, and relevant before/after values without exposing secrets.

### Reliability

- Structured application errors carry a correlation ID.
- Important external events are idempotent.
- Failed background tasks remain retryable.
- Health and readiness endpoints test dependencies without leaking configuration.
- Database backup status and application error monitoring are visible to owners in a system-status card.

## 6. Priority 1 operations

### Dispatch and scheduling

The dispatch board supports drag-and-drop reassignment and rescheduling with optimistic preview and server-side conflict checks. Jobs may span multiple days. A job can have multiple technicians, named crews, a lead technician, and assignment-specific status.

### Location and routing

Technicians explicitly opt into work-hours location sharing. The office sees current or last-known positions with timestamps. Routes use traffic-aware travel time, skill/territory constraints, working hours, and promised windows. Geographic service areas use ZIP codes and polygons.

### Custom fields and automation

Owners define typed fields for customers and jobs. Automation rules use a simple When / If / Then builder with templates, preview, execution history, retries, and an emergency disable switch.

### Media and offline

Jobs accept photos, annotated photos, short videos, captions, and customer-visible controls. Offline bundles contain assigned jobs, customers, checklists, price-book items, and pending forms. Conflicts never silently overwrite office changes.

### Purchasing and external labor

Purchase orders contain vendor, job, items, costs, approval, receipt, and bill status. Vendors and subcontractors have contacts, insurance/expiry data, service areas, documents, assignments, costs, and restricted portal access.

### Customer portal

Customers can view history, estimates, invoices, appointments, documents, and payments; approve/sign; pay deposits or balances; request or perform policy-compliant rescheduling; and select communication preferences.

## 7. Priority 2 revenue and growth

- Progress invoicing supports deposit, custom milestones, change orders, and final balance.
- Financing is provider-ready and shown only to eligible businesses and customers.
- Review automation sends requests, tracks delivery, click, and completion status, and stops after success.
- Referrals use unique links or codes, attributed leads, configurable rewards, and fraud-resistant status.
- Lead attribution stores source, campaign, ad cost, booked revenue, and collected revenue for ROI reporting.
- Estimate follow-up uses configurable sequences that stop on approval, rejection, or reply.
- Email/SMS campaigns require consent, quiet hours, unsubscribe handling, segments, scheduling, and delivery history.
- The sales pipeline supports configurable stages, owners, tasks, probability, value, and conversion reporting.

## 8. Priority 3 differentiation

### Industry starter packs

Onboarding supports air-duct cleaning, dryer-vent cleaning, chimney service, painting, masonry, siding, locksmith, garage door, HVAC, plumbing, electrical, and cleaning. Each pack includes a broad catalog of inspection, cleaning, repair, replacement, installation, emergency, and add-on services. Prices are blank. Parts are a separate optional import.

Catalog imports are additive and idempotent: rerunning a pack does not duplicate unchanged items, while business-edited descriptions and prices remain untouched.

### Migration center

The migration center supports Workiz, Housecall Pro, and generic spreadsheets. It imports customers, contacts, properties, jobs, notes, estimates, invoices, payments, catalog items, and attachments when the export provides them. The workflow is Upload → Map → Validate → Preview → Import → Reconcile. Every row receives a source reference and can be rolled back by import batch.

### AI job summaries

AI summaries are optional and provider-independent. They use only authorized job notes and selected media metadata, never financial secrets. The technician reviews and edits a draft before it becomes part of the job. The system stores source references, model metadata, and approval history.

## 9. Data model expansion

New modules use these table groups:

- authorization: `permission_definitions`, `role_permissions`, `profile_permissions`;
- assignments: `crews`, `crew_members`, `job_assignments`, `job_segments`;
- location: `technician_location_consents`, `technician_locations`, `service_areas`, `route_plans`, `route_stops`;
- customization: `custom_field_definitions`, `custom_field_values`;
- automation: `automation_rules`, `automation_runs`, `automation_actions`;
- offline/push: `device_subscriptions`, `sync_devices`, `sync_outbox_receipts`;
- purchasing: `vendors`, `purchase_orders`, `purchase_order_items`, `subcontractors`, `subcontractor_assignments`;
- growth: `campaigns`, `campaign_recipients`, `referral_programs`, `referrals`, `lead_attribution_costs`, `estimate_followups`;
- onboarding/catalog: `industry_packs`, `industry_pack_items`, `organization_industries`, `catalog_import_batches`;
- migration: `migration_batches`, `migration_rows`, `migration_attachments`;
- AI: `job_summary_drafts`.

Every group includes explicit indexes, tenant-safe foreign keys, RLS, grants, audit coverage, and retention rules.

## 10. Error handling and security

- Authorization is checked on the server and in RLS; hidden buttons are not security.
- Public portal operations use scoped, expiring tokens and rate limits.
- Location, saved payments, campaigns, and AI require explicit consent.
- Provider tokens are encrypted server-side and never returned to browsers.
- Imports are validated before writes and run in resumable batches.
- File uploads enforce type, size, ownership, and tenant-scoped storage paths.
- Destructive business actions are soft-delete or reversible where practical.

## 11. Verification and release

Each release layer requires:

1. schema migration validation and security advisor review;
2. domain unit tests and tenant-isolation tests;
3. English/Hebrew key parity and route preservation tests;
4. role-based desktop and mobile smoke tests;
5. offline synchronization and conflict tests for technician features;
6. production build;
7. preview visual review at desktop and mobile sizes;
8. database migration before application promotion;
9. production health, logs, and rollback verification.

No layer is described as complete unless its requirements are verified with fresh evidence.

