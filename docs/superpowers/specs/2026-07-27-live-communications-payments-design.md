# ServicePro Live Communications and Payments Design

**Date:** 2026-07-27  
**Status:** Approved for implementation planning  
**Branch:** `feature/live-communications-payments`  
**Production branch:** `main` remains unchanged until an explicit merge decision.

## 1. Objective

Turn ServicePro's existing provider hooks into a real, low-volume, multi-tenant communications and payments pilot. Each organization configures its own business identity and completes self-service onboarding. Customers can receive and reply to real SMS and email, and can make real invoice or estimate-deposit payments.

The pilot must run for one month without requiring a custom domain. It must preserve strict organization isolation and provide a safe preview deployment before any production rollout.

## 2. Current System

ServicePro is a Next.js 14 application hosted on Vercel and connected to the private GitHub repository `chimneystar/servicepro-app`. Supabase provides authentication, organization-scoped CRM data, and storage.

The code already includes:

- Customers, jobs, estimates, invoices, and payments
- Organization and role-based access
- SMS and email message tables
- Twilio outbound SMS helper
- Resend outbound email helper
- Stripe Checkout creation
- Stripe payment webhook processing
- Public invoice and estimate pages

The missing production pieces are per-organization provider onboarding, incoming SMS, incoming email, delivery state synchronization, unified conversations, and stronger webhook isolation and idempotency.

## 3. Product Model

The organization's saved business name is the customer-facing identity. For example, if the organization is named "Santa Chimney Sweep," that name appears on messages, invoices, Checkout, receipts, and public document pages.

Each organization owns a separate logical integration set:

- One connected Gmail mailbox
- One Twilio subaccount, Messaging Service, registered brand/campaign, and local number
- One Stripe connected account
- Separate conversations, message records, payments, usage totals, and integration health

The initial pilot is USD-only and supports consented US customers.

## 4. Provider Architecture

### 4.1 Email: Gmail API

A custom domain is not required during the pilot. Each organization connects an existing Google mailbox through OAuth.

ServicePro will:

- Send messages through the Gmail API using the connected mailbox
- Use the organization name as the friendly business identity where Gmail permits
- Preserve Gmail thread identifiers and RFC message headers
- Receive mailbox-change notifications through Google Cloud Pub/Sub
- Synchronize replies into ServicePro conversations
- Fetch and store supported attachments in organization-scoped Supabase Storage
- Renew each Gmail watch daily because Gmail watches expire within seven days
- Run a periodic history synchronization as a fallback for delayed or missed notifications

The Google OAuth application must use production publishing status for a month-long pilot. Pilot users may see Google's unverified-application warning until formal Google verification is completed.

OAuth refresh tokens are encrypted at rest using an application encryption key held only in Vercel environment variables. Tokens are never returned to browser clients or written to logs.

A future custom-domain phase can add Resend without changing the conversation model.

### 4.2 SMS: Twilio ISV Architecture

ServicePro will use one primary Twilio platform account with one subaccount per organization, matching Twilio's recommended ISV architecture.

For each organization, onboarding will:

1. Collect the required legal business and representative information.
2. Transmit registration data to Twilio Trust Hub.
3. Create a Secondary Customer Profile.
4. Register a Low-Volume Standard Brand using the organization's EIN.
5. Register a low-volume mixed-use campaign for customer care, appointment notifications, estimates, invoices, and payment reminders.
6. Create a Messaging Service.
7. Search for an SMS-capable local number using the organization's service location and preferred area code.
8. Fall back to a nearby area code only after showing the available number to the organization.
9. Attach the approved campaign and number to the organization's Messaging Service.

ServicePro will not retain the complete EIN after submission. It stores only the last four digits, provider identifiers, registration states, failure reasons, and timestamps.

Twilio webhooks will provide:

- Incoming customer messages
- Sent, delivered, undelivered, and failed states
- Provider error codes
- STOP, START, and HELP behavior

All Twilio webhook signatures must be verified before processing. Phone numbers are normalized to E.164. The receiving Twilio number maps the event to exactly one organization.

