# ServicePro Live Communications and Payments Implementation Plan

**Date:** 2026-07-27
**Branch:** `feature/live-communications-payments`
**Design:** `docs/superpowers/specs/2026-07-27-live-communications-payments-design.md`
**Production rule:** Do not modify or deploy `main` during the pilot.

## Goal

Deliver a month-long, real-world pilot in which one ServicePro organization can:

- show its saved business name on customer communications and payment pages;
- connect a Gmail mailbox and send/receive customer email replies in ServicePro;
- obtain and use a local Twilio number for two-way customer SMS;
- onboard its own Stripe connected account and accept real USD invoice payments;
- see SMS, email, payment, and delivery status on the appropriate customer timeline;
- self-manage integration status without exposing EIN, bank, card, OAuth, or provider secrets to ServicePro users.

## Delivery Strategy

Build vertical slices in dependency order. Each slice must leave the feature branch deployable. External provider credentials are added only to Vercel Preview until the pilot is approved for production.

## Phase 1 — Safe foundation and schema

1. Inventory the existing organization, membership, customer, message, invoice, payment, Supabase client, and settings patterns.
2. Add one additive Supabase migration for:
   - `integration_connections`;
   - `conversations`;
   - `communications`;
   - `communication_attachments`;
   - `provider_webhook_events`;
   - required provider/status indexes and uniqueness constraints.
3. Enable RLS on every new public table.
4. Reuse the CRM's existing organization-membership authorization predicate in SELECT/INSERT/UPDATE policies; do not authorize from user-editable metadata.
5. Keep tokens and provider secrets server-only. Store encrypted credential payloads, safe status metadata, and non-sensitive identifiers separately.
6. Add provider-neutral TypeScript types and repository helpers that normalize SMS and email into the same communication model.

Verification:

- migration is additive and reversible by a documented down procedure;
- all new exposed tables have RLS and organization-scoped policies;
- duplicate provider webhooks are rejected by a unique provider/event constraint;
- TypeScript and Next.js preview build pass.

## Phase 2 — Integrations settings and business identity

1. Add an Integrations section to organization settings with Gmail, Text Messaging, and Payments cards.
2. Display one of: Not connected, Action required, Pending review, Connected, or Error.
3. Show the organization name as the customer-facing sender/business identity.
4. Add location-derived area-code preference with a manual override for number scarcity.
5. Add disconnect/reconnect controls with confirmation and safe token revocation.
6. Add setup diagnostics that name the missing platform environment variable without revealing its value.

Verification:

- only organization members can view status;
- only organization owners/admins can connect or disconnect providers;
- organization A cannot read or mutate organization B's connection rows;
- settings render safely when no provider environment variables exist.

## Phase 3 — Gmail send and reply sync

1. Implement Google OAuth authorization with state, PKCE, and organization/user binding.
2. Request the minimum Gmail scopes needed to send and read message replies.
3. Exchange and encrypt refresh tokens on the server; never return them to the browser.
4. Create Gmail watch registration and renewal support using Cloud Pub/Sub.
5. Add a signed Pub/Sub webhook route that acknowledges quickly and triggers history synchronization.
6. Normalize sent and received Gmail messages, thread IDs, headers, bodies, and attachments into the unified tables.
7. Match replies to existing conversations by provider thread ID first, then organization-scoped customer email.
8. Add an idempotent scheduled renewal/sync endpoint for watches and missed events.

Verification:

- OAuth state tampering and cross-organization callbacks fail;
- a sent email appears immediately with pending/sent status;
- a real Gmail reply appears in the same ServicePro conversation;
- webhook replay does not duplicate the message;
- attachments remain organization-scoped.

## Phase 4 — Twilio two-way SMS and self-onboarding

1. Add server-only Twilio REST helpers using the primary ISV account.
2. Create one Twilio subaccount and Messaging Service per ServicePro organization.
3. Collect onboarding fields in ServicePro but submit legal/business data directly to Twilio where possible; retain only safe references and EIN last four.
4. Create the Secondary Customer Profile, A2P brand, campaign, and local-number provisioning workflow.
5. Prefer the business's requested area code; fall back to nearby inventory only after clearly showing the alternative.
6. Route outbound messages through the organization's Messaging Service.
7. Add Twilio inbound-message and delivery-status webhook routes with signature verification and idempotency.
8. Normalize incoming messages and media attachments into the same conversation model.
9. Enforce pilot usage caps and show actionable compliance/status errors.

Verification:

