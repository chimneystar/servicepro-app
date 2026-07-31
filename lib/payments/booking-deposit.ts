import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { addMinutes } from "@/lib/booking";
import { ensureEstimateSchedule, syncEstimateMilestones, estimateDepositRelease } from "@/lib/payments/deposits";
// @ts-ignore — pure logic, proven both ways in tests/deposits.test.mjs
import { bookingDepositMinor } from "@/lib/core/deposits.mjs";
// @ts-ignore — pure logic, proven both ways in tests/money.test.mjs
import { computeDocument } from "@/lib/core/money.mjs";

/**
 * Charging the online-booking deposit.
 *
 * THE GAP THIS CLOSES. `booking_settings.payment_mode` (none / fixed /
 * percentage / full) and `deposit_value` were saved by /settings/booking and
 * echoed back to the customer as a PROMISE — "If a deposit is required, a
 * secure payment link will be sent after confirmation" — and no link was ever
 * sent, because no deposit was ever calculated, requested or charged. A
 * business could configure a 50% deposit and take bookings for a year without
 * collecting a cent.
 *
 * HOW IT WORKS NOW. A booking that owes a deposit mints a real estimate for the
 * service, with `deposit_minor` set, and returns its public link. That link is
 * the payment screen that already exists and already works: Helcim card, Helcim
 * ACH, Zelle, mailed cheque, Fee Saver, receipts, reconciliation. No second
 * payment path was invented, so nothing here can drift from the one that is
 * exercised in production.
 *
 * THE HOLD. Until the deposit is settled, the booking stays in Leads awaiting
 * approval and NO JOB IS CREATED — which is the same place a booking already
 * lands when `approval_required` is on, so no screen sees an unfamiliar state.
 * When the deposit clears (checkout confirmation, ACH reconciliation, or a
 * confirmed Zelle/cheque), the job is created and the lead is marked won. If the
 * business has switched `ach_hold_until_settled` off, an ACH submission releases
 * immediately.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type BookingDeposit = { estimateId: string; publicToken: string; amountMinor: number } | null;

/**
 * Raise the deposit estimate for a booking, if one is owed.
 *
 * Returns null when the business asks for no deposit — the caller then follows
 * the unchanged booking path.
 */
export async function raiseBookingDeposit(admin: Admin, input: {
  organizationId: string;
  customerId: string;
  leadId: string;
  customerName: string;
  serviceName: string;
  servicePriceMinor: number;
  paymentMode: string;
  depositValue: number;
  taxRateBps: number;
  notes?: string | null;
}): Promise<BookingDeposit> {
  const depositMinor = bookingDepositMinor({
    mode: input.paymentMode,
    value: input.depositValue,
    servicePriceMinor: input.servicePriceMinor,
  });
  if (depositMinor <= 0) return null;

  // The estimate is the service at its listed price. Tax follows the
  // organisation's rate exactly as a staff-created estimate would, so the
  // customer is not quoted one total online and a different one on paper.
  const totals = computeDocument({
    items: [{ qtyMilli: 1000, unitPriceMinor: input.servicePriceMinor, taxable: true }],
    discountMinor: 0,
    taxRateBps: input.taxRateBps,
  });

  const { data: number, error: numberError } = await admin.rpc("allocate_document_number", {
    p_org: input.organizationId, p_kind: "estimate",
  });
  if (numberError || number === null) {
    console.error("[booking-deposit] could not allocate an estimate number:", numberError?.message);
    return null;
  }

  const now = new Date().toISOString();
  const { data: estimate, error } = await admin.from("estimates").insert({
    organization_id: input.organizationId,
    number,
    customer_id: input.customerId,
    status: "sent",
    discount_minor: 0,
    tax_rate_bps: input.taxRateBps,
    total_minor: totals.totalMinor,
    // Explicit, so the organisation-default trigger (migration 031) leaves it
    // alone: the booking deposit is the deposit for this document.
    deposit_minor: Math.min(depositMinor, totals.totalMinor),
    notes: input.notes ?? null,
    // The customer chose this service, this date and this price on the booking
    // form and pressed submit. That IS the approval, and requiring them to sign
    // the same thing again before the deposit screen unlocks would strand every
    // booking deposit behind a signature the customer has already given.
    signed_at: now,
    signer_name: input.customerName,
  }).select("id, public_token, deposit_minor, total_minor").single();
  if (error || !estimate) {
    console.error("[booking-deposit] could not create the deposit estimate:", error?.message);
    return null;
  }

  await admin.from("estimate_items").insert({
    organization_id: input.organizationId,
    estimate_id: estimate.id,
    title: input.serviceName,
    description: input.serviceName,
    qty_milli: 1000,
    unit_price_minor: input.servicePriceMinor,
    taxable: true,
    sort: 0,
  });

  await ensureEstimateSchedule(admin, {
    organizationId: input.organizationId,
    estimateId: estimate.id as string,
    totalMinor: Number(estimate.total_minor ?? totals.totalMinor),
    depositMinor: Number(estimate.deposit_minor ?? depositMinor),
  });

  await admin.from("leads").update({ deposit_estimate_id: estimate.id }).eq("id", input.leadId);

  return {
    estimateId: estimate.id as string,
    publicToken: String(estimate.public_token),
    amountMinor: Number(estimate.deposit_minor ?? depositMinor),
  };
}