### 4.3 Payments: Stripe Connect

ServicePro will become a Stripe Connect platform and use Stripe-hosted onboarding. Each organization completes identity, EIN, and bank verification directly with Stripe; ServicePro never receives or stores bank credentials.

Payments use direct charges on the connected account:

- The customer pays the service business, not ServicePro.
- The connected business is responsible for normal processing fees, refunds, and disputes.
- Full invoice payments and estimate deposits are supported.
- ServicePro does not add a platform fee during the pilot.
- Stripe sends receipts using the connected account configuration.

Checkout Sessions are created in the connected account context. Stripe events are received through a Connect webhook, verified, and routed by connected-account ID and ServicePro metadata.

Successful payment processing will:

- Create one idempotent payment record
- Mark a full invoice paid
- Record an estimate deposit without incorrectly marking an invoice paid
- Display the event in the customer timeline
- Preserve Stripe session, PaymentIntent, connected-account, amount, currency, and event identifiers

## 5. Data Model

A migration will add or normalize these organization-scoped records.

### `integration_connections`

- `id`
- `organization_id`
- `provider`: `google`, `twilio`, or `stripe`
- `status`: `not_started`, `pending`, `action_required`, `active`, `restricted`, or `disconnected`
- `external_account_id`
- `encrypted_credentials` for Google OAuth only
- `configuration` for non-secret provider metadata
- `last_error`
- `connected_at`, `updated_at`

### `conversations`

- `id`
- `organization_id`
- `customer_id`
- `channel`: `sms` or `email`
- `external_thread_id`
- `peer_address`
- `subject`
- `last_message_at`
- `unread_count`
- `archived_at`

A customer may have one SMS conversation per phone number and multiple email threads when subjects differ.

### `communications`

Existing SMS and email rows will be exposed through a normalized conversation layer or migrated into a common table containing:

- Organization, customer, and conversation identifiers
- Direction and channel
- Sender and recipient
- Text and sanitized HTML bodies
- Provider and provider message ID
- Delivery state and error details
- RFC `Message-ID`, `In-Reply-To`, and `References` where applicable
- Sent, delivered, read, received, failed, and created timestamps

### `communication_attachments`

Stores attachment metadata and an organization-scoped Supabase Storage path. File size and MIME type limits are enforced before persistence.

### `provider_webhook_events`

Stores provider, immutable event ID, organization ID, processing state, timestamps, and a payload hash. A unique provider/event constraint prevents duplicate processing.

Row-level security ensures owners and permitted office users only see records belonging to their organization. Provider webhooks use the Supabase service role only after provider signature verification and organization resolution.

## 6. User Experience

### Integrations Settings

The owner sees three setup cards:

- **Email:** Connect Google, connected mailbox, synchronization state, reconnect/disconnect
- **Text messaging:** registration steps, chosen local number, approval state, estimated provider fees
- **Payments:** Stripe onboarding state, payouts enabled, payments enabled, action required

No API-key input fields are shown to business users.

### Unified Messages

The existing Messages area becomes a unified inbox with:

- All, SMS, email, unread, and archived filters
- One customer-focused conversation list
- Channel and delivery indicators
- Incoming and outgoing attachments
- Quick-reply templates
- Customer profile navigation
- Clear opted-out and delivery-failure states
- Manual refresh plus automatic updates

### Invoice and Estimate Sending

The send flow provides:

- Customer and recipient preview
- Email subject and editable message
- SMS message preview and segment estimate
- Email, SMS, or both delivery
- Secure public document/payment link
- Send result and delivery state
- Re-send action with history

The organization cannot send SMS to an opted-out number.

### Customer Timeline

Customer records show communications and operational events together, including documents sent, estimates viewed or signed, payments completed, refunds, and message failures.

## 7. Security and Reliability

