import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeHelcimTransaction, paymentAmountParts } from "../lib/payments/core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(join(root, "db", "017_helcim_payments.sql"), "utf8").toLowerCase();
const customerComponent = readFileSync(join(root, "components", "CustomerPaymentOptions.tsx"), "utf8");
const helcimAdapter = readFileSync(join(root, "lib", "payments", "helcim.ts"), "utf8");
const paymentServer = readFileSync(join(root, "lib", "payments", "server.ts"), "utf8");
const paymentReceipts = readFileSync(join(root, "lib", "payments", "receipts.ts"), "utf8");

test("ACH submission stays processing until clearing settles", () => {
  assert.deepEqual(normalizeHelcimTransaction({ type: "WITHDRAWAL", statusAuth: "PENDING", statusClearing: "OPENED" }), { method: "ach", status: "processing" });
  assert.deepEqual(normalizeHelcimTransaction({ type: "WITHDRAWAL", statusAuth: "APPROVED", statusClearing: "APPROVED" }), { method: "ach", status: "settled" });
  assert.deepEqual(normalizeHelcimTransaction({ type: "WITHDRAWAL", statusAuth: "DECLINED", statusClearing: "DECLINED" }), { method: "ach", status: "failed" });
});

test("card approval and decline normalize correctly", () => {
  assert.deepEqual(normalizeHelcimTransaction({ status: "APPROVED", type: "purchase" }), { method: "card", status: "settled" });
  assert.deepEqual(normalizeHelcimTransaction({ status: "DECLINED", type: "purchase" }), { method: "card", status: "failed" });
});

test("Fee Saver accepts a bounded surcharge but never a lower or arbitrary amount", () => {
  assert.deepEqual(paymentAmountParts(10_000, "103.00", true), { actualMinor: 10_300, surchargeMinor: 300 });
  assert.deepEqual(paymentAmountParts(10_000, "100.00", false), { actualMinor: 10_000, surchargeMinor: 0 });
  assert.throws(() => paymentAmountParts(10_000, "99.99", true));
  assert.throws(() => paymentAmountParts(10_000, "107.00", true));
  assert.throws(() => paymentAmountParts(10_000, "103.00", false));
});

test("payment tables are tenant-scoped and RLS protected", () => {
  for (const table of ["profile_payment_permissions", "merchant_connections", "merchant_secrets", "payment_settings", "payment_schedules", "payment_milestones", "payment_requests", "payment_checkout_secrets", "manual_payment_submissions", "payment_events", "payment_notifications"]) {
    assert.ok(migration.includes(`alter table public.${table} enable row level security`), `${table} must enable RLS`);
  }
  assert.ok(migration.includes("organization_id = public.current_org_id()"));
  assert.ok(migration.includes("to authenticated"));
});

test("financial permissions cannot be self-granted through the profile policy", () => {
  assert.ok(migration.includes("create table if not exists public.profile_payment_permissions"));
  assert.ok(migration.includes("profile_payment_permissions_owner_write"));
  assert.ok(migration.includes("public.current_user_role() = 'owner'"));
  assert.ok(!migration.includes("alter table public.profiles add column if not exists can_refund_payments"));
});

test("processor and checkout secrets are denied to browser roles", () => {
  assert.ok(migration.includes("revoke all on public.merchant_secrets, public.payment_checkout_secrets from anon, authenticated"));
  assert.ok(migration.includes("merchant_secrets_no_client_access"));
  assert.ok(migration.includes("checkout_secrets_no_client_access"));
  assert.ok(!customerComponent.includes("PAYMENT_SECRETS_KEY"));
  assert.ok(!customerComponent.includes("HELCIM_PARTNER_TOKEN"));
});

test("legacy payment inserts receive provider-neutral compatibility values", () => {
  assert.ok(migration.includes("function public.prepare_payment_row()"));
  assert.ok(migration.includes("when new.stripe_payment_intent_id is not null then 'stripe'"));
  assert.ok(migration.includes("when new.status = 'paid' then 'settled'"));
  assert.ok(migration.includes("new.base_amount_minor := new.amount_minor"));
});

test("public payment RPC exposes instructions without exposing processor secrets", () => {
  const rpc = migration.slice(migration.indexOf("function public.public_payment_options"));
  assert.ok(rpc.includes("grant execute on function public.public_payment_options(uuid) to anon, authenticated"));
  assert.ok(rpc.includes("'zelle'"));
  assert.ok(rpc.includes("'check'"));
  assert.ok(!rpc.includes("encrypted_api_token"));
  assert.ok(!rpc.includes("encrypted_secret_token"));
});

test("Helcim requests preserve partner attribution and reject stale webhooks", () => {
  assert.ok(helcimAdapter.includes('headers["partner-token"] = partnerToken'));
  assert.ok(helcimAdapter.includes("Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000"));
  assert.ok(helcimAdapter.includes('replace(/^whsec_/, "")'));
});

test("Fee Saver gracefully falls back when a merchant is not eligible", () => {
  assert.ok(paymentServer.includes("let feeSaverApplied = feeSaver"));
  assert.ok(paymentServer.includes("feeSaver: false"));
  assert.ok(paymentServer.includes("fee_saver_requested: feeSaverApplied"));
});

test("online checkout sessions are reusable and protected from duplicate payment tabs", () => {
  assert.ok(migration.includes("idx_payment_requests_active_invoice_checkout"));
  assert.ok(migration.includes("idx_payment_requests_active_estimate_checkout"));
  assert.ok(paymentServer.includes("expireOldOnlineRequests"));
  assert.ok(paymentServer.includes("activeOnlineRequest"));
  assert.ok(paymentServer.includes("reused: true"));
  assert.ok(migration.includes("'created','action_required','processing'"));
  assert.ok(paymentServer.includes("reconcilePendingHelcimPayments"));
  assert.ok(customerComponent.includes("ACH payment is still processing"));
});

test("customer-visible payment errors have natural Hebrew and English copy", () => {
  assert.ok(customerComponent.includes("customerPaymentError"));
  assert.ok(customerComponent.includes("שירות התשלום אינו זמין כרגע"));
  assert.ok(customerComponent.includes("Payment service is temporarily unavailable"));
});

test("settled payment receipts are idempotent, bilingual, and retryable", () => {
  assert.ok(migration.includes("unique (payment_id, event_type, channel)"));
  assert.ok(paymentReceipts.includes("sendPaymentReceipt"));
  assert.ok(paymentReceipts.includes("retryFailedPaymentReceipts"));
  assert.ok(paymentReceipts.includes("התשלום בסך"));
  assert.ok(paymentReceipts.includes("We received your"));
  assert.ok(paymentServer.includes("sendPaymentReceipt"));
});