/**
 * Release the work behind a booking deposit, if the money now allows it.
 *
 * Safe to call on every payment event and safe to call repeatedly: a lead that
 * already has a job (`status = 'won'`) is left alone, so a duplicate webhook
 * cannot produce a second job on the calendar.
 */
export async function releaseBookingDeposit(admin: Admin, estimateId: string): Promise<{ released: boolean; reason: string }> {
  const { data: lead } = await admin.from("leads")
    .select("id, organization_id, status, booking_status, booking_answers, converted_customer_id, service, notes, source, preferred_date, preferred_start_time, booking_service_id")
    .eq("deposit_estimate_id", estimateId)
    .maybeSingle();
  if (!lead) return { released: false, reason: "not_a_booking_deposit" };
  if (lead.status === "won") return { released: true, reason: "already_released" };

  const { data: estimate } = await admin.from("estimates")
    .select("id, organization_id, deposit_minor").eq("id", estimateId).maybeSingle();
  if (!estimate) return { released: false, reason: "estimate_missing" };

  const decision = await estimateDepositRelease(
    admin, estimate.organization_id as string, estimateId, Number(estimate.deposit_minor ?? 0),
  );
  if (!decision.released) return { released: false, reason: decision.reason };

  // A business that requires approval still gets to approve. The deposit clears
  // the money gate, not the human one: only a booking that would have been
  // auto-confirmed but for the deposit turns itself into a job.
  const answers = (lead.booking_answers ?? {}) as { auto_release_on_deposit?: boolean };
  if (answers.auto_release_on_deposit !== true) {
    await admin.from("leads").update({ booking_status: "confirmed" }).eq("id", lead.id);
    return { released: true, reason: "awaiting_approval" };
  }

  if (!lead.converted_customer_id || !lead.preferred_date || !lead.preferred_start_time) {
    // The deposit is settled but the booking cannot be turned into a job
    // automatically. It stays in Leads for a human — money is never lost, and
    // nothing is invented from missing data.
    await admin.from("leads").update({ booking_status: "confirmed" }).eq("id", lead.id);
    return { released: true, reason: "manual_scheduling_required" };
  }

  const { data: service } = lead.booking_service_id
    ? await admin.from("booking_services").select("duration_min, price_minor, name_en, book_as").eq("id", lead.booking_service_id).maybeSingle()
    : { data: null };

  // book_as = 'estimate' means this service was never meant to become a job.
  if (service?.book_as === "estimate") {
    await admin.from("leads").update({ booking_status: "confirmed" }).eq("id", lead.id);
    return { released: true, reason: "estimate_only_service" };
  }

  const durationMin = Number(service?.duration_min ?? 60);
  const start = String(lead.preferred_start_time).slice(0, 5);
  const { error: jobError } = await admin.from("jobs").insert({
    organization_id: lead.organization_id,
    customer_id: lead.converted_customer_id,
    assigned_to: null,
    service: service?.name_en ?? lead.service,
    status: "scheduled",
    price_minor: Number(service?.price_minor ?? 0),
    scheduled_date: lead.preferred_date,
    // end_date must be set: the dispatch board matches `scheduled_date <= day
    // AND (end_date >= day OR end_date IS NULL)`, so a null end_date makes the
    // job reappear on every future day forever.
    end_date: lead.preferred_date,
    start_time: start,
    end_time: addMinutes(start, durationMin),
    source: lead.source,
    notes: lead.notes,
  });
  if (jobError) {
    console.error("[booking-deposit] deposit cleared but the job could not be created:", jobError.message);
    await admin.from("leads").update({ booking_status: "confirmed" }).eq("id", lead.id);
    return { released: true, reason: "job_creation_failed" };
  }

  await admin.from("leads").update({ status: "won", booking_status: "confirmed" }).eq("id", lead.id);
  return { released: true, reason: decision.reason };
}

/**
 * The single hook every payment path calls once a payment is recorded.
 * Keeps milestones in step and releases deposit-gated work when it may be.
 */
export async function applyPaymentToDeposits(admin: Admin, payment: { organization_id: string; estimate_id: string | null }) {
  if (!payment.estimate_id) return;
  try {
    await syncEstimateMilestones(admin, payment.organization_id, payment.estimate_id);
    await releaseBookingDeposit(admin, payment.estimate_id);
  } catch (error) {
    // A payment that has been taken must never be lost because the release step
    // failed. The daily ACH reconciliation calls this again.
    console.error("[booking-deposit] deposit follow-up failed:", error instanceof Error ? error.message : String(error));
  }
}
