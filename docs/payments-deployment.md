# ServicePro payments: production setup

The code is provider-ready, but live card and ACH charges stay disabled until the Helcim partner account, database migration, and production secrets are connected.

## 1. Database

Run `db/017_helcim_payments.sql` once in the Supabase SQL Editor after migration 015. The script adds tenant-isolated payment settings, Helcim connection state, payment requests, ACH settlement tracking, manual Zelle/check verification, staff permissions, audit events, and receipt delivery records.

## 2. Vercel environment variables

Add these as encrypted Production environment variables and redeploy:

- `SUPABASE_SERVICE_ROLE_KEY` — server-only Supabase service key.
- `PAYMENT_SECRETS_KEY` — a random 32-byte key encoded as base64. Never change it without rotating the encrypted merchant tokens.
- `HELCIM_PARTNER_TOKEN` — Helcim partner token used for registration links and partner attribution.
- `HELCIM_CONNECTED_WEBHOOK_VERIFIER` — verifier token supplied by the Helcim Partnerships team.
- `HELCIM_PAYMENT_WEBHOOK_VERIFIER` — verifier token from the merchant webhook configuration.
- `NEXT_PUBLIC_APP_URL=https://servicepro-app-psi.vercel.app`
- `CRON_SECRET` — a long random value protecting scheduled reconciliation.

For automatic email receipts and in-app document delivery:

- `RESEND_API_KEY`
- `EMAIL_FROM` — a sender on a domain verified in Resend, for example `ServicePro <receipts@yourdomain.com>`.

For automatic SMS receipts and updates:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM`

## 3. Helcim configuration

Give Helcim these HTTPS delivery URLs:

- Connected-account approvals: `https://servicepro-app-psi.vercel.app/api/payments/connected-account`
- Payment events: `https://servicepro-app-psi.vercel.app/api/payments/provider-events`

Enable Credit Card + ACH invoicing and Online Fee Saver for referred merchants. If Fee Saver is unavailable for a checkout, ServicePro automatically retries without the surcharge so the customer can still pay and the business absorbs that transaction's fee.

Add `servicepro-app-psi.vercel.app` to the allowed domains on the connected merchant API Access Configuration. Use a Helcim developer test account for end-to-end testing before enabling live processing.

## 4. Launch verification

1. Complete one test card payment and confirm the invoice becomes paid.
2. Submit one test ACH payment and confirm it remains Processing until Helcim reports settlement.
3. Submit Zelle and check notices, then confirm an authorized owner or office user can approve them.
4. Verify an unauthorized office user cannot view or approve manual payments.
5. Confirm email/SMS receipts are delivered once and appear in the message logs.
6. Confirm a second browser tab reuses or blocks the active checkout instead of creating a duplicate payment.

