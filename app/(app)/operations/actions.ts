"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
// @ts-ignore — integer-safe money engine (JS module, unit-tested)
import { parseAmountToMinor, parseQtyToMilli, lineSubtotalMinor } from "@/lib/core/money.mjs";

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
  const { error: dbError } = await ctx.supabase.from("service_areas").insert({ organization_id: ctx.profile.organization_id, name, area_type: text(form, "areaType") || "zip", values_json: values });
  if (dbError) return { ok: false, error: saveFailed(he) };
  revalidatePath("/operations");
  return { ok: true };
}

export async function createAutomation(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const name = text(form, "name");
  if (!name) return { ok: false, error: invalid(he) };
  const { error: dbError } = await ctx.supabase.from("automation_rules").insert({ organization_id: ctx.profile.organization_id, name, trigger_type: text(form, "triggerType"), action_type: text(form, "actionType"), action_json: { message: text(form, "message") }, created_by: ctx.profile.id });
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

export async function createPurchaseOrder(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const description = text(form, "description");
  if (!description) return { ok: false, error: invalid(he) };

  // Money and quantity go through the tested integer engine. This previously did
  // Math.round(Number(unitCost) * 100) and then Math.round(quantity * unitCostMinor)
  // with quantity as an unquantized float — two rounding steps outside the engine
  // every other document total uses, and NaN on any non-numeric input.
  let qtyMilli: number, unitCostMinor: number;
  try {
    qtyMilli = Math.max(1, parseQtyToMilli(String(form.get("quantity") ?? "1")));
    unitCostMinor = Math.max(0, parseAmountToMinor(String(form.get("unitCost") ?? "0")));
  } catch {
    return { ok: false, error: invalid(he) };
  }
  const totalMinor = lineSubtotalMinor(qtyMilli, unitCostMinor);

  const poNumber = `PO-${Date.now().toString().slice(-8)}`;
  const { data: order, error: orderError } = await ctx.supabase.from("purchase_orders").insert({ organization_id: ctx.profile.organization_id, po_number: poNumber, vendor_id: text(form, "vendorId") || null, job_id: text(form, "jobId") || null, total_minor: totalMinor, created_by: ctx.profile.id }).select("id").single();
  if (orderError || !order) return { ok: false, error: saveFailed(he) };
  const { error: itemError } = await ctx.supabase.from("purchase_order_items").insert({ organization_id: ctx.profile.organization_id, purchase_order_id: order.id, description, quantity: qtyMilli / 1000, unit_cost_minor: unitCostMinor });
  if (itemError) return { ok: false, error: saveFailed(he) };
  revalidatePath("/operations");
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
