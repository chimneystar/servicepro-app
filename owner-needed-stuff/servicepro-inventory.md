# ServicePro — Feature, Property & Function Inventory

**Commit:** `30ec629` (`main`) · **Generated:** 29 July 2026
Companion to `servicepro-audit.md`.

---

## 1. Stack & configuration

| Property | Value |
| --- | --- |
| Framework | Next.js `^16.2.12` (App Router, Turbopack, React Server Components) |
| React | `^19.2.4` |
| Language | TypeScript `^5.5.4` |
| Styling | Tailwind `^3.4.13` + a single 1,325-line `app/globals.css` + heavy inline styles |
| Backend | Supabase (`@supabase/ssr ^0.5.2`, `@supabase/supabase-js ^2.45.4`), Postgres 17.6 |
| Validation | Zod `^3.23.8` |
| Tests | `node --test` (9 `.mjs` suites) + Playwright `^1.62.0` (1 e2e spec) |
| Hosting | Vercel, project `servicepro-app`, team `chimneystar` |
| Cron | `vercel.json` → `/api/cron/daily` at `0 13 * * *` |
| PWA | `public/manifest.webmanifest`, `public/sw.js`, `components/PwaRegistration.tsx` |
| Fonts | Heebo (400–900) + Rubik (600–800) via Google Fonts |
| Locales | `en`, `he` — default `en`; cookie `locale`; `dir` set on `<html>` server-side |
| Viewport | `initialScale: 1`, `maximumScale: 5`, `userScalable: true` (zoom correctly allowed) |

**Codebase size:** 284 files · 3.4 MB · ~170 `.tsx` · 46 protected routes · 8 public routes · 18 API routes · 137 server actions · 97 DB tables · 27 DB functions.

---

## 2. Roles

Defined in `lib/auth.ts` as `Role = "owner" | "office" | "tech"`.

| Role | i18n key | Notes |
| --- | --- | --- |
| `owner` | `role.owner` | Implicitly granted **all 12 capabilities** (`loadCapabilities` short-circuits) |
| `office` | `role.office` | Capabilities read from `profile_capabilities` |
| `tech` | `role.tech` | Capabilities read from `profile_capabilities`; primary surface is `/tech` |

Plus a **platform admin** tier (`lib/platform-admin.ts`, table `platform_admins`) gating `/admin`.

---

## 3. Capabilities (12)

`CapabilityKey` in `lib/auth.ts`, mapped to `profile_capabilities` columns:

| Capability | DB column | Gates |
| --- | --- | --- |
| `customers.view` | `can_view_customers` | `/customers` nav |
| `customers.edit` | `can_edit_customers` | Customer mutations |
| `schedule.manage` | `can_manage_schedule` | `/schedule`, `/dispatch` nav |
| `jobs.edit` | `can_edit_jobs` | `/jobs` nav |
| `estimates.manage` | `can_manage_estimates` | `/estimates` nav |
| `invoices.manage` | `can_manage_invoices` | `/invoices` nav |
| `payments.manage` | `can_manage_payments` | `/finance`, `/settings/payments` nav |
| `reports.view` | `can_view_reports` | `/reports` nav |
| `purchasing.manage` | `can_manage_purchasing` | Vendors / purchase orders |
| `automations.manage` | `can_manage_automations` | Automation rules |
| `settings.manage` | `can_manage_settings` | Settings writes |
| `team.manage` | `can_manage_team` | Team management |

Enforcement helpers: `requireProfile()`, `assertRole(profile, allowed[])`, `loadCapabilities(profile)`, `assertCapability(profile, capability)`. Separate payment-permission layer in `profile_payment_permissions`.

**User preference properties** on `Profile`: `ui_theme` (`light|dark|system`), `ui_contrast` (`normal|high`), `ui_text_scale` (`normal|large`), `ui_reduce_motion` (boolean) — mirrored to cookies `ui_theme`, `ui_contrast`, `ui_text_scale`, `ui_reduce_motion` and read in `app/layout.tsx`.

