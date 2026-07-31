"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
// @ts-ignore — integer-safe money engine (JS module, unit-tested)
import { parseAmountToMinor, parseQtyToMilli, lineSubtotalMinor } from "@/lib/core/money.mjs";

async function context() {
  const profile = await requireProfile();
  assertRole(profile, ["owner", "office"]);
  return { profile, supabase: await createClient() };
}
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export async function createCrew(form: FormData) {
  const { profile, supabase } = await context();
  const name = text(form, "name"); if (!name) return;
  await supabase.from("crews").insert({ organization_id: profile.organization_id, name, color: text(form, "color") || "#2463eb" });
  revalidatePath("/operations");
}

export async function createServiceArea(form: FormData) {
  const { profile, supabase } = await context();
  const name = text(form, "name"); if (!name) return;
  const values = text(form, "values").split(/[,\n]/).map((value) => value.trim()).filter(Boolean);
  await supabase.from("service_areas").insert({ organization_id: profile.organization_id, name, area_type: text(form, "areaType") || "zip", values_json: values });
  revalidatePath("/operations");
}

export async function createAutomation(form: FormData) {
  const { profile, supabase } = await context();
  const name = text(form, "name"); if (!name) return;
  await supabase.from("automation_rules").insert({ organization_id: profile.organization_id, name, trigger_type: text(form, "triggerType"), action_type: text(form, "actionType"), action_json: { message: text(form, "message") }, created_by: profile.id });
  revalidatePath("/operations");
}

export async function createVendor(form: FormData) {
  const { profile, supabase } = await context();
  const name = text(form, "name"); if (!name) return;
  await supabase.from("vendors").insert({ organization_id: profile.organization_id, name, contact_name: text(form, "contactName") || null, email: text(form, "email") || null, phone: text(form, "phone") || null });
  revalidatePath("/operations");
}

export async function createPurchaseOrder(form: FormData) {
  const { profile, supabase } = await context();
  const description = text(form, "description"); if (!description) return;

  // Money and quantity go through the tested integer engine. This previously did
  // Math.round(Number(unitCost) * 100) and then Math.round(quantity * unitCostMinor)
  // with quantity as an unquantized float — two rounding steps outside the engine
  // every other document total uses, and NaN on any non-numeric input.
  let qtyMilli: number, unitCostMinor: number;
  try {
    qtyMilli = Math.max(1, parseQtyToMilli(String(form.get("quantity") ?? "1")));
    unitCostMinor = Math.max(0, parseAmountToMinor(String(form.get("unitCost") ?? "0")));
  } catch {
    return; // malformed amount — consistent with the other early returns here
  }
  const totalMinor = lineSubtotalMinor(qtyMilli, unitCostMinor);

  const poNumber = `PO-${Date.now().toString().slice(-8)}`;
  const { data: order } = await supabase.from("purchase_orders").insert({ organization_id: profile.organization_id, po_number: poNumber, vendor_id: text(form, "vendorId") || null, job_id: text(form, "jobId") || null, total_minor: totalMinor, created_by: profile.id }).select("id").single();
  if (order) await supabase.from("purchase_order_items").insert({ organization_id: profile.organization_id, purchase_order_id: order.id, description, quantity: qtyMilli / 1000, unit_cost_minor: unitCostMinor });
  revalidatePath("/operations");
}

export async function createSubcontractor(form: FormData) {
  const { profile, supabase } = await context();
  const companyName = text(form, "companyName"); if (!companyName) return;
  await supabase.from("subcontractors").insert({ organization_id: profile.organization_id, company_name: companyName, contact_name: text(form, "contactName") || null, email: text(form, "email") || null, phone: text(form, "phone") || null, trades: text(form, "trades").split(",").map((value) => value.trim()).filter(Boolean), insurance_expires_on: text(form, "insuranceExpires") || null });
  revalidatePath("/operations");
}
