"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

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
  const quantity = Math.max(0.001, Number(form.get("quantity") ?? 1));
  const unitCostMinor = Math.max(0, Math.round(Number(form.get("unitCost") ?? 0) * 100));
  const poNumber = `PO-${Date.now().toString().slice(-8)}`;
  const { data: order } = await supabase.from("purchase_orders").insert({ organization_id: profile.organization_id, po_number: poNumber, vendor_id: text(form, "vendorId") || null, job_id: text(form, "jobId") || null, total_minor: Math.round(quantity * unitCostMinor), created_by: profile.id }).select("id").single();
  if (order) await supabase.from("purchase_order_items").insert({ organization_id: profile.organization_id, purchase_order_id: order.id, description, quantity, unit_cost_minor: unitCostMinor });
  revalidatePath("/operations");
}

export async function createSubcontractor(form: FormData) {
  const { profile, supabase } = await context();
  const companyName = text(form, "companyName"); if (!companyName) return;
  await supabase.from("subcontractors").insert({ organization_id: profile.organization_id, company_name: companyName, contact_name: text(form, "contactName") || null, email: text(form, "email") || null, phone: text(form, "phone") || null, trades: text(form, "trades").split(",").map((value) => value.trim()).filter(Boolean), insurance_expires_on: text(form, "insuranceExpires") || null });
  revalidatePath("/operations");
}
