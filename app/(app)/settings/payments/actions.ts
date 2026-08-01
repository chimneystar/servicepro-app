"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { helcimRegistrationUrl } from "@/lib/payments/helcim";
import { sendPaymentReceipt } from "@/lib/payments/receipts";
import { getLocale } from "@/lib/locale-server";
import { isOneOf } from "@/lib/validation";
import { mayOverrideAchHold } from "@/lib/payments/deposits";
import { applyPaymentToDeposits, releaseBookingDeposit } from "@/lib/payments/booking-deposit";
// @ts-ignore — this shared money module is plain ESM with runtime tests.
import { parseAmountToMinor } from "@/lib/core/money.mjs";
// @ts-ignore — pure logic, proven both ways in tests/tips.test.mjs
import { sanitizeTipPercents } from "@/lib/core/tips.mjs";
import * as reporting from "@/lib/data/reporting";

export type PaymentSettingsResult = { ok: boolean; error?: string };

const enabled = (formData: FormData, key: string) => formData.get(key) === "on";
const text = (formData: FormData, key: string, max = 500) =>
  String(formData.get(key) ?? "")
    .trim()
    .slice(0, max) || null;

export async function updatePaymentSettings(
  _previous: PaymentSettingsResult,
  formData: FormData,
): Promise<PaymentSettingsResult> {
  const profile = await requireProfile();
  const he = (await getLocale()) === "he";
  if (profile.role !== "owner")
    return {
      ok: false,
      error: he
        ? "רק בעלי העסק יכולים לשנות את הגדרות התשלום."
        : "Only the owner can change payment settings.",
    };

  const depositType = String(formData.get("default_deposit_type") ?? "none");
  if (!isOneOf(["none", "percent", "fixed"], depositType)) {
    return { ok: false, error: he ? "יש לבחור סוג מקדמה תקין." : "Choose a valid deposit type." };
  }
  const depositPercent = Math.max(0, Math.min(100, Number(formData.get("deposit_percent") ?? 0)));
  let depositFixedMinor = 0;
  try {
    const fixedValue = String(formData.get("deposit_fixed") ?? "0").trim() || "0";
    depositFixedMinor = parseAmountToMinor(fixedValue);
  } catch {
    return {
      ok: false,
      error: he ? "יש להזין סכום מקדמה תקין." : "Enter a valid fixed deposit amount.",
    };
  }

  const zelleEnabled = enabled(formData, "zelle_enabled");
  const zelleEmail = text(formData, "zelle_email", 160);
  const zellePhone = text(formData, "zelle_phone", 40);
  if (zelleEnabled && !zelleEmail && !zellePhone)
    return {
      ok: false,
      error: he
        ? "יש להזין אימייל או מספר נייד שמחובר ל־Zelle."
        : "Add the email or mobile number enrolled with Zelle.",
    };

  const checkEnabled = enabled(formData, "check_enabled");
  const checkPayee = text(formData, "check_payee", 160);
  const checkAddress = text(formData, "check_address", 240);
  if (checkEnabled && (!checkPayee || !checkAddress))
    return {
      ok: false,
      error: he
        ? "יש להזין שם מוטב וכתובת למשלוח הצ׳ק."
        : "Add the check payee and mailing address.",
    };

  // Suggested tip percentages now reach a customer, so they are cleaned by the
  // same function the payment screen uses: integers 1..100, de-duplicated, at
  // most four. The previous filter accepted 0 as a "tip", which renders as a
  // 0% button that charges nothing and looks broken.
  const tips = sanitizeTipPercents(String(formData.get("tip_options") ?? "15,20,25")) as number[];

  const supabase = await createClient();

  // Saved payment methods: the switch is presented as unavailable and its
  // control is disabled, so the browser does not submit it. Reading the form
  // here would silently rewrite the stored preference to false on every save.
  // The value is preserved untouched until card tokenisation actually exists.
  // See docs/REMEDIATION-PLAN.md item 5.3.
  const { data: current } = await supabase
    .from("payment_settings")
    .select("save_methods_enabled")
    .eq("organization_id", profile.organization_id!)
    .maybeSingle();

  const { error } = await supabase.from("payment_settings").upsert(
    {
      organization_id: profile.organization_id,
      card_enabled: enabled(formData, "card_enabled"),
      ach_enabled: enabled(formData, "ach_enabled"),
      zelle_enabled: zelleEnabled,
      check_enabled: checkEnabled,
      fee_saver_enabled: enabled(formData, "fee_saver_enabled"),
      ach_hold_until_settled: enabled(formData, "ach_hold_until_settled"),
      save_methods_enabled: current?.save_methods_enabled ?? true,
      tips_enabled: enabled(formData, "tips_enabled"),
      suggested_tip_percents: tips,
      default_deposit_type: depositType,
      default_deposit_bps: Math.round(depositPercent * 100),
      default_deposit_minor: depositFixedMinor,
      zelle_recipient_name: text(formData, "zelle_recipient_name", 160),
      zelle_email: zelleEmail,
      zelle_phone: zellePhone,
      zelle_qr_url: text(formData, "zelle_qr_url", 500),
      zelle_instructions: text(formData, "zelle_instructions", 1000),
      check_payee: checkPayee,
      check_address: checkAddress,
      check_city_state_zip: text(formData, "check_city_state_zip", 200),
      check_memo_instructions: text(formData, "check_memo_instructions", 500),
      receipt_email_enabled: enabled(formData, "receipt_email_enabled"),
      receipt_sms_enabled: enabled(formData, "receipt_sms_enabled"),
    },
    { onConflict: "organization_id" },
  );
  if (error)
    return {
      ok: false,
      error: he
        ? "לא הצלחנו לשמור את ההגדרות כרגע. נסו שוב בעוד רגע."
        : "We couldn't save the settings right now. Please try again.",
    };
  revalidatePath("/settings/payments");
  return { ok: true };
}

