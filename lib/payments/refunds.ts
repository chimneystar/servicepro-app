import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PaymentError } from "@/lib/payments/server";
// @ts-ignore — pure logic, proven both ways in tests/refunds.test.mjs
import { refundableMinor, validateRefundAmount } from "@/lib/core/refunds.mjs";

/**
 * Refunds.
 *
 * `payments.refunded_minor` was read in fourteen places and written by nothing.
 * The `can_refund_payments` permission was assignable and granted nothing. So an
 * overcharge could not be corrected in-product at all: the books permanently
 * overstated revenue, and the only remedies were editing a payment row by hand
 * (which silently corrupts reporting and commission) or refunding outside the
 * system and leaving the records wrong.
 *
 * A refund is two things — money moving back, and a record of why. This module
 * owns both, and is explicit about which it can guarantee:
 *
 *   MANUAL  (Zelle, cheque, cash): the product cannot move the money. The
 *           business sends it back themselves and records that they did. Fully
 *           supported and exact.
 *   PROVIDER (Helcim card/ACH): the money is returned through the processor.
 *           The API call is implemented but has NEVER BEEN EXERCISED against
 *           Helcim — there are no sandbox credentials in this environment. It
 *           records `pending` first and only marks `completed` on a confirmed
 *           provider response, so a failure cannot leave the books claiming a
 *           refund that never happened.
 */

export type RefundResult = { ok: boolean; error?: string; refundId?: string };

/** Owner, or a member the owner explicitly granted the permission. */
async function assertMayRefund(profileId: string, role: string) {
  if (role === "owner") return;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profile_payment_permissions").select("can_refund_payments").eq("profile_id", profileId).maybeSingle();
  if (!data?.can_refund_payments) throw new PaymentError("You don't have permission to issue refunds", "forbidden", 403);
}

export async function refundPayment(input: {
  paymentId: string;
  amountMinor: number;
  reason: string;
  method?: "provider" | "manual";
}): Promise<RefundResult> {
  const profile = await requireProfile();

  try {
    await assertMayRefund(profile.id, profile.role);

    const reason = String(input.reason ?? "").trim().slice(0, 500);
    if (!reason) return { ok: false, error: "A reason is required — it is the only record of why money went back." };

    const admin = createAdminClient();

    // Org-scoped read: a payment id from another tenant resolves to nothing.
    const { data: payment } = await admin
      .from("payments")
      .select("id, organization_id, invoice_id, estimate_id, base_amount_minor, amount_minor, refunded_minor, normalized_status, provider, provider_transaction_id, method")
      .eq("id", input.paymentId)
      .eq("organization_id", profile.organization_id!)
      .maybeSingle();
    if (!payment) return { ok: false, error: "Payment not found" };

    // Only settled money can be given back. Refunding an in-flight ACH would
    // return money that never arrived.
    if (!["settled", "partially_refunded"].includes(String(payment.normalized_status ?? ""))) {
      return { ok: false, error: "This payment has not settled yet, so there is nothing to refund." };
    }

    const check = validateRefundAmount(payment, input.amountMinor) as
      { ok: true; amountMinor: number } | { ok: false; error: string };
    if (!check.ok) return { ok: false, error: check.error };
    const refundMinor: number = check.amountMinor;

    const isProvider = (input.method ?? (payment.provider === "helcim" ? "provider" : "manual")) === "provider";

    // Record BEFORE attempting the provider call, as pending. If the call fails
    // the row is marked failed and contributes nothing to refunded_minor — the
    // opposite order would credit a refund that never happened.
    const { data: refund, error: insertError } = await admin.from("payment_refunds").insert({
      organization_id: payment.organization_id,
      payment_id: payment.id,
      amount_minor: refundMinor,
      reason,
      method: isProvider ? "provider" : "manual",
      status: isProvider ? "pending" : "completed",
      provider: isProvider ? payment.provider : null,
      created_by: profile.id,
    }).select("id").single();

    if (insertError) {
      if (insertError.message?.includes("refund_exceeds_payment")) {
        return { ok: false, error: "That is more than remains on this payment." };
      }
      console.error("[refund] could not record refund:", insertError.message);
      return { ok: false, error: "We couldn't record that refund. Nothing was returned." };
    }

    if (isProvider) {
      try {
        const providerRefundId = await sendProviderRefund(payment, refundMinor);
        await admin.from("payment_refunds")
          .update({ status: "completed", provider_refund_id: providerRefundId, updated_at: new Date().toISOString() })
          .eq("id", refund.id);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await admin.from("payment_refunds")
          .update({ status: "failed", failure_reason: message.slice(0, 500), updated_at: new Date().toISOString() })
          .eq("id", refund.id);
        console.error(`[refund] provider refund failed for payment ${payment.id}:`, message);
        return { ok: false, error: "The card processor refused the refund. Nothing was returned; the attempt is recorded." };
      }
    }

    // The invoice may no longer be fully paid. refunded_minor is kept in step by
    // the database trigger, so this only has to re-evaluate the status.
    if (payment.invoice_id) await reopenInvoiceIfUnderpaid(admin, payment.invoice_id);

    return { ok: true, refundId: refund.id };
  } catch (error: unknown) {
    if (error instanceof PaymentError) return { ok: false, error: error.message };
    const message = error instanceof Error ? error.message : String(error);
    console.error("[refund] unexpected failure:", message);
    return { ok: false, error: "We couldn't complete that refund." };
  }
}

