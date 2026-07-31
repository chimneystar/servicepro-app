// =====================================================================
//  schedules.mjs — payment schedules and milestones.
//
//  THE GAP THIS CLOSES. `payment_schedules` and `payment_milestones` have
//  existed since migration 017 with composite tenant foreign keys, RLS policies,
//  indexes, an `updated_at` trigger, and a `milestone_id` column on
//  `payment_requests` that lets a checkout be raised against a single
//  milestone — and there are ZERO application references to any of it. Two
//  fully specified tables that no line of code has ever inserted into, read, or
//  updated.
//
//  WHAT THIS MODULE IS, AND WHAT IT IS NOT. It is the arithmetic of splitting a
//  document total into milestones that add up EXACTLY — no more, no less, with
//  the rounding remainder deliberately placed rather than lost. It is not the
//  whole feature: there is no milestone editor, no arbitrary schedule builder,
//  and no per-milestone customer checkout screen. See docs/REMEDIATION-PLAN.md
//  item 5.5 for exactly what remains.
//
//  Tests: tests/schedules.test.mjs
// =====================================================================

/** Round a non-negative integer division half-up, with integer arithmetic only. */
function divRoundHalfUp(numerator, denominator) {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new Error("divRoundHalfUp expects integers with denominator > 0");
  }
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

const whole = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
};

export const CALCULATION_TYPES = ["percent", "fixed", "remaining"];
export const MILESTONE_STATUSES = ["pending", "due", "processing", "paid", "waived", "cancelled"];

/**
 * The standard two-step schedule: a deposit up front, the balance at the end.
 *
 * Returns `null` when no deposit is being asked for — a schedule with a single
 * "pay it all" milestone is noise, and writing one would make every estimate in
 * the business carry a row that says nothing.
 *
 * The final milestone is `remaining`, not a second fixed amount, so that
 * editing the estimate total afterwards cannot leave the schedule adding up to
 * the wrong number.
 */
export function planDepositSchedule({ totalMinor, depositMinor }) {
  const total = whole(totalMinor);
  const deposit = Math.min(whole(depositMinor), total);
  if (total <= 0 || deposit <= 0) return null;

  const milestones = [
    {
      label: "Deposit",
      calculation_type: "fixed",
      amount_minor: deposit,
      percent_bps: null,
      due_trigger: "on_approval",
      sort: 0,
    },
  ];
  if (deposit < total) {
    milestones.push({
      label: "Final balance",
      calculation_type: "remaining",
      amount_minor: null,
      percent_bps: null,
      due_trigger: "on_completion",
      sort: 1,
    });
  }
  return { name: "Deposit and final payment", milestones };
}

/**
 * Resolve every milestone to an exact integer amount.
 *
 * Rules, all of which exist because the alternative silently mis-bills:
 *   * `fixed`     — taken as written.
 *   * `percent`   — percent_bps of the total, rounded half-up.
 *   * `remaining` — whatever is left. If several are marked remaining, the
 *                   remainder is split evenly and the odd cents go to the
 *                   earliest, so the parts still sum to the total exactly.
 *   * The fixed and percent parts are clamped so they can never exceed the
 *     total; the overflow is reported, not swallowed.
 *
 * Returns `{ amounts, allocatedMinor, unallocatedMinor, overAllocatedMinor }`.
 * `unallocatedMinor > 0` means the schedule bills LESS than the document, which
 * is a real condition the caller must decide about — not something to hide.
 */
export function allocateMilestones(totalMinor, milestones) {
  const total = whole(totalMinor);
  const rows = Array.isArray(milestones) ? milestones : [];
  const amounts = new Array(rows.length).fill(0);

  let claimed = 0;
  const remainingIndexes = [];
  rows.forEach((row, index) => {
    const type = String(row?.calculation_type ?? "");
    if (type === "remaining") {
      remainingIndexes.push(index);
      return;
    }
    let value = 0;
    if (type === "percent") {
      const bps = Math.min(whole(row?.percent_bps), 10000);
      value = divRoundHalfUp(total * bps, 10000);
    } else if (type === "fixed") {
      value = whole(row?.amount_minor);
    }
    amounts[index] = value;
    claimed += value;
  });

  const overAllocatedMinor = Math.max(0, claimed - total);
  if (overAllocatedMinor > 0) {
    // Clamp from the last claiming milestone backwards, so the deposit the
    // customer already agreed to is the last thing to be reduced.
    let excess = overAllocatedMinor;
    for (let index = rows.length - 1; index >= 0 && excess > 0; index -= 1) {
      if (remainingIndexes.includes(index)) continue;
      const take = Math.min(amounts[index], excess);
      amounts[index] -= take;
      excess -= take;
    }
    claimed = total;
  }

  let leftover = Math.max(0, total - claimed);
  if (remainingIndexes.length > 0) {
    const share = Math.floor(leftover / remainingIndexes.length);
    let odd = leftover - share * remainingIndexes.length;
    for (const index of remainingIndexes) {
      amounts[index] = share + (odd > 0 ? 1 : 0);
      if (odd > 0) odd -= 1;
    }
    leftover = 0;
  }

  const allocatedMinor = amounts.reduce((sum, value) => sum + value, 0);
  return {
    amounts,
    allocatedMinor,
    unallocatedMinor: Math.max(0, total - allocatedMinor),
    overAllocatedMinor,
  };
}

/**
 * The status a milestone should carry given the money seen against it.
 *
 * `processing` is the state the milestone tables always had a slot for and
 * nothing ever used: money submitted, not yet cleared. It is the difference
 * between "the customer has paid" and "the customer has started paying", and it
 * is what the ACH hold acts on.
 */
export function milestoneStatusForPayments({ requiredMinor, settledMinor, pendingMinor }) {
  const required = whole(requiredMinor);
  const settled = whole(settledMinor);
  const pending = whole(pendingMinor);
  if (required <= 0) return "waived";
  if (settled >= required) return "paid";
  if (settled + pending >= required) return "processing";
  return "due";
}
