"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type MigrationCustomer = { externalId?: string; name: string; phone?: string; email?: string; address?: string; city?: string; notes?: string };

export async function importMigrationCustomers(source: "workiz" | "housecall_pro" | "spreadsheet", filename: string, input: MigrationCustomer[]) {
  const profile = await requireProfile(); assertRole(profile, ["owner", "office"]);
  const rows = input.slice(0, 2500).map((row) => ({ ...row, name: String(row.name ?? "").trim() })).filter((row) => row.name);
  if (!rows.length) return { ok: false, error: "no valid rows" };
  const supabase = await createClient();
  const { data: batch, error: batchError } = await supabase.from("migration_batches").insert({ organization_id: profile.organization_id, source, filename: filename.slice(0,180), status: "importing", counts_json: { received: input.length, valid: rows.length }, created_by: profile.id }).select("id").single();
  if (batchError || !batch) return { ok: false, error: "batch could not be created" };
  const payload = rows.map((row) => ({ organization_id: profile.organization_id, name: row.name.slice(0,180), phone: (row.phone ?? "").slice(0,60), email: (row.email ?? "").slice(0,180) || null, address: (row.address ?? "").slice(0,240) || null, city: (row.city ?? "").slice(0,120) || null, notes: (row.notes ?? "").slice(0,4000) || null, source: source === "housecall_pro" ? "Housecall Pro" : source === "workiz" ? "Workiz" : "Import", created_by: profile.id, migration_batch_id: batch.id, external_source: source, external_id: row.externalId?.slice(0,180) || null }));
  const { data: inserted, error } = await supabase.from("customers").upsert(payload, { onConflict: "organization_id,external_source,external_id", ignoreDuplicates: true }).select("id");
  if (error) { await supabase.from("migration_batches").update({ status: "failed", errors_json: [{ message: "Customer import failed" }] }).eq("id", batch.id); return { ok: false, error: "import failed" }; }
  await supabase.from("migration_batches").update({ status: "completed", counts_json: { received: input.length, valid: rows.length, imported: inserted?.length ?? 0 }, completed_at: new Date().toISOString() }).eq("id", batch.id);
  revalidatePath("/migration"); revalidatePath("/customers");
  return { ok: true, imported: inserted?.length ?? 0 };
}

export async function rollbackMigration(batchId: string) {
  const profile = await requireProfile(); assertRole(profile, ["owner"]); const supabase = await createClient();
  const { data: batch } = await supabase.from("migration_batches").select("id,status").eq("id", batchId).eq("organization_id", profile.organization_id!).maybeSingle();
  if (!batch || batch.status !== "completed") return { ok: false };
  const at = new Date().toISOString();
  await supabase.from("customers").update({ deleted_at: at }).eq("migration_batch_id", batch.id);
  await supabase.from("jobs").update({ deleted_at: at }).eq("migration_batch_id", batch.id);
  await supabase.from("migration_batches").update({ status: "rolled_back" }).eq("id", batch.id);
  revalidatePath("/migration"); revalidatePath("/customers"); return { ok: true };
}
