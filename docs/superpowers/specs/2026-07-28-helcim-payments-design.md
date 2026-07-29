# ServicePro Helcim Payments Design

**Date:** July 28, 2026

**Status:** Approved design

**Launch market:** United States

## 1. Purpose

ServicePro will give each service business a simple, branded way to collect estimate deposits, progress payments, final invoice payments, and optional tips. Card and ACH payments will run through that business's own Helcim connected merchant account. Zelle and mailed checks will remain supported as manually verified payment methods.

This is a standalone product subsystem. It covers merchant onboarding, payment collection, payment state, reconciliation, refunds, receipts, and payment permissions. It does not cover ServicePro subscription billing, customer financing, accounting integrations, or Canadian payments.

## 2. Approved product decisions

- ServicePro launches payments in the United States only.
- ServicePro will use Helcim's Integration Partner connected-account model.
- The Helcim partner application is in progress. Production processing remains gated until Helcim approves the partnership and issues the required partner credentials.
- ServicePro is free for now. This design does not add subscription billing.
- Each business receives funds directly through its own Helcim merchant account.
- Customers can pay through the online customer portal, a secure payment link, or a Helcim in-person terminal used by an authorized technician.
- The standard payment schedule is a deposit followed by the final balance. Businesses can add custom progress-payment milestones.
- A business can define a default deposit as a percentage, fixed amount, or no deposit, and can override it on an individual estimate.
- Helcim Fee Saver passes eligible credit-card processing fees to the customer. ServicePro does not add its own transaction fee.
- ACH must settle before work becomes ready to schedule by default. An authorized owner or office user can override that hold, and the override is audited.
- Customers can save eligible payment methods only after explicit consent.
- Tips are optional per business.
- Refunds are available to owners and office users who have the refund permission. Technicians cannot refund payments.
- Receipts and payment-status notices are available through email, SMS, and the customer portal.
- Zelle and mailed checks are never treated as paid solely because a customer says they sent them; an authorized user must verify receipt.

## 3. Chosen architecture

### 3.1 Helcim connected accounts

Each ServicePro organization maps to one Helcim connected merchant account. Onboarding opens a co-branded Helcim registration flow, prefilled with business information already collected by ServicePro. Helcim collects and verifies sensitive identity, banking, ownership, and risk information. ServicePro stores only the connection identifiers, onboarding status, capabilities, and encrypted merchant API token returned through the partner webhook.

Merchant onboarding states are:

1. `not_started`
2. `application_started`
3. `under_review`
4. `action_required`
5. `approved`
6. `rejected`
7. `suspended`

Card and ACH controls remain unavailable until the account is `approved` and the relevant Helcim capability is enabled. Zelle and mailed-check settings can be configured independently.

### 3.2 Bounded components

The subsystem is split into focused units:

- **Merchant Connection:** starts onboarding, receives connected-account results, stores connection state, and reports required actions.
- **Payment Configuration:** stores enabled methods, deposit defaults, Fee Saver preference, tipping, ACH scheduling rules, Zelle instructions, and check remittance details.
- **Payment Schedule:** attaches deposits and milestones to estimates and invoices without coupling the schedule to a specific processor.
- **Payment Orchestrator:** creates Helcim checkout sessions, starts terminal payments, records manual submissions, and applies provider-neutral status transitions.
- **Webhook Receiver:** verifies Helcim signatures, retrieves transaction details, and processes events idempotently.
- **Reconciliation Worker:** rechecks pending or incomplete transactions and repairs missed webhook updates.
- **Payment Ledger:** provides the authoritative, immutable history of charges, fees, tips, refunds, and manual confirmations.
- **Receipt and Notification Service:** sends localized receipts and status changes through email, SMS, and the portal.

No user-interface component calls Helcim directly with a secret. All privileged requests originate on the ServicePro server.

## 4. Data design

The existing `payments` model will be migrated to provider-neutral fields instead of adding more Stripe-specific columns.

### 4.1 Merchant connections

One record per organization:

- ServicePro organization ID
- Helcim connected-account ID
- encrypted Helcim merchant API token
- connection and capability status
- onboarding timestamps and last status reason
- card, ACH, terminal, and Fee Saver availability
- last successful webhook and reconciliation timestamps

Secrets must be encrypted using a managed server-side key and must never be returned to a browser, log, analytics system, or client error message.

### 4.2 Payment configuration

One active configuration per organization:

- enabled customer payment methods
- default deposit type and value
- default schedule rule
- Fee Saver preference and actual Helcim eligibility
- ACH scheduling hold and authorized override roles
- tipping enabled and suggested tip values
- Zelle recipient name, enrolled email or US mobile number, optional owner-uploaded QR image, and customer instructions
- check payee, remittance address, and memo instructions
- receipt channels and localized templates

### 4.3 Payment schedules and requests

A schedule contains ordered milestones. Each milestone stores its label, calculation type, amount or percentage, due rule, and status. The default schedule contains `Deposit` and `Final payment`. Custom schedules may add progress milestones while preserving a final balance that prevents rounding errors.

