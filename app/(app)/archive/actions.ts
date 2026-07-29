"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";

export type ImportResult = { ok: boolean; inserted: number; error?: string };

export type LegacyRow = { name: string; phone?: string; email?: string; address?: string; city?: string; history?: string };

/**
 * Import legacy / historical clients into a SEPARATE archived area.
 * These rows are flagged archived=true so they never mix with active
 * customers, jobs, or reports — they exist purely for records/lookup.
 */
export async function bulkImportLegacy(rows: LegacyRow[]): Promise<ImportResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, inserted: 0, error: "forbidden" }; }

  const clean = (rows ?? [])
    .filter((r) => r && typeof r.name === "string" && r.name.trim())
    .slice(0, 10000)
    .map((r) => ({
      organization_id: profile!.organization_id,
      created_by: profile!.id,
      archived: true,
      name: r.name.trim().slice(0, 120),
      phone: (r.phone ?? "").trim().slice(0, 40) || "—",
      email: (r.email ?? "").trim().slice(0, 160) || null,
      address: (r.address ?? "").trim().slice(0, 200) || null,
      city: (r.city ?? "").trim().slice(0, 80) || null,
      legacy_note: (r.history ?? "").trim().slice(0, 2000) || null,
    }));

  if (!clean.length) return { ok: false, inserted: 0, error: "No valid rows found (need at least a name)." };

  const supabase = await createClient();
  let inserted = 0;
  for (let i = 0; i < clean.length; i += 500) {
    const chunk = clean.slice(i, i + 500);
    const { error } = await supabase.from("customers").insert(chunk);
    if (error) return { ok: false, inserted, error: error.message };
    inserted += chunk.length;
  }
  revalidatePath("/archive");
  return { ok: true, inserted };
}

/** Move an archived record into your active customer list. */
export async function restoreFromArchive(id: string): Promise<{ ok: boolean; error?: string }> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }
  const supabase = await createClient();
  const { error } = await supabase.from("customers").update({ archived: false }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/archive"); revalidatePath("/customers");
  return { ok: true };
}
