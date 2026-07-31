"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
// @ts-ignore — integer-safe money engine (JS module, unit-tested)
import { parseAmountToMinor, parseQtyToMilli, lineSubtotalMinor } from "@/lib/core/money.mjs";
// @ts-ignore — purchase-order lifecycle rules (JS module, unit-tested)
import { PO_STATUSES, canTransitionPurchaseOrder, validateReceipt } from "@/lib/core/inventory.mjs";
// @ts-ignore — automation support matrix, proven both ways in tests/automation.test.mjs
import { automationRefusalMessage, validateAutomationRule } from "@/lib/core/automation.mjs";

// Every action here returns the `{ ok, error }` contract used by
// app/(app)/customers/actions.ts. They used to return bare `void` and drop the
// Supabase error on the floor: a rejected insert cleared the form, revalidated
// the page, and left the operator looking at a list that simply did not contain
// the crew / vendor / purchase order they had just created.
export type ActionResult = { ok: boolean; error?: string };

const invalid = (he: boolean) => (he ? "חסר מידע או שאחד הפרטים לא תקין." : "Some information is missing or invalid.");
const saveFailed = (he: boolean) => (he ? "לא הצלחנו לשמור. אפשר לנסות שוב." : "We couldn't save that. Please try again.");
const forbidden = (he: boolean) => (he ? "אין לכם הרשאה לבצע את הפעולה הזאת." : "You don't have permission to do that.");

type Context = { profile: Awaited<ReturnType<typeof requireProfile>>; supabase: Awaited<ReturnType<typeof createClient>> };

async function context(): Promise<Context> {
  const profile = await requireProfile();
  assertRole(profile, ["owner", "office"]);
  return { profile, supabase: await createClient() };
}

