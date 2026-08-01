import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import type { TablesInsert } from "@/lib/supabase/database.types";
// @ts-ignore — pure logic, proven both ways in tests/schedules.test.mjs
import {
  planDepositSchedule,
  allocateMilestones,
  milestoneStatusForPayments,
} from "@/lib/core/schedules.mjs";
// @ts-ignore — pure logic, proven both ways in tests/ach-hold.test.mjs
import { settledMinor, pendingAchMinor, depositReleaseDecision } from "@/lib/core/ach-hold.mjs";
import * as backendData from "@/lib/data/backend";

/**
 * Payment schedules, milestones, and the ACH hold that governs when
 * deposit-gated work is released.
 *
 * WHAT WAS HERE BEFORE: nothing. `payment_schedules` and `payment_milestones`
 * have existed since migration 017 — composite tenant foreign keys, RLS
 * policies, indexes, an `updated_at` trigger, and a `milestone_id` column on
 * `payment_requests` so a checkout can be raised against a single milestone —
 * with ZERO application references. `ach_hold_until_settled` and the
 * `can_override_ach_holds` permission were likewise read by nothing.
 *
 * WHAT THIS IS: the minimum coherent slice. A deposit produces a real two-step
 * schedule (deposit, then final balance); the milestones advance from the
 * payments actually recorded; and an in-flight ACH deposit holds the work until
 * the bank clears it — or until someone with `can_override_ach_holds` decides
 * otherwise, on the record.
 *
 * WHAT THIS IS NOT: a milestone editor, an arbitrary N-step builder, or a
 * per-milestone customer checkout screen. See docs/REMEDIATION-PLAN.md 5.5.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type MilestoneRow = {
  id: string;
  label: string;
  status: string;
  amount_minor: number | null;
  percent_bps: number | null;
  calculation_type: string;
  sort: number;
};

function paymentsForEstimate(admin: Admin, organizationId: string, estimateId: string) {
  return backendData.listPaymentsForEstimate(admin, organizationId, estimateId);
}

/** Whether this organisation holds work until an ACH transfer clears. */
export async function achHoldEnabled(admin: Admin, organizationId: string): Promise<boolean> {
  const { data } = await admin
    .from("payment_settings")
    .select("ach_hold_until_settled")
    .eq("organization_id", organizationId)
    .maybeSingle();
  // The column is `not null default true`. A missing settings row means the
  // business has never configured payments, and the safe reading of "not
  // configured" is the cautious one: hold.
  return data ? !!data.ach_hold_until_settled : true;
}

/**
 * Create the deposit/balance schedule for an estimate, once.
 *
 * Idempotent: `uq_payment_schedules_estimate` (migration 031) makes a second
 * schedule impossible, and this returns the existing one instead of failing.
 */
