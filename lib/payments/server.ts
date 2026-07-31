import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPaymentSecret, encryptPaymentSecret } from "@/lib/payments/crypto";
import { sendPaymentReceipt } from "@/lib/payments/receipts";
import {
  initializeHelcimCheckout,
  getHelcimTransaction,
  normalizeHelcimTransaction,
  safeHelcimTransaction,
  verifyHelcimPaymentHash,
  type HelcimPaymentMethod,
  type HelcimTransactionData,
} from "@/lib/payments/helcim";
// @ts-ignore — shared pure ESM helpers are also exercised by Node's test runner.
import { creditedMinor, paymentAmountParts } from "@/lib/payments/core.mjs";

type PublicDocument = {
  id: string;
  organizationId: string;
  kind: "estimate_deposit" | "invoice";
  number: number;
  amountMinor: number;
  currency: string;
  signed: boolean;
  estimateId: string | null;
  invoiceId: string | null;
};

export class PaymentError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
  }
}

async function resolvePublicDocument(admin: ReturnType<typeof createAdminClient>, token: string): Promise<PublicDocument> {
  const { data: estimate } = await admin
    .from("estimates")
    .select("id, organization_id, number, deposit_minor, signed_at")
    .eq("public_token", token)
    .is("deleted_at", null)
    .maybeSingle();
  if (estimate) {
    const { data: organization } = await admin.from("organizations").select("currency").eq("id", estimate.organization_id).single();
    return {
      id: estimate.id,
      organizationId: estimate.organization_id,
      kind: "estimate_deposit",
      number: estimate.number,
      amountMinor: Number(estimate.deposit_minor ?? 0),
      currency: organization?.currency ?? "USD",
      signed: !!estimate.signed_at,
      estimateId: estimate.id,
      invoiceId: null,
    };
  }

  const { data: invoice } = await admin
    .from("invoices")
    .select("id, organization_id, number, total_minor, estimate_id")
    .eq("public_token", token)
    .is("deleted_at", null)
    .maybeSingle();
  if (!invoice) throw new PaymentError("Payment link not found", "not_found", 404);
  const { data: organization } = await admin.from("organizations").select("currency").eq("id", invoice.organization_id).single();
  return {
    id: invoice.id,
    organizationId: invoice.organization_id,
    kind: "invoice",
    number: invoice.number,
    amountMinor: Number(invoice.total_minor ?? 0),
    currency: organization?.currency ?? "USD",
    signed: true,
    // The estimate this invoice came from, when it was converted from one.
    // Deposits live on payments.estimate_id and MUST be credited against this
    // invoice, or the customer is billed for the deposit a second time.
    estimateId: invoice.estimate_id ?? null,
    invoiceId: invoice.id,
  };
}

// Balance arithmetic lives in lib/payments/core.mjs (creditedMinor) so that
// openBalance, refreshInvoicePaidState and the invoice screen cannot drift
// apart about what "paid" means — and so it is unit-tested rather than reasoned
// about. See tests/deposit-credit.test.mjs.

/**
 * What is still owed on this document, in minor units.
 *
 * For an INVOICE converted from an estimate this credits BOTH the payments
 * booked directly against the invoice AND any deposit paid against the
 * originating estimate. Previously only the former counted, so a paid deposit
 * was invisible here and the customer was asked for the full amount again.
 */
async function openBalance(admin: ReturnType<typeof createAdminClient>, document: PublicDocument) {
  let query = admin
    .from("payments")
    .select("base_amount_minor, refunded_minor, normalized_status")
    .eq("organization_id", document.organizationId)
    .in("normalized_status", ["settled", "partially_refunded"]);

  if (document.invoiceId && document.estimateId) {
    // Converted invoice: credit the invoice's own payments and the estimate's deposit.
    query = query.or(`invoice_id.eq.${document.invoiceId},estimate_id.eq.${document.estimateId}`);
  } else if (document.invoiceId) {
    query = query.eq("invoice_id", document.invoiceId);
  } else {
    query = query.eq("estimate_id", document.estimateId!);
  }

  const { data, error } = await query;
  if (error) throw new PaymentError("Payment balance is temporarily unavailable", "balance_unavailable", 503);
  return Math.max(0, document.amountMinor - creditedMinor(data));
}

function documentFields(document: PublicDocument) {
  return {
    estimate_id: document.estimateId,
    invoice_id: document.invoiceId,
    document_type: document.kind,
  };
}

