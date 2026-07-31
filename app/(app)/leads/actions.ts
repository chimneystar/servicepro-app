"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";

export type ActionResult = { ok: boolean; error?: string; customerId?: string };

const STATUSES = ["new", "contacted", "quoted", "won", "lost"];

export async function updateLeadStatus(id: string, status: string): Promise<ActionResult> {
  let profile;
  try {
    profile = await requireProfile();
    assertRole(profile, ["owner", "office"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!STATUSES.includes(status)) return { ok: false, error: "invalid status" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/leads");
  return { ok: true };
}

/** Turn a lead into an active customer (kept out of the archive). Marks the lead won. */
export async function convertLead(id: string): Promise<ActionResult> {
  let profile;
  try {
    profile = await requireProfile();
    assertRole(profile, ["owner", "office"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = await createClient();
  const { data: lead } = await supabase.from("leads").select("*").eq("id", id).single();
  if (!lead) return { ok: false, error: "not found" };

  const { data: cust, error } = await supabase
    .from("customers")
    .insert({
      organization_id: profile.organization_id,
      created_by: profile.id,
      name: lead.name,
      phone: lead.phone || "—",
      email: lead.email || null,
      address: lead.address || null,
      city: lead.city || null,
      source: lead.source || "Online booking",
      notes: lead.notes || null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await supabase
    .from("leads")
    .update({ status: "won", converted_customer_id: cust.id, updated_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/leads");
  revalidatePath("/customers");
  return { ok: true, customerId: cust.id };
}

export async function deleteLead(id: string): Promise<ActionResult> {
  let profile;
  try {
    profile = await requireProfile();
    assertRole(profile, ["owner", "office"]);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("leads").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/leads");
  return { ok: true };
}