/**
 * Helcim refund. IMPLEMENTED BUT NEVER EXERCISED — no sandbox credentials exist
 * in this environment, so treat this as unproven until it has run once against
 * Helcim's test mode. It throws on any non-success, which is what keeps the
 * ledger honest: a failure marks the refund `failed` rather than completed.
 */
async function sendProviderRefund(payment: { provider: string | null; provider_transaction_id: string | null }, amountMinor: number): Promise<string> {
  if (payment.provider !== "helcim") throw new Error(`Refunds are not automated for provider "${payment.provider ?? "unknown"}"`);
  if (!payment.provider_transaction_id) throw new Error("This payment has no processor transaction to refund against");

  const token = process.env.HELCIM_PARTNER_TOKEN;
  if (!token) throw new Error("Helcim is not configured");

  const response = await fetch("https://api.helcim.com/v2/payment/refund", {
    method: "POST",
    headers: { "api-token": token, "content-type": "application/json" },
    body: JSON.stringify({
      originalTransactionId: payment.provider_transaction_id,
      amount: Number((amountMinor / 100).toFixed(2)),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.errors ?? payload?.message ?? `Helcim returned ${response.status}`));
  const id = payload?.transactionId ?? payload?.id;
  if (!id) throw new Error("Helcim accepted the refund but returned no transaction id");
  return String(id);
}

/** An invoice covered only by refunded money is not paid. */
async function reopenInvoiceIfUnderpaid(admin: ReturnType<typeof createAdminClient>, invoiceId: string) {
  const { data: invoice } = await admin.from("invoices").select("id, total_minor, estimate_id, status").eq("id", invoiceId).maybeSingle();
  if (!invoice) return;

  let query = admin.from("payments")
    .select("base_amount_minor, amount_minor, refunded_minor, normalized_status")
    .in("normalized_status", ["settled", "partially_refunded"]);
  query = invoice.estimate_id
    ? query.or(`invoice_id.eq.${invoiceId},estimate_id.eq.${invoice.estimate_id}`)
    : query.eq("invoice_id", invoiceId);

  const { data: payments } = await query;
  const stillCovered = refundableMinor(payments ?? []) >= Number(invoice.total_minor ?? 0);

  if (!stillCovered && invoice.status === "paid") {
    await admin.from("invoices").update({ status: "unpaid", paid_at: null, paid_online: false }).eq("id", invoiceId);
  }
}
