"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";
import { recordInventoryMovement } from "@/lib/inventory";
// @ts-ignore
import { parseAmountToMinor, parseQtyToMilli } from "@/lib/core/money.mjs";

export type ActionResult = {
  ok: boolean;
  error?: string;
  /** "insufficient_stock" — the caller may offer the deliberate override. */
  code?: string;
  availableMilli?: number;
};

/**
 * Create or edit an item.
 *
 * `quantity` is no longer written directly: it is a cache the database derives
 * from `inventory_movements` (migration 033) and writing it is refused. On
 * create, the opening figure becomes an "Opening stock" movement. On edit, a
 * changed figure becomes an "adjustment" with a reason, because someone typing
 * a new number into a stock field is performing a stocktake whether they call
 * it that or not — and the old code recorded neither the before, the after, nor
 * who did it.
 */
export async function saveInventoryItem(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let profile;
  try {
    profile = await requireProfile();
    assertRole(profile, ["owner", "office"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name required" };
  let cost_minor = 0;
  try {
    cost_minor = parseAmountToMinor(String(formData.get("cost") ?? "0"));
  } catch {}

  let qtyMilli = 0;
  try {
    qtyMilli = parseQtyToMilli(String(formData.get("quantity") ?? "0"));
  } catch {
    return { ok: false, error: "Invalid quantity" };
  }

  const base = {
    name,
    sku: String(formData.get("sku") ?? "").trim() || null,
    unit: String(formData.get("unit") ?? "unit").trim() || "unit",
    low_stock_threshold: Math.max(0, parseInt(String(formData.get("low") ?? "0"), 10) || 0),
    cost_minor,
    updated_at: new Date().toISOString(),
  };
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();

  if (!id) {
    // quantity is accepted on INSERT: the database turns it into the opening
    // movement, so the ledger still tells the whole story.
    const { error } = await supabase.from("inventory_items").insert({
      organization_id: profile.organization_id,
      ...base,
      quantity: Math.trunc(qtyMilli / 1000),
      quantity_milli: qtyMilli,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/inventory");
    return { ok: true };
  }

  const { data: current } = await supabase
    .from("inventory_items")
    .select("id, quantity_milli")
    .eq("id", id)
    .maybeSingle();
  if (!current) return { ok: false, error: "not found" };

  const { error } = await supabase.from("inventory_items").update(base).eq("id", id);
  if (error) return { ok: false, error: error.message };

  const delta = qtyMilli - (current.quantity_milli ?? 0);
  if (delta !== 0) {
    const moved = await recordInventoryMovement(profile.organization_id!, profile.id, {
      itemId: id,
      kind: "adjustment",
      qtyMilli: delta,
      reason: String(formData.get("reason") ?? "").trim() || "Stock corrected on the item form",
      unitCostMinor: cost_minor,
      allowNegative: String(formData.get("allowNegative") ?? "") === "true",
    });
    if (!moved.ok) {
      revalidatePath("/inventory");
      return moved;
    }
  }
  revalidatePath("/inventory");
  return { ok: true };
}

/**
 * The +/- buttons on the inventory list.
 *
 * Was: read the quantity, add the delta, write it back — so two people pressing
 * "−" at the same moment removed one unit between them, and nothing recorded
 * that either of them had. Now each press is a ledger row, and the database
 * refuses to take stock below zero without a deliberate override.
 */
export async function adjustQuantity(
  id: string,
  delta: number,
  reason?: string,
  allowNegative = false,
): Promise<ActionResult> {
  let profile;
  try {
    profile = await requireProfile();
    assertRole(profile, ["owner", "office"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!Number.isInteger(delta) || delta === 0) return { ok: false, error: "Nothing to change" };

  const result = await recordInventoryMovement(profile.organization_id!, profile.id, {
    itemId: id,
    kind: "adjustment",
    qtyMilli: delta * 1000,
    reason:
      (reason ?? "").trim() ||
      (delta > 0 ? "Counted in on the inventory list" : "Counted out on the inventory list"),
    allowNegative,
  });
  revalidatePath("/inventory");
  revalidatePath("/inventory/movements");
  return result;
}

/** Record a receipt, consumption or correction with an explicit reason. */
export async function recordStockMovement(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let profile;
  try {
    profile = await requireProfile();
    assertRole(profile, ["owner", "office"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const itemId = String(formData.get("itemId") ?? "");
  const kind = String(formData.get("kind") ?? "adjustment");
  if (!itemId) return { ok: false, error: "Choose an item" };
  if (!["receipt", "consumption", "adjustment"].includes(kind))
    return { ok: false, error: "Unknown movement type" };

  let magnitude = 0;
  try {
    magnitude = parseQtyToMilli(String(formData.get("qty") ?? "0"));
  } catch {
    return { ok: false, error: "Invalid quantity" };
  }
  if (magnitude === 0) return { ok: false, error: "Enter a quantity" };

  const direction = String(formData.get("direction") ?? "in") === "out" ? -1 : 1;
  const signed =
    kind === "receipt" ? magnitude : kind === "consumption" ? -magnitude : magnitude * direction;

  let unitCostMinor: number | undefined;
  const costRaw = String(formData.get("unitCost") ?? "").trim();
  if (costRaw) {
    try {
      unitCostMinor = parseAmountToMinor(costRaw);
    } catch {
      return { ok: false, error: "Invalid cost" };
    }
  }

  const result = await recordInventoryMovement(profile.organization_id!, profile.id, {
    itemId,
    kind: kind as "receipt" | "consumption" | "adjustment",
    qtyMilli: signed,
    reason: String(formData.get("reason") ?? "").trim(),
    unitCostMinor,
    allowNegative: String(formData.get("allowNegative") ?? "") === "true",
  });
  revalidatePath("/inventory");
  revalidatePath("/inventory/movements");
  return result;
}

export async function deleteInventoryItem(id: string): Promise<ActionResult> {
  try {
    const p = await requireProfile();
    assertRole(p, ["owner", "office"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("inventory_items").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/inventory");
  revalidatePath("/inventory/movements");
  return { ok: true };
}