A payment request records the estimate or invoice, customer, organization, amount due, allowed methods, public access token, expiration, and status. The request snapshots the business name, terms, payment instructions, currency, and accepted payment methods so later settings changes do not alter a request that was already sent.

### 4.4 Transactions and events

Each transaction stores:

- organization, customer, job, estimate, invoice, and milestone references
- provider (`helcim`, `zelle`, `check`, `cash`, or `other`)
- provider transaction ID and idempotency key
- base amount, surcharge, tip, refund, and net applied amount as separate values
- method and non-sensitive display details
- provider authorization and clearing states
- ServicePro normalized status
- timestamps for initiation, submission, settlement, failure, refund, and manual confirmation
- actor and reason for every manual action

Payment events are append-only. Duplicate provider events cannot create duplicate ledger entries or apply the same amount twice.

## 5. Customer experience

### 5.1 Estimate approval and deposit

The customer opens the branded estimate, reviews the scope, items, photos, and snapshotted terms, accepts the terms, signs, and then sees the required deposit. The estimate does not become ready for scheduling until its deposit rule is satisfied.

Available methods appear as plain choices: card, ACH, Zelle, or mail a check. The page explains the timing before the customer commits:

- Card: normally confirmed immediately after Helcim approves it.
- ACH: submitted now and confirmed after bank settlement.
- Zelle: instructions are displayed; the business verifies receipt.
- Check: remittance instructions are displayed; the business verifies receipt and clearing.

### 5.2 Card and ACH

ServicePro initializes HelcimPay.js for the correct connected merchant. Helcim's interface collects sensitive card or bank details. The return page says the payment was submitted; it does not independently mark the transaction paid. ServicePro changes the authoritative state only after receiving and verifying provider information.

When a customer consents to save a method, ServicePro stores only Helcim customer and payment-method references plus the consent record. The consent text, timestamp, customer identity, purpose, and revocation state are retained.

### 5.3 Fee Saver

The owner's intent is that the customer pay the processing fee. ServicePro implements this only through Helcim Fee Saver and only when Helcim identifies the transaction as eligible.

- The surcharge applies only to eligible credit-card transactions.
- Debit, prepaid, ACH, Zelle, cash, and checks are not surcharged.
- The customer sees the fee before confirming and sees it separately on the receipt.
- ServicePro always offers a non-surcharged alternative when Fee Saver requires one.
- ServicePro never calculates, increases, or forces a surcharge outside Helcim.
- If Fee Saver is unavailable because of merchant, card, transaction, or jurisdiction rules, the card remains available and the business absorbs the processing cost.

### 5.4 ACH

An accepted ACH request enters `processing`, not `paid`. ServicePro uses Helcim authorization and clearing status to decide when the payment has settled. The associated job remains on payment hold until settlement. An authorized owner or office user may release the hold early after acknowledging the risk; the activity log records the user, time, reason, amount, and still-pending transaction.

### 5.5 Zelle

The customer sees the business's configured Zelle recipient name, enrolled email or US mobile number, optional QR image, amount, and a unique memo containing the estimate or invoice number. Selecting `I sent the payment` creates a `verification_pending` submission. The customer may add a confirmation reference or upload proof, but neither automatically marks the payment paid. An authorized user compares the bank receipt and confirms or rejects the submission.

### 5.6 Mailed check

The customer sees `Payable to`, the remittance address, amount, and required memo. Selecting `I mailed the check` records the mailing date and optional check number. The payment remains pending until an authorized user records receipt and then confirms that it cleared. A returned check reopens the balance and creates an audited reversal event.

### 5.7 In-person technician payment

An authorized technician selects an open milestone or invoice balance from the mobile workspace and sends the amount to an organization-registered Helcim terminal. The amount and document reference are server-controlled. The technician cannot edit Fee Saver behavior, refund a payment, expose saved payment details, or manually mark a terminal transaction successful.

### 5.8 Tips

If the organization enables tipping, the customer may add a tip during eligible final or in-person payments. Tips are always optional, appear separately, and never reduce the invoice balance. The payment ledger associates the tip with the job and collecting technician for reporting.

## 6. Status model

Normalized transaction states are:

- `created`
- `action_required`
- `submitted`
- `processing`
- `settled`
- `failed`
- `cancelled`
- `partially_refunded`
- `refunded`
- `disputed`

Manual Zelle and check submissions additionally use `verification_pending` before `settled`.

Document payment states are calculated from settled and refunded ledger amounts:

- `unpaid`
- `deposit_due`
- `deposit_processing`
- `partially_paid`
- `paid`
- `payment_failed`
- `refunded`

Redirects, browser callbacks, customer claims, email clicks, and SMS clicks never directly produce `settled` or `paid` states.

## 7. Roles and permissions

- **Owner:** configure merchant connection and payment settings, view all financial details, confirm manual payments, override ACH holds, and issue refunds.
- **Office:** view and collect payments by default. Manual confirmation, ACH override, and refunds require separate permissions granted by an owner.
- **Technician:** collect an assigned in-person payment and view the payment status needed for the job. No refund, merchant configuration, manual confirmation, ACH override, or full payout access.