async function expireOldOnlineRequests(admin: ReturnType<typeof createAdminClient>, document: PublicDocument) {
  let query = admin.from("payment_requests").update({ status: "expired" })
    .in("status", ["created", "action_required"])
    .lt("expires_at", new Date().toISOString())
    .overlaps("allowed_methods", ["card", "ach"]);
  query = document.invoiceId ? query.eq("invoice_id", document.invoiceId).is("milestone_id", null) : query.eq("estimate_id", document.estimateId!).is("milestone_id", null);
  await query;
}

async function activeOnlineRequest(admin: ReturnType<typeof createAdminClient>, document: PublicDocument) {
  let query = admin.from("payment_requests")
    .select("id, public_token, helcim_checkout_token, amount_minor, expires_at, status")
    .in("status", ["created", "action_required", "processing"])
    .overlaps("allowed_methods", ["card", "ach"]);
  query = document.invoiceId ? query.eq("invoice_id", document.invoiceId).is("milestone_id", null) : query.eq("estimate_id", document.estimateId!).is("milestone_id", null);
  const { data } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}

async function merchantToken(admin: ReturnType<typeof createAdminClient>, organizationId: string) {
  const [{ data: connection }, { data: secret }] = await Promise.all([
    admin.from("merchant_connections").select("status, card_enabled, ach_enabled, fee_saver_eligible").eq("organization_id", organizationId).maybeSingle(),
    admin.from("merchant_secrets").select("encrypted_api_token").eq("organization_id", organizationId).maybeSingle(),
  ]);
  if (connection?.status !== "approved" || !secret?.encrypted_api_token) {
    throw new PaymentError("Online card and bank payments are not connected yet", "merchant_not_ready", 409);
  }
  return { connection, apiToken: decryptPaymentSecret(secret.encrypted_api_token) };
}

export async function startHelcimCheckout(publicDocumentToken: string) {
  const admin = createAdminClient();
  const document = await resolvePublicDocument(admin, publicDocumentToken);
  if (document.kind === "estimate_deposit" && !document.signed) {
    throw new PaymentError("Approve and sign the estimate before paying the deposit", "signature_required", 409);
  }
  if (document.currency !== "USD") throw new PaymentError("Helcim payments currently require USD", "currency_not_supported", 409);

  const amountMinor = await openBalance(admin, document);
  if (amountMinor <= 0) throw new PaymentError("This document has no remaining payment due", "nothing_due", 409);

  const [{ data: settings }, merchant] = await Promise.all([
    admin.from("payment_settings").select("card_enabled, ach_enabled, fee_saver_enabled").eq("organization_id", document.organizationId).single(),
    merchantToken(admin, document.organizationId),
  ]);
  const card = !!settings?.card_enabled && !!merchant.connection.card_enabled;
  const ach = !!settings?.ach_enabled && !!merchant.connection.ach_enabled;
  if (!card && !ach) throw new PaymentError("Online payment methods are disabled", "methods_disabled", 409);

  const method: HelcimPaymentMethod = card && ach ? "cc-ach" : card ? "cc" : "ach";
  const feeSaver = card && ach && !!settings?.fee_saver_enabled && !!merchant.connection.fee_saver_eligible;
  await expireOldOnlineRequests(admin, document);
  const active = await activeOnlineRequest(admin, document);
  if (active?.status === "processing") {
    throw new PaymentError("A bank payment is still processing", "payment_pending", 409);
  }
  if (active && Number(active.amount_minor) === amountMinor && active.helcim_checkout_token && active.expires_at) {
    return { checkoutToken: active.helcim_checkout_token as string, requestToken: active.public_token as string, expiresAt: active.expires_at as string, reused: true };
  }
  if (active) throw new PaymentError("A payment session is already being prepared. Try again in a moment.", "session_busy", 409);

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { data: request, error: requestError } = await admin.from("payment_requests").insert({
    organization_id: document.organizationId,
    ...documentFields(document),
    amount_minor: amountMinor,
    currency: "USD",
    allowed_methods: [card ? "card" : null, ach ? "ach" : null].filter(Boolean),
    status: "created",
    fee_saver_requested: feeSaver,
    expires_at: expiresAt,
  }).select("id, public_token").single();
  if (requestError || !request) {
    const concurrent = await activeOnlineRequest(admin, document);
    if (concurrent?.helcim_checkout_token && concurrent.expires_at) {
      return { checkoutToken: concurrent.helcim_checkout_token as string, requestToken: concurrent.public_token as string, expiresAt: concurrent.expires_at as string, reused: true };
    }
    throw new PaymentError("Could not prepare this payment", "request_failed", 503);
  }

  try {
    let feeSaverApplied = feeSaver;
    let checkout;
    try {
      checkout = await initializeHelcimCheckout({ apiToken: merchant.apiToken, amountMinor, paymentMethod: method, feeSaver });
    } catch (error) {
      // Helcim requires Fee Saver to be enabled in the merchant account. If
      // that capability is unavailable, keep checkout working and let the
      // business absorb the processing fee for this payment.
      if (!feeSaver) throw error;
      checkout = await initializeHelcimCheckout({ apiToken: merchant.apiToken, amountMinor, paymentMethod: method, feeSaver: false });
      feeSaverApplied = false;
    }
    const encryptedSecret = encryptPaymentSecret(checkout.secretToken);
    const [{ error: updateError }, { error: secretError }] = await Promise.all([
      admin.from("payment_requests").update({
        helcim_checkout_token: checkout.checkoutToken,
        status: "action_required",
        fee_saver_requested: feeSaverApplied,
      }).eq("id", request.id),
      admin.from("payment_checkout_secrets").insert({
        payment_request_id: request.id,
        encrypted_secret_token: encryptedSecret,
        expires_at: expiresAt,
      }),
    ]);
    if (updateError || secretError) throw new Error("checkout persistence failed");
    return {
      checkoutToken: checkout.checkoutToken,
      requestToken: request.public_token as string,
      expiresAt,
    };
  } catch (error) {
    await admin.from("payment_requests").update({ status: "failed" }).eq("id", request.id);
    if (error instanceof PaymentError) throw error;
    throw new PaymentError("Helcim is temporarily unavailable. Try again shortly.", "provider_unavailable", 503);
  }
}

