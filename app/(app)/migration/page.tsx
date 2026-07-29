import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import MigrationCenter from "@/components/MigrationCenter";

export const dynamic = "force-dynamic";

export default async function MigrationPage() {
  const profile = await requireProfile(); if (profile.role === "tech") redirect("/tech");
  const locale = await getLocale(); const supabase = await createClient();
  const { data: batches } = await supabase.from("migration_batches").select("id,source,filename,status,counts_json,created_at,completed_at").order("created_at", { ascending: false }).limit(30);
  return <MigrationCenter locale={locale} batches={batches ?? []} canRollback={profile.role === "owner"} />;
}