export async function ensureEstimateSchedule(
  admin: Admin,
  input: {
    organizationId: string;
    estimateId: string;
    totalMinor: number;
    depositMinor: number;
    createdBy?: string | null;
  },
): Promise<string | null> {
  const plan = planDepositSchedule({
    totalMinor: input.totalMinor,
    depositMinor: input.depositMinor,
  });
  if (!plan) return null;

  const { data: existing } = await admin
    .from("payment_schedules")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("estimate_id", input.estimateId)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data: schedule, error } = await admin
    .from("payment_schedules")
    .insert({
      organization_id: input.organizationId,
      estimate_id: input.estimateId,
      name: plan.name,
      status: "active",
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();
  if (error || !schedule) {
    // A concurrent create won the unique index. Use theirs.
    const { data: raced } = await admin
      .from("payment_schedules")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("estimate_id", input.estimateId)
      .maybeSingle();
    return (raced?.id as string) ?? null;
  }

  const { amounts } = allocateMilestones(input.totalMinor, plan.milestones);
  // The shape `depositMilestonePlan` produces, stated with the same literal
  // unions the two CHECK constraints on `payment_milestones` enforce, rather
  // than as `string`. The plan is built in lib/core/deposits.mjs from a fixed
  // set of milestone kinds; if one of them ever names a value the table does
  // not allow, this is where it stops rather than at the insert.
  type PlannedMilestone = {
    label: string;
    calculation_type: TablesInsert<"payment_milestones">["calculation_type"];
    amount_minor: number | null;
    percent_bps: number | null;
    due_trigger: NonNullable<TablesInsert<"payment_milestones">["due_trigger"]>;
    sort: number;
  };
  // Annotated, so every column below is checked against the table rather than
  // inferred: without it a string literal like "due" widens to `string` and
  // the CHECK constraint on `status` becomes the only thing that would notice
  // a typo — at runtime, after the schedule row is already committed.
  const rows: TablesInsert<"payment_milestones">[] = (plan.milestones as PlannedMilestone[]).map(
    (milestone, index: number) => ({
      organization_id: input.organizationId,
      schedule_id: schedule.id,
      label: milestone.label,
      calculation_type: milestone.calculation_type,
      // `remaining` carries no stored amount on purpose: it is recomputed if the
      // estimate total changes, so the schedule cannot drift from the document.
      amount_minor: milestone.calculation_type === "remaining" ? null : amounts[index],
      percent_bps: milestone.percent_bps,
      due_trigger: milestone.due_trigger,
      sort: milestone.sort,
      status: milestone.calculation_type === "fixed" ? "due" : "pending",
    }),
  );
  const { error: milestoneError } = await admin.from("payment_milestones").insert(rows);
  if (milestoneError)
    console.error("[deposits] schedule created without milestones:", milestoneError.message);
  return schedule.id as string;
}

/**
 * Bring an estimate's milestones into step with the money actually recorded.
 *
 * Called after every payment event — checkout confirmation, ACH reconciliation,
 * manual confirmation — so `processing` genuinely means "submitted, not
 * cleared" rather than being a status nothing ever set.
 */
export async function syncEstimateMilestones(
  admin: Admin,
  organizationId: string,
  estimateId: string,
) {
  const { data: schedule } = await admin
    .from("payment_schedules")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("estimate_id", estimateId)
    .maybeSingle();
  if (!schedule) return;

  const milestones = await backendData.listPaymentMilestones(admin, organizationId, schedule.id);
  if (!milestones.length) return;

  const payments = await paymentsForEstimate(admin, organizationId, estimateId);
  const settled = settledMinor(payments);
  const pending = pendingAchMinor(payments);

  // Money is applied to milestones in order: the deposit is satisfied before
  // anything counts towards the balance. Applying it any other way would show a
  // deposit as unpaid while the customer had already paid it.
  let remainingSettled = settled;
  let remainingPending = pending;
  const now = new Date().toISOString();

  for (const milestone of milestones) {
    const required = Number(milestone.amount_minor ?? 0);
    if (milestone.calculation_type === "remaining" || required <= 0) continue;
    const appliedSettled = Math.min(remainingSettled, required);
    const appliedPending = Math.min(remainingPending, required - appliedSettled);
    remainingSettled -= appliedSettled;
    remainingPending -= appliedPending;

    const status = milestoneStatusForPayments({
      requiredMinor: required,
      settledMinor: appliedSettled,
      pendingMinor: appliedPending,
    });
    if (status === String(milestone.status)) continue;
    await admin
      .from("payment_milestones")
      .update({ status, paid_at: status === "paid" ? now : null })
      .eq("id", milestone.id);
  }
}

/**
 * Should the work behind this estimate's deposit be released?
 *
 * `overridden` is true when a milestone carries a recorded release by someone
 * holding `can_override_ach_holds`.
 */
export async function estimateDepositRelease(
  admin: Admin,
  organizationId: string,
  estimateId: string,
  depositMinor: number,
) {
  const [payments, holdEnabled, { data: schedule }] = await Promise.all([
    paymentsForEstimate(admin, organizationId, estimateId),
    achHoldEnabled(admin, organizationId),
    admin
      .from("payment_schedules")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("estimate_id", estimateId)
      .maybeSingle(),
  ]);

  let overridden = false;
  if (schedule) {
    const releases = await backendData.listReleasedMilestones(
      admin,
      organizationId,
      schedule.id,
      1,
    );
    overridden = releases.length > 0;
  }
  return depositReleaseDecision({ holdEnabled, requiredMinor: depositMinor, payments, overridden });
}

export type HeldDeposit = {
  milestoneId: string;
  estimateId: string;
  estimateNumber: number | null;
  customerName: string | null;
  amountMinor: number;
  label: string;
};

/** Deposits whose money has been sent but not cleared — the office review list. */
export async function heldDeposits(organizationId: string, limit = 20): Promise<HeldDeposit[]> {
  const admin = createAdminClient();
  const data = await backendData.listProcessingMilestonesForOrg(admin, organizationId, limit);
  if (!data.length) return [];

  // Two plain queries rather than a PostgREST embed: payment_milestones points
  // at payment_schedules through a COMPOSITE (schedule_id, organization_id)
  // foreign key, and an embed across a composite key is not something to assume
  // resolves the way a single-column one does.
  const schedules = await backendData.listPaymentSchedulesByIds(admin, organizationId, [
    ...new Set(data.map((row) => row.schedule_id as string)),
  ]);
  const estimateByScheduleId = new Map(
    schedules.map((row) => [row.id as string, row.estimate_id as string | null]),
  );

  const estimateIds = [
    ...new Set([...estimateByScheduleId.values()].filter((value): value is string => !!value)),
  ];
  if (!estimateIds.length) return [];

  const estimates = await backendData.listEstimatesForHeldDeposits(
    admin,
    organizationId,
    estimateIds,
  );
  const byId = new Map(estimates.map((estimate) => [estimate.id as string, estimate]));

  return data.flatMap((row) => {
    const estimateId = estimateByScheduleId.get(row.schedule_id as string);
    if (!estimateId) return [];
    const estimate = byId.get(estimateId) as
      { number?: number; customers?: { name?: string } | { name?: string }[] } | undefined;
    const customer = Array.isArray(estimate?.customers)
      ? estimate?.customers[0]
      : estimate?.customers;
    return [
      {
        milestoneId: row.id as string,
        estimateId,
        estimateNumber: estimate?.number ?? null,
        customerName: customer?.name ?? null,
        amountMinor: Number(row.amount_minor ?? 0),
        label: String(row.label ?? "Deposit"),
      },
    ];
  });
}

/** Owner, or a member the owner explicitly granted the override. */
export async function mayOverrideAchHold(profileId: string, role: string): Promise<boolean> {
  if (role === "owner") return true;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profile_payment_permissions")
    .select("can_override_ach_holds")
    .eq("profile_id", profileId)
    .maybeSingle();
  return !!data?.can_override_ach_holds;
}