---

## 4. Navigation structure (`lib/nav.ts`)

28 `NAV_ITEMS`. Properties per item: `href`, `key`, `icon`, `roles[]`, `bottom?`, `group?`, `capability?`, `platformOnly?`.

### Primary sidebar

| Item | Route | Roles | Capability | Mobile tab |
| --- | --- | --- | --- | --- |
| My workday | `/tech` | tech | — | ✅ |
| Dashboard | `/` | owner | — | ✅ |
| Dispatch | `/dispatch` | owner, office | `schedule.manage` | ✅ |
| Schedule | `/schedule` | owner, office, tech | `schedule.manage` | ✅ |
| Jobs | `/jobs` | owner, office, tech | `jobs.edit` | — |
| Leads | `/leads` | owner, office | — | — |
| Customers | `/customers` | owner, office, tech | `customers.view` | ✅ |
| Messages | `/messages` | owner, office | — | — |
| Calls | `/calls` | owner, office | — | — |
| Estimates | `/estimates` | owner, office | `estimates.manage` | — |
| Invoices | `/invoices` | owner, office | `invoices.manage` | ⚠️ flagged `bottom` but dropped by `slice(0,4)` — see audit **A4** |
| Finance | `/finance` | owner, office | `payments.manage` | — |
| Payments | `/settings/payments` | owner, office | `payments.manage` | — |
| Reports | `/reports` | owner, office | `reports.view` | — |
| Team | `/team` | owner | — | — |
| Settings | `/settings` | owner | — | — |
| ServicePro admin | `/admin` | owner + `platformOnly` | — | — |

### Collapsible "Tools" group (11 items — all render off-screen, audit **A3**)

`/route` · `/recurring` · `/inventory` · `/pricebook` · `/operations` · `/warranties` · `/fleet` · `/growth` · `/migration` · `/settings/privacy` · `/appearance`

### Reachable but absent from `NAV_ITEMS`

| Route | Entry point |
| --- | --- |
| `/more` | Injected by `Nav.tsx:29` as the 5th mobile tab |
| `/search` | `components/TopBar.tsx` search submit |
| `/archive`, `/archive/import` | Link on `/customers` |
| `/customers/import` | `/customers` |
| `/settings/booking`, `/settings/messages` | `/settings` index |
| `/reports/custom`, `/reports/export`, `/reports/commission`, `/reports/timesheets` | `/reports` index |
| `/onboarding` | Post-signup redirect + `requireProfile()` fallback |
| **`/expenses`** | **None — orphaned (audit C1)** |

---

## 5. Protected routes (46)

From `config/feature-manifest.json`.

