import "server-only";
import { createClient } from "@/lib/supabase/server";

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
  const { data } = await supabase
    .from("audit_log")
    .select("id, table_name, action, actor, old_data, new_data, at")
    .eq("table_name", tableName)
    .eq("row_id", rowId)
    .order("at", { ascending: false })
    .limit(30);
  const rows = (data ?? []) as Omit<ActivityEntry, "actor_name">[];
  const actorIds = [...new Set(rows.map((row) => row.actor).filter(Boolean))] as string[];
  const { data: people } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", actorIds)
    : { data: [] };
  const names = new Map((people ?? []).map((person) => [person.id, person.full_name]));
  return rows.map((row) => ({
    ...row,
    actor_name: row.actor ? (names.get(row.actor) ?? null) : null,
  }));
}