/** Resolve the caller, turning an authorization failure into a message. */
async function guard(): Promise<{ he: boolean; ctx?: Context; error?: string }> {
  const he = (await getLocale()) === "he";
  try {
    return { he, ctx: await context() };
  } catch {
    return { he, error: forbidden(he) };
  }
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export async function createCrew(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const name = text(form, "name");
  if (!name) return { ok: false, error: invalid(he) };
  const { error: dbError } = await ctx.supabase.from("crews").insert({ organization_id: ctx.profile.organization_id, name, color: text(form, "color") || "#2463eb" });
  if (dbError) return { ok: false, error: saveFailed(he) };
  revalidatePath("/operations");
  return { ok: true };
}

export async function createServiceArea(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const name = text(form, "name");
  if (!name) return { ok: false, error: invalid(he) };
  const values = text(form, "values").split(/[,\n]/).map((value) => value.trim()).filter(Boolean);
  // Only 'zip' and 'city' are accepted. A 'polygon' area cannot be evaluated at
  // booking time — that needs map coordinates for the customer's address, and
  // nothing here geocodes (addresses are free text, there is no PostGIS, and
  // this very form would build the "polygon" by splitting a text box on commas).
  // Storing one produced an area that looks enforced and silently is not, so the
  // creation path refuses instead of manufacturing more of them. Existing
  // polygon rows are left untouched and surfaced as a warning on
  // /settings/booking. See docs/REMEDIATION-PLAN.md item 4.8.
  const areaType = text(form, "areaType") === "city" ? "city" : "zip";
  const { error: dbError } = await ctx.supabase.from("service_areas").insert({ organization_id: ctx.profile.organization_id, name, area_type: areaType, values_json: values });
  if (dbError) return { ok: false, error: saveFailed(he) };
  revalidatePath("/operations");
  // The booking settings screen reports service-area enforcement, so it must
  // refresh too.
  revalidatePath("/settings/booking");
  return { ok: true };
}

/**
 * Create an automation rule (ledger 5.8).
 *
 * This used to accept ANY trigger/action pair and store it. Since nothing
 * executed rules at all, an owner could save "when an estimate is sent, create
 * a task" and it would sit there looking configured for ever. Now that the
 * nightly executor is real (lib/cron-tasks.ts → runAutomationRules), the pairs
 * it cannot honestly perform are REFUSED HERE, with the reason, instead of
 * being accepted and quietly ignored — an unsupported rule that is visibly
 * rejected is a much smaller problem than one that pretends to work.
 */
export async function createAutomation(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const name = text(form, "name");
  if (!name) return { ok: false, error: invalid(he) };

  const validation = validateAutomationRule({
    triggerType: text(form, "triggerType"),
    actionType: text(form, "actionType"),
    message: text(form, "message"),
    overdueDays: text(form, "overdueDays"),
  });
  if (!validation.ok) return { ok: false, error: automationRefusalMessage(validation.reason, he) };
  const { triggerType, actionType, message, overdueDays } = validation.rule;

  const { error: dbError } = await ctx.supabase.from("automation_rules").insert({
    organization_id: ctx.profile.organization_id, name,
    trigger_type: triggerType, action_type: actionType,
    action_json: { message },
    condition_json: triggerType === "invoice_overdue" ? { overdue_days: overdueDays } : {},
    created_by: ctx.profile.id,
  });
  if (dbError) return { ok: false, error: saveFailed(he) };
  revalidatePath("/operations");
  return { ok: true };
}

/** Turn a rule on or off. The executor only ever reads rules with enabled = true. */
export async function setAutomationEnabled(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const id = text(form, "id");
  if (!id) return { ok: false, error: invalid(he) };
  const enabled = text(form, "enabled") === "on";
  const { error: dbError } = await ctx.supabase.from("automation_rules")
    .update({ enabled }).eq("id", id).eq("organization_id", ctx.profile.organization_id);
  if (dbError) return { ok: false, error: saveFailed(he) };
  revalidatePath("/operations");
  return { ok: true };
}

export async function createVendor(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const name = text(form, "name");
  if (!name) return { ok: false, error: invalid(he) };
  const { error: dbError } = await ctx.supabase.from("vendors").insert({ organization_id: ctx.profile.organization_id, name, contact_name: text(form, "contactName") || null, email: text(form, "email") || null, phone: text(form, "phone") || null });
  if (dbError) return { ok: false, error: saveFailed(he) };
  revalidatePath("/operations");
  return { ok: true };
}

// ---------------------------------------------------------------------
// Purchase orders (remediation plan 5.19).
//
// A PO used to be a shell: exactly ONE line, a status that never left 'draft',
// no receive step, and no connection to inventory — so the one event that
// legitimately increases stock never increased it. These four actions plus
// migration 033 make it a real document: many lines, a lifecycle the database
// enforces, and a receive step that writes inventory movements.
//
// Quantities are integer milliunits throughout. `purchase_order_items.quantity`
// was a raw numeric(12,3) float, the only quantity in the product that was not;
// it survives as a derived mirror of `qty_milli` so nothing that reads it breaks.
// ---------------------------------------------------------------------

/** Parse the repeated line fields. The Operations form posts one of each; the
 *  receiving workspace posts several. `getAll` handles both without branching. */
function purchaseOrderLines(form: FormData): { description: string; qtyMilli: number; unitCostMinor: number; inventoryItemId: string | null }[] {
  const descriptions = form.getAll("description").map((v) => String(v).trim());
  const quantities = form.getAll("quantity").map((v) => String(v));
  const costs = form.getAll("unitCost").map((v) => String(v));
  const links = form.getAll("inventoryItemId").map((v) => String(v).trim());
  const lines: { description: string; qtyMilli: number; unitCostMinor: number; inventoryItemId: string | null }[] = [];
  for (let i = 0; i < descriptions.length; i += 1) {
    if (!descriptions[i]) continue;
    // Money and quantity go through the tested integer engine. This previously
    // did Math.round(Number(unitCost) * 100) and then Math.round(quantity *
    // unitCostMinor) with quantity as an unquantized float — two rounding steps
    // outside the engine every other document total uses, and NaN on any
    // non-numeric input.
    const qtyMilli = Math.max(1, parseQtyToMilli(quantities[i] ?? "1"));
    const unitCostMinor = Math.max(0, parseAmountToMinor(costs[i] ?? "0"));
    lines.push({ description: descriptions[i], qtyMilli, unitCostMinor, inventoryItemId: links[i] || null });
  }
  return lines;
}

export async function createPurchaseOrder(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };

  let lines: ReturnType<typeof purchaseOrderLines>;
  try { lines = purchaseOrderLines(form); } catch { return { ok: false, error: invalid(he) }; }
  if (!lines.length) return { ok: false, error: invalid(he) };

  // The database recomputes this from the lines (sync_purchase_order_total), so
  // the two can never disagree; it is written here so a pre-033 database still
  // shows the right figure.
  const totalMinor = lines.reduce((sum, l) => sum + lineSubtotalMinor(l.qtyMilli, l.unitCostMinor), 0);

  const poNumber = text(form, "poNumber") || `PO-${Date.now().toString().slice(-8)}`;
  const { data: order, error: orderError } = await ctx.supabase.from("purchase_orders").insert({ organization_id: ctx.profile.organization_id, po_number: poNumber, vendor_id: text(form, "vendorId") || null, job_id: text(form, "jobId") || null, total_minor: totalMinor, expected_date: text(form, "expectedDate") || null, created_by: ctx.profile.id }).select("id").single();
  if (orderError || !order) return { ok: false, error: saveFailed(he) };
  const { error: itemError } = await ctx.supabase.from("purchase_order_items").insert(lines.map((l, index) => ({
    organization_id: ctx.profile.organization_id, purchase_order_id: order.id, description: l.description,
    qty_milli: l.qtyMilli, quantity: l.qtyMilli / 1000, unit_cost_minor: l.unitCostMinor,
    inventory_item_id: l.inventoryItemId, sort: index,
  })));
  if (itemError) return { ok: false, error: saveFailed(he) };
  revalidatePath("/operations");
  revalidatePath("/inventory/receiving");
  return { ok: true };
}

