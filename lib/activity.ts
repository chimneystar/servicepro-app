import "server-only";
import { createClient } from "@/lib/supabase/server";
import * as profilesData from "@/lib/data/profiles";

export type ActivityEntry = {
  id: number;
  table_name: string;
  action: string;
  actor: string | null;
  actor_name: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  at: string;
};

export async function loadActivity(
  tableName: "jobs" | "customers" | "estimates" | "invoices",
  rowId: string,
): Promise<ActivityEntry[]> {
  const supabase = await createClient();
  // Kept EXACTLY as it was (not routed through lib/data/backend.ts) on
  // purpose: it already carries its own explicit `.limit(30)`, which the data
  // layer already treats as bounded (see tests/helpers/reads.mjs), and
  // tests/account-security.test.mjs reads this file's own source for that
  // literal text to prove the per-record timeline still shows exactly 30 rows.
  const { data } = await supabase
    .from("audit_log")
    .select("id, table_name, action, actor, old_data, new_data, at")
    .eq("table_name", tableName)
    .eq("row_id", rowId)
    .order("at", { ascending: false })
    .limit(30);
  const rows = (data ?? []) as Omit<ActivityEntry, "actor_name">[];
  const actorIds = [...new Set(rows.map((row) => row.actor).filter(Boolean))] as string[];
  const people = await profilesData.listNamesByIds(supabase, actorIds);
  const names = new Map(people.map((person) => [person.id, person.full_name]));
  return rows.map((row) => ({
    ...row,
    actor_name: row.actor ? (names.get(row.actor) ?? null) : null,
  }));
}
