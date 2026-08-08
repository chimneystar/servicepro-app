// =====================================================================
//  tips.mjs — what a tip is, and what a tip is NOT.
//
//  THE GAP THIS CLOSES. `payment_settings.tips_enabled` and
//  `suggested_tip_percents` were stored and editable, and `payments.tip_minor`
//  was READ when a receipt was rendered — by a column nothing had ever written.
//  A business could switch tipping on, tell its technicians tips were enabled,
//  and no customer was ever offered one.
//
//  HOW A TIP FLOWS, and why it is decided here rather than at the call site:
//
//   * A tip is NOT part of the invoice balance. It is charged ON TOP of what is
//     owed, and it does not reduce it. Paying a $500 invoice with a $50 tip
//     leaves the invoice fully paid at $500 and the customer charged $550 — not
//     an invoice $50 overpaid, and never an invoice $50 short.
//
//   * A tip is NOT revenue. Every collected-money reader in this product
//     (creditedMinor, collectedMinor, refundableMinor, the invoice screen, the
//     commission report) sums `base_amount_minor - refunded_minor`. Recording
//     the tip in its own `tip_minor` column and keeping `base_amount_minor` at
//     the balance means the tip is automatically excluded from revenue, from
//     margin, and from the technician's commission base. That is deliberate:
//     tipped money belongs to the person who earned it, and counting it as
//     business revenue would inflate margin and misstate the tax position.
//
//   * A tip is NOT refundable as the business's money. `guard_refund_amount()`
//     in db/030_refunds.sql caps a refund at `base_amount_minor`, which excludes
//     the tip for the same reason it excludes the Fee Saver surcharge: the
//     business never held it. Returning a tip is a conversation, not a button.
//
//  Tests: tests/tips.test.mjs
// =====================================================================

/** Round a non-negative integer division half-up, with integer arithmetic only. */
function divRoundHalfUp(numerator, denominator) {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new Error("divRoundHalfUp expects integers with denominator > 0");
  }
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

/** The percentages a business may offer. Anything else is not a tip choice. */
export const MAX_TIP_PERCENT = 100;

/**
 * Clean a stored/typed list of suggested percentages.
 * Returns integers in 1..100, de-duplicated, ascending, at most four — the
 * database column is `integer[]` with no constraint, so a hand-edited row of
 * junk must not reach the customer's screen.
 */
export function sanitizeTipPercents(input, fallback = [15, 20, 25]) {
  const list = Array.isArray(input) ? input : String(input ?? "").split(",");
  const seen = new Set();
  for (const raw of list) {
    const value = typeof raw === "number" ? raw : Number.parseInt(String(raw).trim(), 10);
    if (!Number.isInteger(value) || value <= 0 || value > MAX_TIP_PERCENT) continue;
    seen.add(value);
  }
  const cleaned = [...seen].sort((a, b) => a - b).slice(0, 4);
  return cleaned.length ? cleaned : [...fallback];
}

/** A percentage tip on a balance, in integer minor units, rounded half-up. */
export function tipMinorFromPercent(balanceMinor, percent) {
  const balance = Number(balanceMinor);
  const pct = Number(percent);
  if (!Number.isInteger(balance) || balance < 0)
    throw new Error("balance must be a non-negative integer");
  if (!Number.isInteger(pct) || pct < 0 || pct > MAX_TIP_PERCENT)
    throw new Error("percent out of range");
  return divRoundHalfUp(balance * pct, 100);
}

/**
 * Resolve the tip the customer actually asked for.
 *
 * Never throws: the caller is a public payment endpoint and must be able to
 * explain the refusal rather than return a stack trace.
 *
 * `customMinor` is already integer minor units — the caller parses the typed
 * string with parseAmountToMinor, so "12.345" and "abc" are rejected there
 * rather than becoming NaN here.
 */
export function resolveTip({ enabled, balanceMinor, percent, customMinor }) {
  const balance = Number(balanceMinor);
  if (!Number.isInteger(balance) || balance <= 0) {
    return { ok: false, error: "There is no balance to tip on." };
  }

  const asked =
    percent !== undefined && percent !== null && percent !== ""
      ? { kind: "percent", value: Number(percent) }
      : customMinor !== undefined && customMinor !== null
        ? { kind: "custom", value: Number(customMinor) }
        : null;

  // No tip asked for is the normal case, and is fine whether or not the
  // business has tipping switched on.
  if (asked === null || asked.value === 0) return { ok: true, tipMinor: 0 };

  if (!enabled) {
    // A tip on a business that has not enabled tipping must be refused rather
    // than silently dropped: silently charging the balance while the customer
    // believed they had added a tip is the worse of the two failures.
    return { ok: false, error: "This business is not accepting tips." };
  }

  if (asked.kind === "percent") {
    if (!Number.isInteger(asked.value) || asked.value < 0 || asked.value > MAX_TIP_PERCENT) {
      return { ok: false, error: "Choose a tip between 0% and 100%." };
    }
    return { ok: true, tipMinor: tipMinorFromPercent(balance, asked.value) };
  }

  if (!Number.isInteger(asked.value) || asked.value < 0) {
    return { ok: false, error: "Enter a tip amount." };
  }
  // A tip larger than the bill itself is far more likely to be a mis-typed
  // amount than generosity, and the customer cannot undo a captured card
  // charge themselves.
  if (asked.value > balance) {
    return { ok: false, error: "A tip cannot be larger than the amount due." };
  }
  return { ok: true, tipMinor: asked.value };
}

/**
 * What the card/bank is actually charged: the balance plus the tip.
 * The surcharge, when Fee Saver applies, is added by the processor on top of
 * this and validated separately by paymentAmountParts().
 */
export function chargeTotalMinor(balanceMinor, tipMinor) {
  const balance = Number(balanceMinor);
  const tip = Number(tipMinor);
  if (!Number.isInteger(balance) || balance < 0)
    throw new Error("balance must be a non-negative integer");
  if (!Number.isInteger(tip) || tip < 0) throw new Error("tip must be a non-negative integer");
  const total = balance + tip;
  if (!Number.isSafeInteger(total)) throw new Error("amount too large");
  return total;
}

/**
 * Split a recorded charge back into the parts that go in the payment row.
 * `base_amount_minor` is what settles the document; `tip_minor` is the tip.
 * They are separated here so no call site can accidentally book a tip as
 * revenue by passing the gross to base_amount_minor.
 */
export function paymentTipParts(chargedMinor, tipMinor) {
  const charged = Number(chargedMinor);
  const tip = Number(tipMinor);
  if (!Number.isInteger(charged) || charged < 0)
    throw new Error("charged must be a non-negative integer");
  if (!Number.isInteger(tip) || tip < 0 || tip > charged)
    throw new Error("tip must be within the charged amount");
  return { baseMinor: charged - tip, tipMinor: tip };
}