| Route | File | Roles |
| --- | --- | --- |
| `/` | `app/(app)/page.tsx` | owner, office, tech |
| `/schedule` | `schedule/page.tsx` | owner, office, tech |
| `/dispatch` | `dispatch/page.tsx` | owner, office |
| `/jobs` | `jobs/page.tsx` | owner, office, tech |
| `/jobs/[id]` | `jobs/[id]/page.tsx` | owner, office, tech |
| `/jobs/[id]/report` | `jobs/[id]/report/page.tsx` | owner, office, tech |
| `/tech` | `tech/page.tsx` | tech |
| `/customers` | `customers/page.tsx` | owner, office, tech |
| `/customers/[id]` | `customers/[id]/page.tsx` | owner, office, tech |
| `/customers/import` | `customers/import/page.tsx` | owner, office |
| `/leads` | `leads/page.tsx` | owner, office |
| `/messages` | `messages/page.tsx` | owner, office |
| `/messages/[phone]` | `messages/[phone]/page.tsx` | owner, office |
| `/calls` | `calls/page.tsx` | owner, office |
| `/estimates` | `estimates/page.tsx` | owner, office |
| `/estimates/[id]` | `estimates/[id]/page.tsx` | owner, office |
| `/estimates/[id]/edit` | `estimates/[id]/edit/page.tsx` | owner, office |
| `/invoices` | `invoices/page.tsx` | owner, office |
| `/invoices/[id]` | `invoices/[id]/page.tsx` | owner, office |
| `/invoices/[id]/edit` | `invoices/[id]/edit/page.tsx` | owner, office |
| `/expenses` | `expenses/page.tsx` | owner, office |
| `/inventory` | `inventory/page.tsx` | owner, office |
| `/pricebook` | `pricebook/page.tsx` | owner, office |
| `/recurring` | `recurring/page.tsx` | owner, office |
| `/route` | `route/page.tsx` | owner, office, tech |
| `/reports` | `reports/page.tsx` | owner, office |
| `/reports/custom` | `reports/custom/page.tsx` | owner, office |
| `/reports/export` | `reports/export/page.tsx` | owner, office |
| `/reports/commission` | `reports/commission/page.tsx` | owner, office |
| `/reports/timesheets` | `reports/timesheets/page.tsx` | owner, office |
| `/archive` | `archive/page.tsx` | owner, office |
| `/archive/import` | `archive/import/page.tsx` | owner, office |
| `/team` | `team/page.tsx` | owner |
| `/appearance` | `appearance/page.tsx` | owner, office, tech |
| `/finance` | `finance/page.tsx` | owner, office |
| `/settings` | `settings/page.tsx` | owner |
| `/settings/privacy` | `settings/privacy/page.tsx` | owner |
| `/settings/booking` | `settings/booking/page.tsx` | owner |
| `/settings/messages` | `settings/messages/page.tsx` | owner |
| `/settings/payments` | `settings/payments/page.tsx` | owner, office |
| `/operations` | `operations/page.tsx` | owner, office |
| `/warranties` | `warranties/page.tsx` | owner, office |
| `/fleet` | `fleet/page.tsx` | owner, office |
| `/growth` | `growth/page.tsx` | owner, office |
| `/migration` | `migration/page.tsx` | owner, office |
| `/admin` | `admin/page.tsx` | owner + platform admin |

*Not listed in the manifest but present:* `/more`, `/search`.

## 6. Public routes (8)

| Route | File | Purpose |
| --- | --- | --- |
| `/login` | `app/login/page.tsx` | Email + password sign-in, bilingual |
| `/signup` | `app/signup/page.tsx` | Workspace creation |
| `/forgot-password` | `app/forgot-password/page.tsx` | Reset-link request |
| `/reset-password` | `app/reset-password/page.tsx` | New password |
| `/book/[org]` | `app/book/[org]/page.tsx` | 5-step public booking funnel |
| `/p/[token]` | `app/p/[token]/page.tsx` | Tokenised estimate/invoice view + e-sign approval |
| `/portal/[token]` | `app/portal/[token]/page.tsx` | Customer self-service portal |
| `/offline` | `app/offline/page.tsx` | PWA offline workspace |

---

## 7. Server actions (137, by module)

