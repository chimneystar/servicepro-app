"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";

export type ImportResult = { ok: boolean; inserted: number; error?: string };

export async function bulkImportCustomers(rows: { name: string; phone?: string; email?: string; city?: string }[]): Promise<ImportResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, inserted: 0, error: "forbidden" }; }

  const clean = (rows ?? [])
    .filter((r) => r && typeof r.name === "string" && r.name.trim())
    .slice(0, 5000)
    .map((r) => ({
      organization_id: profile!.organization_id,
      created_by: profile!.id,
      name: r.name.trim().slice(0, 120),
      phone: (r.phone ?? "").trim().slice(0, 40) || "—",
      email: (r.email ?? "").trim().slice(0, 160) || null,
      city: (r.city ?? "").trim().slice(0, 80) || null,
    }));

  if (!clean.length) return { ok: false, inserted: 0, error: "No valid rows found (need at least a name)." };

  const supabase = createClient();
  // insert in chunks to stay well within limits
  let inserted = 0;
  for (let i = 0; i < clean.length; i += 500) {
    const chunk = clean.slice(i, i + 500);
    const { error } = await supabase.from("customers").insert(chunk);
    if (error) return { ok: false, inserted, error: error.message };
    inserted += chunk.length;
  }
  revalidatePath("/customers");
  return { ok: true, inserted };
}