Every privileged financial action requires recent authentication and creates an activity-history event.

## 8. Notifications and bilingual content

All customer-facing payment content is written independently in natural English and natural Hebrew. It is not generated by literal runtime translation. The customer document's language controls the checkout explanation, consent, validation, status page, receipt, email, and SMS. Right-to-left layouts are tested separately.

Notifications cover payment request sent, deposit due, payment submitted, ACH processing, payment settled, payment failed, manual verification required, receipt, refund, and returned payment. A failure to send a notification does not change the payment state. Failed messages retry and remain visible to office users.

## 9. Security and compliance controls

- Helcim-hosted or embedded secure fields collect all card and bank details.
- Merchant API tokens and webhook verifier tokens are encrypted and server-only.
- Webhook signatures and timestamps are verified before processing.
- Provider transaction details are fetched server-side after a valid event.
- All writes are scoped by organization and protected by database row-level security.
- Public payment tokens are random, revocable, expiring, and rate-limited.
- Logs redact secrets, bank data, card data, signatures, and sensitive customer content.
- Fee Saver behavior comes from Helcim eligibility rather than ServicePro's own legal-rules table.
- Consent and accepted terms are immutable snapshots attached to the transaction.
- Refunds, manual confirmations, and ACH overrides require a reason and actor.

## 10. Reliability and recovery

Webhook processing is idempotent and safe to retry. The receiver acknowledges only events that were durably recorded. A reconciliation worker checks submitted and processing transactions until they reach a terminal state. It also detects amount mismatches, missing documents, stale ACH payments, and Helcim transactions that were not applied to the ledger.

If Helcim is unavailable, the portal preserves the payment request and tells the customer that online payment is temporarily unavailable. Zelle and check remain available only when enabled by the business. ServicePro never converts a provider timeout into a failed or paid transaction without confirmation.

Office users receive a reconciliation queue for items that require attention. Corrections create compensating ledger entries; settled financial history is never overwritten or deleted.

## 11. Current-system migration

The current application contains Stripe-specific provider checks, checkout routes, webhook fields, and payment IDs. Implementation will introduce a provider-neutral payment layer before replacing those paths.

Existing payment records remain readable. Stripe identifiers move into provider-reference fields or a compatibility record; they are not discarded. Helcim is enabled per organization behind a feature flag after its connected account is approved. Stripe checkout remains untouched until the Helcim sandbox flow, production credentials, webhook delivery, refunds, and reconciliation pass release checks. The final cutover removes customer access to Stripe without rewriting historical transactions.

## 12. Testing and acceptance criteria

Automated tests must cover:

- organization isolation and permission enforcement
- connected-account onboarding state transitions
- encrypted-secret handling and redacted logs
- card approval, decline, duplicate event, and refund flows
- ACH submission, settlement, failure, stale processing, and authorized hold override
- Zelle and check submission, confirmation, rejection, and reversal
- deposit percentages, fixed deposits, custom milestones, rounding, partial payments, and final balance
- Fee Saver eligible and ineligible transactions, with no fee applied to debit or ACH
- saved-method consent and revocation
- terminal payment permissions and mismatched amounts
- email, SMS, portal receipt, retries, and bilingual/RTL presentation
- webhook signature rejection, replay protection, and reconciliation recovery
- migration compatibility with historical Stripe payments

Release requires an end-to-end Helcim sandbox demonstration and controlled production test for each supported electronic method. No estimate or invoice may become paid from a redirect alone, no event may apply twice, and no organization may access another organization's merchant or transaction data.

## 13. Launch gates

The payment subsystem can be built and tested in isolation, but production activation requires:

1. Helcim Integration Partner approval and executed commercial terms.
2. Partner registration URL, partner API token, partner token, and webhook verifier credentials.
3. Approved connected-account test merchants with card, ACH, Fee Saver, and terminal capabilities as applicable.
4. Production webhook endpoints and monitored reconciliation jobs.
5. Reviewed customer consent, surcharge, ACH authorization, refund, privacy, and terms language.
6. Verified email and SMS sending infrastructure.
7. Completed security, permission, regression, and disaster-recovery checks.

## 14. References

- Helcim connected account registrations: https://devdocs.helcim.com/docs/connected-account-registrations
- Helcim connected account webhooks: https://devdocs.helcim.com/docs/connected-account-webhooks
- HelcimPay.js overview: https://devdocs.helcim.com/docs/overview-of-helcimpayjs
- Helcim payment types and methods: https://devdocs.helcim.com/docs/available-payment-types-and-methods-through-helcimpayjs
- Helcim ACH payments: https://devdocs.helcim.com/docs/ach-payments
- Helcim webhooks: https://devdocs.helcim.com/docs/webhooks
- Helcim Fee Saver terms: https://legal.helcim.com/us/payment-methods-products/fee-saver/
- Visa US merchant surcharge guidance: https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf
