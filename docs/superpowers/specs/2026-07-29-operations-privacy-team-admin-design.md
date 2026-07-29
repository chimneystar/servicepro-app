# ServicePro operations, privacy, team, and administration design

**Date:** 2026-07-29  
**Status:** Approved by the user's explicit instruction to implement without a separate approval pause

## Outcome

Restore the missing Team entry, add a real personal theme and accessibility system, and make the signed-in product visibly different for owner, office, and technician users. Add production-ready operational workspaces for accounting/tax/settlements/chargebacks, privacy/consent/data retention, and internal support/controlled releases without removing or replacing any existing route.

Helcim production activation and native iOS work remain paused. Finance workflows are provider-neutral so they work for manual records now and can receive Helcim data later.

## Product structure

- **Owner home (`/`)** is the business command center: financial health, attention items, team, risk, and operational shortcuts.
- **Office home (`/dispatch`)** is the dispatch workspace. Office users only see tools granted through capabilities.
- **Technician home (`/tech`)** is the mobile workday. A technician visiting `/` is redirected there and never receives the owner's financial dashboard payload.
- **Team (`/team`)** returns as a first-class owner navigation item. Database enforcement prevents an organization from losing its last owner.
- **Appearance (`/appearance`)** is personal and available to every role: Light/Dark/System, normal/high contrast, normal/large type, and motion on/reduced. Preferences are persisted to the profile and cookies to avoid a flash on load.
- **Finance (`/finance`)** provides tax jurisdictions and filing periods, settlement reconciliation, and dispute/chargeback operations. Owners have access; office access requires payment-management capability.
- **Privacy (`/settings/privacy`)** provides consent history, privacy requests, retention settings, holds, previews, exports, and guarded anonymization. It is owner-only.
- **Platform console (`/admin`)** is outside tenant administration. It shows organization health, support cases, expiring reason-bound support sessions, feature flags, and release records. Access is service-role verified against a deny-by-default platform-admin registry.

## Experience and visual system

The existing blue/yellow identity stays. Light mode uses white and cool-gray surfaces. Dark mode uses deep navy/slate surfaces with the same blue actions and yellow attention accents. Shared operation pages use a clear command-center pattern: compact summary cards, a status rail, filterable ledgers, and an obvious primary action. Hebrew is authored as natural interface language rather than a literal English word order.

Navigation remains fixed. The scrollable area contains only feature links; language, appearance, and sign-out remain pinned at the bottom. Mobile retains a five-item role-specific tab bar and moves all other features into More.

## Data model and safeguards

### Personal preferences

Add `ui_theme`, `ui_contrast`, `ui_text_scale`, and `ui_reduce_motion` to `profiles`. Users may update only their own preferences.

### Finance operations

- `tax_jurisdictions`: effective-dated tax rates and scope.
- `customer_tax_exemptions`: customer certificate and expiration tracking.
- `tax_filings`: period totals, due date, status, remittance and reference.
- `settlement_batches` plus `settlement_payment_links`: expected/actual gross, fees, refunds, chargebacks, adjustments and net reconciliation.
- `payment_disputes`: reason, amount, response deadline, evidence notes and outcome.

All rows carry `organization_id`, use tenant RLS, explicit authenticated grants, organization-consistency triggers, and indexed status/due-date access paths. Money is stored in minor units. This module does not claim to file taxes or move money automatically.

### Privacy operations

- `organization_privacy_settings`: retention windows, automatic enforcement switch and privacy contact.
- `consent_events`: append-only channel/purpose/source/granted history.
- `privacy_requests`: access/export/correction/deletion/opt-out workflow with identity-verification and statutory due date.
- `retention_holds`: records that suspend deletion for a customer or category.
- `retention_runs`: immutable run summaries.

Customer exports include the customer and their operational/communication/payment history. Deletion is implemented as irreversible PII anonymization while financial records remain intact. It is blocked while the customer has an unpaid invoice. Automated retention is off by default; when enabled, the daily job only removes categories the owner configured and records the result. Audit and financial records are never silently purged.

### Platform operations

`platform_admins`, `support_cases`, `support_sessions`, `feature_flags`, `release_records`, and `release_events` have RLS enabled with no client grants. Server actions first verify the authenticated identity, then use the service role. Support sessions require a case, reason and expiration and create an audit event; they do not create silent impersonation. Release records represent review, rollout, pause and rollback decisions while the actual deployment remains Git/Vercel-controlled.

### Last-owner protection

A database trigger rejects deletion, demotion, or organization reassignment of the last active owner. The Team UI translates this into a direct English/Hebrew explanation.

## Accessibility and privacy defaults

- Restore browser zoom (`maximumScale: 5`, `userScalable: true`).
- Maintain visible keyboard focus, minimum 44px targets, programmatic labels and semantic headings.
- Respect operating-system reduced-motion and the user's explicit preference.
- High-contrast mode increases borders, focus visibility and text contrast without relying on color alone.
- Privacy changes and financial state transitions record the actor and time.

## Failure handling

Every mutation validates role/capability again on the server and returns natural localized feedback. A failed settlement or dispute save leaves the existing record unchanged. Retention runs are idempotent per organization/day, record partial failures, and never continue across tenant boundaries. Platform actions fail closed when the user is not in the platform registry.

## Verification

- Automated tests assert Team is discoverable, role homes redirect correctly, Theme controls and finance/privacy/admin routes remain in the feature manifest, and tenant tables have RLS definitions.
- Typecheck, unit tests, production build and browser checks cover English/Hebrew, light/dark/high-contrast modes and mobile/desktop layouts.
- Supabase migration checks confirm tables, policies, last-owner trigger, explicit grants, tenant isolation, and platform deny-by-default behavior.
- Production smoke tests verify owner navigation and protected-route denial. Office/technician route behavior is covered with authorization tests without creating fake production users.

## Scope boundaries

This release makes the operational ledgers and workflows usable now. Automatic Helcim settlement/dispute ingestion waits for approved production credentials. Tax calculation is configured and recorded by the business; automated filing/remittance and third-party tax engines are not represented as complete. Native iOS/TestFlight remains paused.