- Twilio signature failures return 403/400 and write no communication;
- a real outbound SMS reaches a consented customer;
- the customer's reply appears in the same ServicePro conversation;
- delivery/failure status updates the original outbound record;
- organization credentials and phone numbers never cross tenants.

## Phase 5 — Stripe Connect and real invoice payments

1. Replace platform-account Checkout creation with organization-specific Stripe Connect context.
2. Add Stripe-hosted connected-account onboarding and return/refresh routes.
3. Store only the connected account ID and capability/status metadata.
4. Create direct-charge Checkout Sessions on the connected account with invoice/customer metadata and no pilot application fee.
5. Update the payment page and invoice-send flow to show the organization name and real amount in USD.
6. Extend webhook handling for connected-account events, raw-body signature verification, and idempotency.
7. Reconcile completed/expired/failed sessions into existing invoice and payment records.

Verification:

- an organization without a ready Stripe account cannot create a misleading payment link;
- Stripe onboarding resumes after interruption;
- a real low-value USD payment marks exactly one invoice paid and creates exactly one payment record;
- webhook replay is harmless;
- ServicePro never receives bank or card data.

## Phase 6 — Unified inbox and customer timeline

1. Evolve the existing Messages screen into a Workiz-style unified inbox.
2. Add All, Text, Email, Unread, and Failed filters.
3. Show customer, channel, last message, delivery state, unread count, and timestamp in the list.
4. Show a chronological mixed-channel thread with attachments and payment/invoice context.
5. Add a composer with SMS/Email channel selector, email subject, attachment support, and clear disabled states when a channel is not connected.
6. Add unread/read behavior and realtime refresh using the project's existing Supabase realtime pattern.
7. Add the normalized communication history to the customer timeline.

Verification:

- mobile and desktop layouts are usable;
- switching channel cannot send to the wrong phone/email;
- empty, loading, failure, disconnected, and consent-warning states are explicit;
- keyboard focus and form labels meet basic accessibility expectations.

## Phase 7 — Invoice and estimate send workflow

1. Add Housecall Pro-style send preview before dispatch.
2. Allow Text, Email, or both, based on connected channels and customer contact data.
3. Preview organization sender name, recipient, subject/body, amount, and payment link.
4. Record each channel attempt separately while grouping them under the same business event.
5. Prevent duplicate submissions using server-side idempotency keys.

Verification:

- a combined send produces one SMS and one email, not duplicates;
- failures are visible per channel and retryable;
- payment links use the correct organization and invoice.

## Phase 8 — Pilot operations and rollout

1. Add a health checklist for Gmail watch expiry, Twilio compliance/number status, Stripe capabilities, webhook age, and recent failures.
2. Add one-month pilot caps and visible usage counters.
3. Document provider-console setup, Vercel Preview variables, webhook URLs, Google production OAuth status, Twilio registration costs, and Stripe test/live-mode separation.
4. Run lint, typecheck, build, database security/advisor checks, and targeted provider/webhook tests.
5. Exercise a real end-to-end pilot with a consented phone/email and a low-value payment.
6. Open a draft pull request from the feature branch for review; do not merge it into `main` without explicit approval.

## Environment Variables

All are server-only unless explicitly prefixed `NEXT_PUBLIC_`.

- `INTEGRATION_ENCRYPTION_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_PUBSUB_VERIFICATION_TOKEN`
- `GOOGLE_PUBSUB_AUDIENCE`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `STRIPE_SECRET_KEY`
- `STRIPE_CONNECT_WEBHOOK_SECRET`
- existing Supabase URL, publishable/anon key, and service-role variables
- `NEXT_PUBLIC_APP_URL` set to the isolated preview during the pilot

## External Account Checkpoints

Code can be built without live secrets, but these browser-based identity steps require the product owner:

1. Create/authorize the ServicePro Google Cloud OAuth and Pub/Sub project.
2. Create/authorize the ServicePro Twilio ISV account and fund required registration/number charges.
3. Create/authorize the ServicePro Stripe Connect platform and switch connected accounts from test to live mode when ready.
4. Add secrets directly in Vercel Preview settings; never paste them into chat, source control, or client-visible variables.

## Completion Gate

The implementation is not complete until fresh evidence shows:

- branch preview build succeeds;
- database migration and RLS checks succeed;
- real Gmail send and reply sync succeed;
- real SMS send and reply sync succeed;
- real low-value Stripe payment succeeds and reconciles once;
- `main` and its production deployment remain unchanged.
