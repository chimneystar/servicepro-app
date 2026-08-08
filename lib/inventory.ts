import "server-only";
import { createClient } from "@/lib/supabase/server";
// @ts-ignore — pure logic, unit-tested in tests/inventory.test.mjs
import { validateMovement, formatQtyMilli } from "@/lib/core/inventory.mjs";

/**
 * The single guarded path for changing stock.
 *
 * THE GAP THIS CLOSES (remediation plan 5.11). Stock used to move by
 * `select quantity` → `update quantity = q + delta`, from one screen only. Two
 * adjustments in the same second lost one of them, nothing recorded who moved
 * stock or why, and the one event that should decrement it — a technician
 * fitting a part on a job — did not exist at all.
 *
 * Every change is now an append-only row in `inventory_movements`.
 * `inventory_items.quantity` / `quantity_milli` are caches the database
 * maintains from that ledger (migration 033), so they cannot drift from it, and
 * a direct write to them is refused.
 *
 * NEGATIVE STOCK. The database refuses a movement that would take stock below
 * zero, under a row lock, so two technicians consuming the last unit at the same
 * instant cannot both succeed. But a technician who has physically fitted the
 * part must still be able to say so — refusing would lose the record AND the
 * part. So the refusal comes back as `code: "insufficient_stock"` with the real
 * balance, and the caller may resubmit with `allowNegative` and a reason. That
 * records the truth, drives the balance negative, and flags the item for a
 * stock count.
 */
export type MovementKind = "receipt" | "consumption" | "adjustment";

export type MovementResult = {
  ok: boolean;
  error?: string;
  /** "insufficient_stock" means the caller may offer the deliberate override. */
  code?: string;
  availableMilli?: number;
  movementId?: string;
};

export type MovementInput = {
  itemId: string;
  kind: MovementKind;
  /** Signed milliunits: negative removes stock. */
  qtyMilli: number;
  reason: string;
  unitCostMinor?: number;
  allowNegative?: boolean;
  jobId?: string | null;
  jobItemId?: string | null;
};

export async function recordInventoryMovement(
  organizationId: string,
  actorId: string,
  input: MovementInput,
): Promise<MovementResult> {
  const supabase = await createClient();

  // Read the balance first so an impossible movement is explained before the
  // write. The database repeats the check under a lock — this is the courtesy,
  // that is the enforcement.
  const { data: item } = await supabase
    .from("inventory_items")
    .select("id, quantity_milli, cost_minor, organization_id")
    .eq("id", input.itemId)
    .maybeSingle();
  if (!item || item.organization_id !== organizationId)
    return { ok: false, error: "Item not found." };

  const check = validateMovement({
    kind: input.kind,
    qtyMilli: input.qtyMilli,
    availableMilli: item.quantity_milli ?? 0,
    allowNegative: input.allowNegative ?? false,
    reason: input.reason,
  });
  if (!check.ok) {
    return {
      ok: false,
      error: check.error,
      code: check.code,
      availableMilli: check.availableMilli,
    };
  }

  const { data, error } = await supabase
    .from("inventory_movements")
    .insert({
      organization_id: organizationId,
      item_id: input.itemId,
      kind: input.kind,
      qty_milli: check.qtyMilli,
      unit_cost_minor: input.unitCostMinor ?? item.cost_minor ?? 0,
      reason: input.reason.trim(),
      allow_negative: input.allowNegative ?? false,
      job_id: input.jobId ?? null,
      job_item_id: input.jobItemId ?? null,
      created_by: actorId,
    })
    .select("id")
    .single();

  if (error) {
    // The lock-protected guard in the database won the race, or the balance
    // moved between the read above and the insert. Re-read and report the truth.
    if (/insufficient_stock/i.test(error.message)) {
      const { data: fresh } = await supabase
        .from("inventory_items")
        .select("quantity_milli")
        .eq("id", input.itemId)
        .maybeSingle();
      const available = fresh?.quantity_milli ?? 0;
      return {
        ok: false,
        code: "insufficient_stock",
        availableMilli: available,
        error: `Only ${formatQtyMilli(available)} left in stock.`,
      };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true, movementId: data?.id };
}