- Never commit provider credentials.
- Encrypt Google refresh tokens at rest.
- Verify Google Pub/Sub, Twilio, Stripe, and future email-provider webhooks.
- Sanitize inbound HTML before rendering.
- Enforce attachment size and content-type rules.
- Use idempotency keys for outbound email, SMS logging, Stripe sessions, and webhook processing.
- Redact message content, tokens, EINs, and payment data from logs.
- Rate-limit public and webhook routes.
- Preserve provider event payload hashes for audit without unnecessarily retaining sensitive payloads.
- Use feature flags per organization for `live_email`, `live_sms`, and `live_payments`.
- Support disconnect and credential revocation.
- Keep manual "mark paid" behavior separate from online Stripe payments.

## 8. Usage Controls for the Pilot

Default safeguards for each pilot organization:

- Warning before any Twilio registration or number charge
- Configurable monthly SMS segment cap
- Configurable daily email send cap
- No bulk marketing or broadcast sending
- Only transactional and customer-care communications
- Owner-visible usage and failure totals
- Automatic suspension on repeated provider authentication failures
- Admin-visible webhook health and last-success timestamps

## 9. Branch, Preview, and Rollout

All work occurs on `feature/live-communications-payments`.

- `main` remains the original production project.
- GitHub creates an isolated Vercel preview for the feature branch.
- Preview uses Stripe sandbox and non-production feature flags.
- Twilio begins with verified test recipients, then moves to the approved live organization after A2P registration.
- Gmail begins with the pilot mailbox and production OAuth publishing status.
- No production environment variable, database migration, provider webhook, or live payment setting changes until preview verification is complete and the user explicitly approves rollout.
- Rollback is achieved by keeping organization feature flags off and leaving `main` unchanged.

## 10. Testing

### Automated

- Unit tests for phone normalization, thread matching, webhook verification helpers, idempotency, payment state transitions, MIME parsing, and HTML sanitization
- Database tests for organization isolation and duplicate event handling
- Route tests for rejected signatures, malformed events, missing mappings, and provider retries
- Build, typecheck, and lint checks

### Preview Integration

- Connect a pilot Gmail mailbox and send to a controlled recipient
- Reply from that recipient and verify the same ServicePro thread updates
- Test an email attachment
- Send SMS to a verified test number and receive a reply
- Verify delivered and failed SMS states
- Complete successful, declined, canceled, duplicate, deposit, refund, and full-payment Stripe sandbox scenarios
- Confirm that one organization's events cannot appear in another organization

### Live Pilot

- Send one consented SMS and receive a reply
- Send one email and receive a reply
- Complete a small real card payment and refund when operationally appropriate
- Confirm invoice/payment records, receipts, and customer timeline events
- Monitor failures and webhook health during the month

## 11. External Setup Required

The ServicePro platform owner must create the primary Google Cloud, Twilio, and Stripe Connect accounts and complete their platform-level identity and billing steps. Secrets are entered only in provider or Vercel dashboards.

Each organization then completes its own business onboarding inside ServicePro:

- Google mailbox authorization
- Twilio business registration and number approval
- Stripe-hosted identity, EIN, and bank onboarding

## 12. Out of Scope for This Pilot

- Purchasing or configuring a custom domain
- Resend production sending
- Outlook or Microsoft 365 mailbox connection
- Marketing blasts or drip campaigns
- Voice calling, call recording, and voicemail
- Native iOS or Android applications
- ServicePro platform fees on payments
- Automatic rebilling of Twilio usage to organizations

## 13. Acceptance Criteria

The pilot is complete when:

1. A business owner can connect Google, complete Twilio registration, and complete Stripe onboarding without entering provider API keys.
2. Real consented SMS messages send and receive inside the correct ServicePro customer thread.
3. Real Gmail messages send and customer replies and attachments synchronize into the correct thread.
4. A real Stripe payment reaches the connected business, records exactly once, and updates the correct invoice or estimate deposit.
5. Delivery, failure, opt-out, and onboarding states are visible and actionable.
6. Cross-organization access and webhook routing tests pass.
7. The feature branch builds successfully in its Vercel preview.
8. The original `main` production branch remains unchanged until explicit approval to merge.