/** Add a line to an existing PO — the missing half of "multi-line". */
export async function addPurchaseOrderLine(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const purchaseOrderId = text(form, "purchaseOrderId");
  if (!purchaseOrderId) return { ok: false, error: invalid(he) };

  let lines: ReturnType<typeof purchaseOrderLines>;
  try { lines = purchaseOrderLines(form); } catch { return { ok: false, error: invalid(he) }; }
  if (!lines.length) return { ok: false, error: invalid(he) };

  const { data: order } = await ctx.supabase.from("purchase_orders").select("id, status").eq("id", purchaseOrderId).maybeSingle();
  if (!order) return { ok: false, error: saveFailed(he) };
  if (order.status === "received" || order.status === "cancelled") {
    return { ok: false, error: he ? "אי אפשר להוסיף שורות להזמנה סגורה." : "This purchase order is closed." };
  }

  const { count } = await ctx.supabase.from("purchase_order_items").select("id", { count: "exact", head: true }).eq("purchase_order_id", purchaseOrderId);
  const { error: itemError } = await ctx.supabase.from("purchase_order_items").insert(lines.map((l, index) => ({
    organization_id: ctx.profile.organization_id, purchase_order_id: purchaseOrderId, description: l.description,
    qty_milli: l.qtyMilli, quantity: l.qtyMilli / 1000, unit_cost_minor: l.unitCostMinor,
    inventory_item_id: l.inventoryItemId, sort: (count ?? 0) + index,
  })));
  if (itemError) return { ok: false, error: saveFailed(he) };
  revalidatePath("/operations");
  revalidatePath("/inventory/receiving");
  return { ok: true };
}

/**
 * Advance the PO through its lifecycle. The legal transitions live in
 * lib/core/inventory.mjs and are ALSO enforced by a trigger in migration 033 —
 * checked here so the operator gets a sentence rather than a Postgres error,
 * enforced there because the action is not the only way in.
 */
export async function advancePurchaseOrderStatus(purchaseOrderId: string, status: string): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const { data: order } = await ctx.supabase.from("purchase_orders").select("id, status").eq("id", purchaseOrderId).maybeSingle();
  if (!order) return { ok: false, error: saveFailed(he) };
  if (!PO_STATUSES.includes(status)) return { ok: false, error: invalid(he) };
  if (!canTransitionPurchaseOrder(order.status, status)) {
    return { ok: false, error: he ? `אי אפשר להעביר הזמנה מ-${order.status} ל-${status}.` : `A purchase order cannot go from ${order.status} to ${status}.` };
  }
  if (order.status === status) return { ok: true };
  const { error: dbError } = await ctx.supabase.from("purchase_orders").update({ status }).eq("id", purchaseOrderId);
  if (dbError) return { ok: false, error: saveFailed(he) };
  revalidatePath("/operations");
  revalidatePath("/inventory/receiving");
  return { ok: true };
}

/**
 * Receive stock against a PO line — the step that closes the loop with 5.11.
 *
 * The whole thing (line total, inventory receipt, PO status) happens inside one
 * database function under a row lock, so a double-click cannot receive twice and
 * the PO status can never disagree with its lines.
 */
export async function receivePurchaseOrderLine(lineId: string, qty: string): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };

  const { data: line } = await ctx.supabase
    .from("purchase_order_items")
    .select("id, qty_milli, received_qty_milli, purchase_orders(status)")
    .eq("id", lineId).maybeSingle();
  if (!line) return { ok: false, error: saveFailed(he) };

  let qtyMilli = 0;
  try { qtyMilli = parseQtyToMilli(qty); } catch { return { ok: false, error: invalid(he) }; }

  const poStatus = String((line as { purchase_orders?: { status?: string } | { status?: string }[] }).purchase_orders
    ? (Array.isArray((line as any).purchase_orders) ? (line as any).purchase_orders[0]?.status : (line as any).purchase_orders?.status)
    : "ordered");
  const check = validateReceipt(line, qtyMilli, poStatus);
  if (!check.ok) return { ok: false, error: check.error };

  const { error: rpcError } = await ctx.supabase.rpc("receive_purchase_order_line", { p_line: lineId, p_qty_milli: qtyMilli });
  if (rpcError) return { ok: false, error: rpcError.message || saveFailed(he) };
  revalidatePath("/operations");
  revalidatePath("/inventory");
  revalidatePath("/inventory/receiving");
  revalidatePath("/inventory/movements");
  return { ok: true };
}

export async function createSubcontractor(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const companyName = text(form, "companyName");
  if (!companyName) return { ok: false, error: invalid(he) };
  const { error: dbError } = await ctx.supabase.from("subcontractors").insert({ organization_id: ctx.profile.organization_id, company_name: companyName, contact_name: text(form, "contactName") || null, email: text(form, "email") || null, phone: text(form, "phone") || null, trades: text(form, "trades").split(",").map((value) => value.trim()).filter(Boolean), insurance_expires_on: text(form, "insuranceExpires") || null });
  if (dbError) return { ok: false, error: saveFailed(he) };
  revalidatePath("/operations");
  return { ok: true };
}
