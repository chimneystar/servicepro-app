import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { redirect } from "next/navigation";
import TeamClient from "./TeamClient";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const profile = await requireProfile();
  if (profile.role !== "owner") redirect("/");
  const locale = getLocale();
  const supabase = createClient();

  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role").order("role"),
    supabase.from("invitations").select("id, email, role").is("accepted_at", null).order("created_at", { ascending: false }),
  ]);

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>{t(locale, "team.title")}</h1>
      <TeamClient locale={locale} members={members ?? []} invites={invites ?? []} myId={profile.id} />
    </div>
  );
}