function parsePaymentEvent(eventMessage: unknown): { data: HelcimTransactionData; hash: string } {
  let parsed = eventMessage;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { throw new PaymentError("Invalid payment response", "invalid_response"); }
  }
  const outer = parsed as { data?: unknown; hash?: unknown; status?: unknown } | null;
  const candidate = outer?.data && typeof outer.data === "object" && "data" in (outer.data as object)
    ? outer.data as { data?: unknown; hash?: unknown }
    : outer;
  if (!candidate?.data || typeof candidate.data !== "object" || typeof candidate.hash !== "string") {
    throw new PaymentError("Invalid payment response", "invalid_response");
  }
  return { data: candidate.data as HelcimTransactionData, hash: candidate.hash };
}

export async function confirmHelcimCheckout(input: {
  requestToken: string;
  checkoutToken: string;
  eventMessage: unknown;
}) {
  const admin = createAdminClient();
  const { data: request } = await admin.from("payment_requests")
    .select("id, organization_id, estimate_id, invoice_id, amount_minor, currency, helcim_checkout_token, fee_saver_requested, expires_at, status")
    .eq("public_token", input.requestToken)
    .maybeSingle();
  if (!request || request.helcim_checkout_token !== input.checkoutToken) {
    throw new PaymentError("Payment session not found", "session_not_found", 404);
  }
  if (request.status === "paid") return { status: "settled" as const, alreadyProcessed: true };
  if (!request.expires_at || new Date(request.expires_at).getTime() < Date.now()) {
    throw new PaymentError("Payment session expired", "session_expired", 409);
  }
  const { data: secretRow } = await admin.from("payment_checkout_secrets")
    .select("encrypted_secret_token")
    .eq("payment_request_id", request.id)
    .maybeSingle();
  if (!secretRow) throw new PaymentError("Payment session cannot be verified", "verification_unavailable", 409);

  const payload = parsePaymentEvent(input.eventMessage);
  const secretToken = decryptPaymentSecret(secretRow.encrypted_secret_token);
  if (!verifyHelcimPaymentHash(payload.data, secretToken, payload.hash)) {
    throw new PaymentError("Payment response could not be verified", "bad_hash", 400);
  }

  const safe = safeHelcimTransaction(payload.data);
  if (!safe.transactionId) throw new PaymentError("Payment response has no transaction ID", "missing_transaction_id");
  if (safe.currency.toUpperCase() !== request.currency) throw new PaymentError("Payment currency does not match", "amount_mismatch");
  let surchargeMinor: number;
  try {
    ({ surchargeMinor } = paymentAmountParts(Number(request.amount_minor), safe.amount, !!request.fee_saver_requested));
  } catch { throw new PaymentError("Payment amount does not match", "amount_mismatch"); }

  const normalized = normalizeHelcimTransaction(payload.data);
  const { data: existing } = await admin.from("payments").select("id, normalized_status")
    .eq("organization_id", request.organization_id)
    .eq("provider", "helcim")
    .eq("provider_transaction_id", safe.transactionId)
    .maybeSingle();
  if (existing) return { status: existing.normalized_status as "settled" | "processing" | "failed", alreadyProcessed: true };

  const now = new Date().toISOString();
  const settled = normalized.status === "settled";
  const { data: recordedPayment, error: paymentError } = await admin.from("payments").insert({
    organization_id: request.organization_id,
    estimate_id: request.estimate_id,
    invoice_id: request.invoice_id,
    payment_request_id: request.id,
    amount_minor: request.amount_minor,
    base_amount_minor: request.amount_minor,
    surcharge_minor: surchargeMinor,
    currency: request.currency,
    provider: "helcim",
    provider_transaction_id: safe.transactionId,
    normalized_status: normalized.status,
    status: settled ? "paid" : normalized.status,
    method: normalized.method === "ach" ? "ACH" : "Credit card",
    reference: safe.transactionId,
    note: normalized.method === "ach" ? "Helcim ACH payment" : "Helcim card payment",
    submitted_at: now,
    settled_at: settled ? now : null,
    paid_at: settled ? now : null,
  }).select("id").single();
  if (paymentError || !recordedPayment) throw new PaymentError("Payment was received but could not be recorded", "record_failed", 503);

  await Promise.all([
    admin.from("payment_requests").update({ status: settled ? "paid" : normalized.status }).eq("id", request.id),
    admin.from("payment_checkout_secrets").delete().eq("payment_request_id", request.id),
    admin.from("payment_events").upsert({
      organization_id: request.organization_id,
      provider: "helcim",
      provider_event_id: `checkout:${safe.transactionId}`,
      event_type: "helcim_pay_response",
      payload_digest: payload.hash,
      sanitized_data: safe,
      status: "processed",
      processed_at: now,
    }, { onConflict: "provider,provider_event_id", ignoreDuplicates: true }),
  ]);

  if (settled && request.invoice_id) await refreshInvoicePaidState(admin, request.invoice_id);
  if (settled) { try { await sendPaymentReceipt(recordedPayment.id); } catch { /* payment remains settled even if notifications fail */ } }
  return { status: normalized.status, alreadyProcessed: false };
}