| Module | Actions |
| --- | --- |
| `admin/actions.ts` | `createSupportCase`, `updateSupportCase`, `createSupportSession`, `revokeSupportSession`, `saveFeatureFlag`, `createRelease`, `updateReleaseStatus` |
| `appearance/actions.ts` | `saveAppearance` |
| `archive/actions.ts` | `bulkImportLegacy`, `restoreFromArchive` |
| `customers/actions.ts` | `createCustomer`, `updateCustomer`, `deleteCustomer` |
| `customers/[id]/actions.ts` | `addReview` |
| `customers/import/actions.ts` | `bulkImportCustomers` |
| `dashboard-actions.ts` | `dismissOnboarding` |
| `dispatch/actions.ts` | `moveDispatchJob`, `addJobTechnician`, `removeJobTechnician` |
| `estimates/actions.ts` | `createEstimate`, `updateEstimate`, `duplicateEstimate`, `deleteEstimate`, `setEstimateStatus`, `convertEstimateToInvoice` |
| `expenses/actions.ts` | `addExpense`, `deleteExpense` |
| `finance/actions.ts` | `createTaxJurisdiction`, `createTaxFiling`, `createSettlement`, `createDispute`, `updateSettlementStatus`, `updateDispute` |
| `growth/actions.ts` | `createCampaign`, `createReferralProgram`, `recordAdSpend`, `scheduleEstimateFollowup` |
| `inventory/actions.ts` | `saveInventoryItem`, `adjustQuantity`, `deleteInventoryItem` |
| `invoices/actions.ts` | `createInvoice`, `updateInvoice`, `duplicateInvoice`, `deleteInvoice`, `setInvoicePaid` |
| `jobs/[id]/actions.ts` | `generateJobSummary`, `approveJobSummary`, `createInvoiceFromJob`, `updateJobAddress`, `addJobItem`, `deleteJobItem`, `addJobTask`, `toggleJobTask`, `deleteJobTask`, `addChecklistItem`, `toggleChecklistItem`, `deleteChecklistItem`, `addEquipment`, `deleteEquipment`, `recordJobPayment`, `recordPhoto`, `deletePhoto`, `updateJobStatus`, `setOnMyWay`, `clockIn`, `clockOut`, `completeJob`, `setJobStage`, `setJobTags`, `setJobExpenses`, `requestReview` |
| `leads/actions.ts` | `updateLeadStatus`, `convertLead`, `deleteLead` |
| `messages/actions.ts` | `sendText` |
| `migration/actions.ts` | `importMigrationCustomers`, `rollbackMigration` |
| `operations/actions.ts` | `createCrew`, `createServiceArea`, `createAutomation`, `createVendor`, `createPurchaseOrder`, `createSubcontractor` |
| `pricebook/actions.ts` | `savePriceItem`, `deletePriceItem` |
| `recurring/actions.ts` | `savePlan`, `deletePlan`, `generateDuePlans` |
| `reports/commission/actions.ts` | `updateCommission` |
| `reports/export/actions.ts` | `exportCsv` |
| `schedule/actions.ts` | `createJob`, `setJobStatus` |
| `service-records/actions.ts` | `addJobAction`, `completeJobAction`, `saveJobWarranty`, `reportWarrantyCallback`, `scheduleWarrantyCallback`, `resolveWarrantyCallback`, `logCall`, `saveTrackedNumber`, `markCallFollowedUp` |
| `settings/actions.ts` | `updateSettings` |
| `settings/booking/actions.ts` | `saveBookingSettings`, `addBookingQuestion`, `deleteBookingQuestion` |
| `settings/jobstatuses-actions.ts` | `saveJobStatus`, `deleteJobStatus` |
| `settings/jobtypes-actions.ts` | `saveJobType`, `deleteJobType` |
| `settings/messages-actions.ts` | `saveMessageTemplate` |
| `settings/payments/actions.ts` | `updatePaymentSettings`, `beginHelcimOnboarding`, `reviewManualPayment` |
| `settings/privacy/actions.ts` | `savePrivacySettings`, `recordConsent`, `createPrivacyRequest`, `updatePrivacyRequest`, `createRetentionHold`, `releaseRetentionHold`, `previewRetention`, `anonymizeCustomerForRequest` |
| `share-actions.ts` | `autoSendDocument` |
| `team/actions.ts` | `inviteMember`, `changeRole`, `updateCapabilities`, `updatePaymentPermissions`, `removeMember`, `cancelInvite` |
| `portal/[token]/actions.ts` | `submitPortalRequest` |

---

## 8. API routes (18)