export async function beginHelcimOnboarding() {
  const profile = await requireProfile();
  if (profile.role !== "owner") redirect("/settings/payments");
  const url = helcimRegistrationUrl(profile.organization_id!);
  if (!url) redirect("/settings/payments?helcim=partner-pending");
  const admin = createAdminClient();
  await admin.from("merchant_connections").upsert(
    {
      organization_id: profile.organization_id,
      connected_account_id: profile.organization_id,
      status: "application_started",
      onboarding_started_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  redirect(url);
}

export async function reviewManualPayment(formData: FormData) {
  const profile = await requireProfile();
  const submissionId = String(formData.get("submission_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const reason =
    String(formData.get("reason") ?? "")
      .trim()
      .slice(0, 500) || null;
  if (!submissionId || !["confirm", "reject"].includes(decision)) return;

  let allowed = profile.role === "owner";
  if (!allowed && profile.role === "office") {
    const userClient = await createClient();
    const { data } = await userClient
      .from("profile_payment_permissions")
      .select("can_confirm_manual_payments")
      .eq("profile_id", profile.id)
      .maybeSingle();
    allowed = !!data?.can_confirm_manual_payments;
  }
  if (!allowed) return;

  const admin = createAdminClient();
  const { data: submission } = await admin
    .from("manual_payment_submissions")
    .select(
      "id, organization_id, payment_request_id, method, amount_minor, status, reference, submitted_at",
    )
    .eq("id", submissionId)
    .eq("organization_id", profile.organization_id!)
    .maybeSingle();
  if (!submission || submission.status !== "verification_pending") return;
  const { data: request } = await admin
    .from("payment_requests")
    .select("id, estimate_id, invoice_id, currency")
    .eq("id", submission.payment_request_id)
    .eq("organization_id", profile.organization_id!)
    .maybeSingle();
  if (!request) return;

  const now = new Date().toISOString();
  if (decision === "reject") {
    await Promise.all([
      admin
        .from("manual_payment_submissions")
        .update({
          status: "rejected",
          confirmed_by: profile.id,
          confirmed_at: now,
          decision_reason: reason,
        })
        .eq("id", submission.id),
      admin.from("payment_requests").update({ status: "failed" }).eq("id", request.id),
      admin.from("audit_log").insert({
        organization_id: profile.organization_id,
        table_name: "manual_payment_submissions",
        row_id: submission.id,
        action: "payment_rejected",
        actor: profile.id,
        new_data: { reason },
      }),
    ]);
    revalidatePath("/settings/payments");
    return;
  }

  const { data: recordedPayment, error: paymentError } = await admin
    .from("payments")
    .insert({
      organization_id: profile.organization_id,
      estimate_id: request.estimate_id,
      invoice_id: request.invoice_id,
      payment_request_id: request.id,
      amount_minor: submission.amount_minor,
      base_amount_minor: submission.amount_minor,
      currency: request.currency,
      provider: submission.method,
      provider_transaction_id: `manual:${submission.id}`,
      normalized_status: "settled",
      status: "paid",
      method: submission.method === "zelle" ? "Zelle" : "Check",
      reference: submission.reference,
      submitted_at: submission.submitted_at,
      settled_at: now,
      paid_at: now,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (paymentError || !recordedPayment) return;
  await Promise.all([
    admin
      .from("manual_payment_submissions")
      .update({
        status: "confirmed",
        confirmed_by: profile.id,
        confirmed_at: now,
        decision_reason: reason,
      })
      .eq("id", submission.id),
    admin.from("payment_requests").update({ status: "paid" }).eq("id", request.id),
    admin.from("audit_log").insert({
      organization_id: profile.organization_id,
      table_name: "manual_payment_submissions",
      row_id: submission.id,
      action: "payment_confirmed",
      actor: profile.id,
      new_data: { method: submission.method, amount_minor: submission.amount_minor },
    }),
  ]);

  if (request.invoice_id) {
    // Best-effort: this only decides whether the invoice is ALSO marked paid.
    // The payment itself is already recorded above, so a read failure here
    // must not surface as a crashed action — it just leaves the invoice's own
    // status for a later payment or a manual update to settle.
    let invoice: { total_minor: number } | null = null;
    let paid = 0;
    try {
      const [invoiceResult, payments] = await Promise.all([
        admin.from("invoices").select("total_minor").eq("id", request.invoice_id).single(),
        reporting.listSettledPaymentAmountsForInvoice(admin, request.invoice_id),
      ]);
      invoice = invoiceResult.data;
      paid = payments.reduce(
        (sum, payment) =>
          sum +
          Math.max(0, Number(payment.base_amount_minor) - Number(payment.refunded_minor ?? 0)),
        0,
      );
    } catch {
      /* leave invoice/paid at their defaults — see comment above */
    }
    if (invoice && paid >= Number(invoice.total_minor)) {
      await admin
        .from("invoices")
        .update({ status: "paid", paid_at: now })
        .eq("id", request.invoice_id);
    }
  }
  // A Zelle or cheque deposit is money in the door just as much as a card is:
  // it must advance the deposit milestone and release deposit-gated work.
  await applyPaymentToDeposits(admin, {
    organization_id: profile.organization_id!,
    estimate_id: request.estimate_id,
  });

  try {
    await sendPaymentReceipt(recordedPayment.id);
  } catch {
    /* confirmation stays successful if a provider is unavailable */
  }
  revalidatePath("/settings/payments");
  revalidatePath("/invoices");
}

/**
 * Release work that is waiting on an ACH transfer to clear.
 *
 * `can_override_ach_holds` has been assignable on the team screen since
 * migration 017 and granted nothing, because nothing held anything. It grants
 * this: a named person deciding, on the record, that a submitted-but-uncleared
 * bank transfer is good enough to start the work. The transfer can still be
 * returned, which is exactly why the decision has an author and a reason.
 */
export async function releaseAchHold(formData: FormData): Promise<void> {
  const profile = await requireProfile();
  const milestoneId = String(formData.get("milestone_id") ?? "");
  const reason =
    String(formData.get("reason") ?? "")
      .trim()
      .slice(0, 500) || null;
  if (!milestoneId) return;
  if (!(await mayOverrideAchHold(profile.id, profile.role))) return;

  const admin = createAdminClient();
  const { data: milestone } = await admin
    .from("payment_milestones")
    .select("id, organization_id, schedule_id, status, released_at")
    .eq("id", milestoneId)
    .eq("organization_id", profile.organization_id!)
    .maybeSingle();
  if (!milestone || milestone.released_at) return;
  // Only an in-flight deposit can be released early. A milestone nobody has
  // paid at all has nothing to override.
  if (milestone.status !== "processing") return;

  const now = new Date().toISOString();
  await admin
    .from("payment_milestones")
    .update({ released_by: profile.id, released_at: now, release_reason: reason })
    .eq("id", milestone.id);
  await admin.from("audit_log").insert({
    organization_id: profile.organization_id,
    table_name: "payment_milestones",
    row_id: milestone.id,
    action: "ach_hold_released",
    actor: profile.id,
    new_data: { reason },
  });

  const { data: schedule } = await admin
    .from("payment_schedules")
    .select("estimate_id")
    .eq("id", milestone.schedule_id)
    .eq("organization_id", profile.organization_id!)
    .maybeSingle();
  if (schedule?.estimate_id) await releaseBookingDeposit(admin, schedule.estimate_id as string);

  revalidatePath("/settings/payments");
}