async function refreshInvoicePaidState(admin: ReturnType<typeof createAdminClient>, invoiceId: string) {
  const { data: invoice } = await admin
    .from("invoices").select("id, total_minor, estimate_id").eq("id", invoiceId).single();
  if (!invoice) return;

  // Must agree with openBalance: a deposit paid on the originating estimate
  // counts towards this invoice, otherwise an invoice fully covered by a
  // deposit plus a final payment would never flip to paid.
  let query = admin
    .from("payments")
    .select("base_amount_minor, refunded_minor, normalized_status")
    .in("normalized_status", ["settled", "partially_refunded"]);
  query = invoice.estimate_id
    ? query.or(`invoice_id.eq.${invoiceId},estimate_id.eq.${invoice.estimate_id}`)
    : query.eq("invoice_id", invoiceId);

  const { data: payments } = await query;
  if (creditedMinor(payments) >= Number(invoice.total_minor)) {
    await admin.from("invoices").update({ status: "paid", paid_online: true, paid_at: new Date().toISOString() }).eq("id", invoiceId);
  }
}

export async function submitManualPayment(input: {
  publicDocumentToken: string;
  method: "zelle" | "check";
  reference?: string;
  mailedOn?: string;
}) {
  const admin = createAdminClient();
  const document = await resolvePublicDocument(admin, input.publicDocumentToken);
  if (document.kind === "estimate_deposit" && !document.signed) {
    throw new PaymentError("Approve and sign the estimate before submitting payment", "signature_required", 409);
  }
  const amountMinor = await openBalance(admin, document);
  if (amountMinor <= 0) throw new PaymentError("This document has no remaining payment due", "nothing_due", 409);
  const { data: settings } = await admin.from("payment_settings")
    .select("zelle_enabled, check_enabled")
    .eq("organization_id", document.organizationId)
    .single();
  const enabled = input.method === "zelle" ? settings?.zelle_enabled : settings?.check_enabled;
  if (!enabled) throw new PaymentError("That payment method is not available", "method_disabled", 409);

  let existingRequestQuery = admin.from("payment_requests").select("id")
    .eq("organization_id", document.organizationId)
    .contains("allowed_methods", [input.method])
    .in("status", ["submitted", "processing"]);
  existingRequestQuery = document.invoiceId
    ? existingRequestQuery.eq("invoice_id", document.invoiceId)
    : existingRequestQuery.eq("estimate_id", document.estimateId!);
  const { data: existingRequests } = await existingRequestQuery.limit(1);
  if (existingRequests?.[0]) {
    const { data: existingSubmission } = await admin.from("manual_payment_submissions").select("id, status")
      .eq("payment_request_id", existingRequests[0].id).eq("status", "verification_pending").maybeSingle();
    if (existingSubmission) return { id: existingSubmission.id as string, status: "verification_pending" as const, existing: true };
  }

  const { data: request, error: requestError } = await admin.from("payment_requests").insert({
    organization_id: document.organizationId,
    ...documentFields(document),
    amount_minor: amountMinor,
    currency: document.currency,
    allowed_methods: [input.method],
    status: "submitted",
  }).select("id").single();
  if (requestError || !request) throw new PaymentError("Could not record the payment submission", "request_failed", 503);

  const reference = input.reference?.trim().slice(0, 120) || null;
  const mailedOn = input.method === "check" && /^\d{4}-\d{2}-\d{2}$/.test(input.mailedOn ?? "") ? input.mailedOn : null;
  const { data: submission, error } = await admin.from("manual_payment_submissions").insert({
    organization_id: document.organizationId,
    payment_request_id: request.id,
    method: input.method,
    amount_minor: amountMinor,
    reference,
    mailed_on: mailedOn,
  }).select("id").single();
  if (error || !submission) throw new PaymentError("Could not record the payment submission", "submission_failed", 503);
  return { id: submission.id as string, status: "verification_pending" as const, existing: false };
}