| Endpoint | Methods | Purpose |
| --- | --- | --- |
| `/api/health` | GET | Health probe |
| `/api/booking/[org]/slots` | GET | Public availability lookup |
| `/api/booking/[org]/submit` | POST | Public booking submission |
| `/api/calls/incoming` | POST | Inbound-call webhook (Twilio) |
| `/api/calls/status` | POST | Call-status webhook |
| `/api/sms/incoming` | POST | Inbound SMS webhook |
| `/api/cron/daily` | GET/POST | Daily reminders + recurring generation (Vercel cron `0 13 * * *`) |
| `/api/devices/location` | POST | Technician location ping |
| `/api/devices/push` | POST | Push-subscription registration |
| `/api/pay/[token]` | GET/POST | Tokenised payment page data |
| `/api/pay/helcim/initialize` | POST | Start Helcim HostedPay checkout |
| `/api/pay/helcim/confirm` | POST | Confirm Helcim checkout |
| `/api/pay/manual` | POST | Manual payment submission (Zelle / mailed check) |
| `/api/payments/connected-account` | POST | Merchant onboarding |
| `/api/payments/provider-events` | POST | Helcim webhook (signature-verified) |
| `/api/stripe/webhook` | POST | Stripe webhook |
| `/api/privacy/export/[requestId]` | GET | GDPR/CCPA data export |
| `/api/sync/job-status` | POST | Offline-outbox job-status sync |

---

## 9. Library functions

| Module | Exports |
| --- | --- |
| `lib/auth.ts` | `requireProfile`, `assertRole`, `loadCapabilities`, `assertCapability` |
| `lib/i18n.ts` | `dirFor`, `isLocale`, `localeFromCookie`, `t`, `sourceOptions` |
| `lib/locale-server.ts` | `getLocale` |
| `lib/nav.ts` | `NAV_ITEMS` |
| `lib/format.ts` | `money`, `moneyShort`, `fmtDate`, `todayISO`, `monthBounds` |
| `lib/core/money.mjs` | `parseAmountToMinor`, `parseQtyToMilli`, `lineSubtotalMinor`, `computeDocument`, `formatMoney` |
| `lib/core/scheduling.mjs` | `intervalsOverlap`, `validateInterval`, `findConflicts`, `canBook`, `canTransition`, `toEpochMinutes` |
| `lib/core/calls.mjs` | `normalizeUsPhone`, `formatUsPhone`, `mapVoiceStatus`, `callNeedsFollowUp`, `escapeXml` |
| `lib/booking.ts` | `normalizePhone`, `addMinutes`, `buildBookingSlots`, `matchesServiceArea`, `createBookingReference` |
| `lib/documents.ts` | `createDocument`, `updateDocument`, `duplicateDocument`, `softDeleteDocument` |
| `lib/payments/server.ts` | `startHelcimCheckout`, `confirmHelcimCheckout`, `submitManualPayment`, `reconcileHelcimTransaction`, `reconcilePendingHelcimPayments` |
| `lib/payments/helcim.ts` | `initializeHelcimCheckout`, `helcimRegistrationUrl`, `getHelcimTransaction`, `verifyHelcimPaymentHash`, `verifyHelcimWebhook`, `normalizeHelcimTransaction`, `safeHelcimTransaction` |
| `lib/payments/crypto.ts` | `encryptPaymentSecret`, `decryptPaymentSecret` |
| `lib/payments/receipts.ts` | `sendPaymentReceipt`, `retryFailedPaymentReceipts` |
| `lib/payments/core.mjs` | `normalizeHelcimTransaction`, `paymentAmountParts` |
| `lib/notify.ts` | `fillTemplate`, `notifyOnMyWay`, `sendReviewRequest` |
| `lib/providers.ts` | `appUrl`, `sendEmail`, `sendSms`, `createCheckoutUrl` |
| `lib/voice-provider.ts` | `validateTwilioSignature`, `webhookUrl`, `formRecord` |
| `lib/cron-tasks.ts` | `runRecurringGeneration`, `runReminders` |
| `lib/data-retention.ts` | `runDataRetentionForOrganization`, `runAutomaticDataRetention` |
| `lib/job-history.ts` | `loadJobHistory` |
| `lib/activity.ts` | `loadActivity` |
| `lib/industry-packs.ts` | `catalogItemsFor`, `INDUSTRY_PACKS` |
| `lib/offline-outbox.ts` | `readOutbox`, `queueJobAction`, `flushJobOutbox` |
| `lib/platform-admin.ts` | `isPlatformAdmin`, `getPlatformAdmin` |
| `lib/validation.ts` | Zod schemas |
| `lib/supabase/*` | `createClient` (client + server), `createAdminClient`, `updateSession` |

---

## 10. Components (77)

**Shell / nav:** `Nav`, `NavLink`, `MobileTabs`, `SidebarTools`, `TopBar`, `QuickCreate`, `AuthShell`, `Tabs`, `AppIcon`, `LanguageToggle`, `LocaleProvider`, `PwaRegistration`

**Jobs:** `JobsList`, `JobActions`, `JobItems`, `JobTasks`, `JobChecklist`, `JobEquipment`, `JobPhotos`, `JobPayments`, `JobExpensesField`, `JobFieldTools`, `JobAddressForm`, `JobTagsEditor`, `JobSummaryPanel`, `JobHistoryPanel`, `JobWarrantyPanel`, `JobStatusesEditor`, `JobTypesEditor`

**Scheduling:** `Calendar`, `DispatchBoard`, `TechnicianWorkspace`, `OfflineWorkspace`

**Documents:** `DocList`, `DocForm`, `DocEditor`, `DocView`, `DocDetailActions`, `ShareDoc`, `SignApprove`, `PrintButton`, `CopyLinkButton`

**Customers:** `CustomerList`, `CustomerEditForm`, `CustomerPaymentOptions`, `ActivityTimeline`, `AddressAutocomplete`, `ReviewButton`, `ReviewForm`

**Comms:** `CallCenter`, `MessageComposer`, `MessageTemplatesEditor`

**Ops / finance:** `InventoryClient`, `RecurringClient`, `CommissionClient`, `TimesheetExport`, `MiniCharts`, `MigrationCenter`, `SetupChecklist`

---

## 11. Database

**97 tables.** Grouped:

- **Core** — `organizations`, `profiles`, `profile_capabilities`, `profile_payment_permissions`, `invitations`, `platform_admins`, `subscriptions`, `audit_log`
- **CRM** — `customers`, `leads`, `lead_attribution_costs`, `reviews`, `customer_portal_requests`, `custom_field_definitions`, `custom_field_values`
- **Jobs** — `jobs`, `job_types`, `job_statuses`, `job_items`, `job_tasks`, `job_checklist_items`, `job_equipment`, `job_photos`, `job_assignments`, `job_time_entries`, `job_actions`, `job_warranties`, `job_summary_drafts`, `warranty_callbacks`, `recurring_plans`
- **Documents** — `estimates`, `estimate_items`, `estimate_followups`, `invoices`, `invoice_items`, `price_book`
- **Payments** — `payments`, `payment_settings`, `payment_events`, `payment_requests`, `payment_schedules`, `payment_milestones`, `payment_notifications`, `payment_checkout_secrets`, `payment_disputes`, `manual_payment_submissions`, `merchant_connections`, `merchant_secrets`, `settlement_batches`, `settlement_payment_links`, `tax_jurisdictions`, `tax_filings`, `customer_tax_exemptions`
- **Comms** — `messages`, `sms_messages`, `email_messages`, `message_templates`, `call_events`, `tracked_phone_numbers`, `reminder_log`, `device_subscriptions`, `push_notification_events`
- **Booking** — `booking_settings`, `booking_services`, `booking_questions`
- **Operations** — `crews`, `crew_members`, `service_areas`, `vendors`, `purchase_orders`, `purchase_order_items`, `subcontractors`, `subcontractor_assignments`, `inventory_items`, `automation_rules`, `automation_runs`, `technician_locations`, `technician_location_consents`
- **Growth** — `campaigns`, `referral_programs`, `referrals`
- **Privacy** — `organization_privacy_settings`, `consent_events`, `privacy_requests`, `retention_holds`, `retention_runs`
- **Platform** — `support_cases`, `support_sessions`, `feature_flags`, `release_records`, `release_events`
- **Migration** — `migration_batches`, `catalog_import_batches`, `organization_industries`, `expenses`, `sync_outbox_receipts`, `webhook_events` *(dead — no code references it)*