export async function reconcileHelcimTransaction(transactionId: string) {
  const admin = createAdminClient();
  const { data: payment } = await admin.from("payments")
    .select("id, organization_id, invoice_id, payment_request_id, method, normalized_status")
    .eq("provider", "helcim")
    .eq("provider_transaction_id", transactionId)
    .maybeSingle();
  if (!payment) return null;

  const merchant = await merchantToken(admin, payment.organization_id);
  const method = String(payment.method).toUpperCase() === "ACH" ? "ach" : "card";
  const transaction = await getHelcimTransaction(merchant.apiToken, transactionId, method);
  const normalized = normalizeHelcimTransaction(transaction);
  const safe = safeHelcimTransaction(transaction);
  const now = new Date().toISOString();
  const settled = normalized.status === "settled";

  await admin.from("payments").update({
    normalized_status: normalized.status,
    status: settled ? "paid" : normalized.status,
    settled_at: settled ? now : null,
    paid_at: settled ? now : null,
  }).eq("id", payment.id);
  if (payment.payment_request_id) {
    await admin.from("payment_requests").update({ status: settled ? "paid" : normalized.status }).eq("id", payment.payment_request_id);
  }
  if (settled && payment.invoice_id) await refreshInvoicePaidState(admin, payment.invoice_id);
  if (settled) { try { await sendPaymentReceipt(payment.id); } catch { /* reconciliation must not fail on notification delivery */ } }
  return { organizationId: payment.organization_id as string, status: normalized.status, transaction: safe };
}

export async function reconcilePendingHelcimPayments(limit = 50) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("payments")
    .select("provider_transaction_id")
    .eq("provider", "helcim")
    .eq("normalized_status", "processing")
    .order("submitted_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)));
  if (error) throw error;

  let settled = 0; let processing = 0; let failed = 0;
  for (const payment of data ?? []) {
    if (!payment.provider_transaction_id) continue;
    try {
      const result = await reconcileHelcimTransaction(payment.provider_transaction_id);
      if (result?.status === "settled") settled += 1;
      else if (result?.status === "failed") failed += 1;
      else processing += 1;
    } catch { processing += 1; }
  }
  return { checked: data?.length ?? 0, settled, processing, failed };
}