**Live-only, untracked:** `provider_webhook_events` — exists in the database, in no migration file, RLS enabled with zero policies.
**Referenced in code but nonexistent:** `merchant_accounts` (`admin/page.tsx` — audit **B1**).

**27 Postgres functions:** `accept_invitation`, `approve_document`, `assert_child_org`, `audit_privacy_settings_trigger`, `audit_trigger`, `consent_events_append_only`, `create_booking_settings_for_org`, `create_org_and_owner`, `current_org_id`, `current_user_can`, `current_user_role`, `initialize_payment_settings`, `initialize_privacy_settings`, `next_document_number`, `prepare_payment_row`, `protect_last_owner`, `public_booking_info`, `public_booking_info_v2`, `public_customer_portal`, `public_document`, `public_payment_options`, `schedule_warranty_callback`, `set_updated_at`, `submit_booking`, `submit_customer_portal_request`, `sync_booking_service_from_job_type`

**22 migrations** in `db/` (`002_batch1` → `022_operations_privacy_team_admin`) plus `schema.sql`, `GO-LIVE.sql`, `MIGRATIONS.md`.

---

## 12. Settings capabilities (24)

From `config/feature-manifest.json`:

business profile · branding · tax and currency · job types · job statuses · message templates · online booking · review requests · team roles · payment methods · Helcim card and ACH · Zelle · mailed checks · estimate deposits · payment permissions · personal theme · accessibility preferences · tax operations · settlement reconciliation · chargeback operations · consent history · privacy requests · data retention · controlled releases

---

## 13. Industry packs (`lib/industry-packs.ts`)

Bilingual (EN + HE) service and part catalogues, ~19–21 items each:

`air-duct` (Air duct cleaning / ניקוי תעלות מיזוג) · `dryer-vent` (Dryer vent cleaning / ניקוי פתח מייבש) · `chimney` (Chimney service / שירותי ארובות) · `painting` (Painting / צביעה) · `masonry` (Masonry / עבודות אבן ולבנים) · and further packs through line 158.

Loaded via `catalogItemsFor()`. **Not currently wired into `job_types` or `booking_services`** — see audit **A6**.

---

## 14. Test coverage

| Suite | Tests | Result |
| --- | --- | --- |
| `tests/money.test.mjs`, `scheduling`, `calls`, `booking`, `helcim-payments` | 52 | ✅ pass |
| `tests/feature-preservation.test.mjs`, `public-assets`, `hydration-guard`, `tenant-isolation` | 13 | ✅ pass |
| `tests/e2e/console-errors.spec.ts` (Playwright) | — | not run this session |

**Untested areas:** all 137 server actions, all 18 API route handlers, RTL/bidi rendering, the accessibility-preference toggles, and navigation reachability (which is where four of the six P0 bugs live).

---

## 15. Environment variables (`.env.example` + code reads)

`NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` · `NEXT_PUBLIC_SITE_URL` · `NEXT_PUBLIC_APP_URL` · `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` · `HELCIM_PARTNER_TOKEN` · `HELCIM_CONNECTED_WEBHOOK_VERIFIER` · `HELCIM_PAYMENT_WEBHOOK_VERIFIER` · `PAYMENT_SECRETS_KEY` (note: plural `SECRETS`, read in `lib/payments/crypto.ts:6,7,11`) · `TWILIO_ACCOUNT_SID` · `TWILIO_AUTH_TOKEN` · `TWILIO_FROM` · `RESEND_API_KEY` · `EMAIL_FROM` · `CRON_SECRET` · `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`

Feature degradation is env-gated: `/api/payments/provider-events` returns `503 {"reason":"not configured"}` without `HELCIM_PAYMENT_WEBHOOK_VERIFIER`; `sendSms`/`sendEmail` no-op without provider credentials.
