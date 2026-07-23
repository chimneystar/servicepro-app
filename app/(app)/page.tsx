import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";

export default async function DashboardPage() {
  const profile = await requireProfile();
  const locale = getLocale();
  const supabase = createClient();

  // Counts are automatically scoped to this org by RLS.
  const [{ count: customers }, { count: jobs }] = await Promise.all([
    supabase.from("customers").select("*", { count: "exact", head: true }),
    supabase.from("jobs").select("*", { count: "exact", head: true }),
  ]);

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>
        {t(locale, "dash.greeting", { name: profile.full_name || "👋" })}
      </h1>
      <p style={{ color: "#5c6675", marginBottom: 22 }}>{t(locale, "dash.overview")}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
        <Card icon="👥" label={t(locale, "dash.customers")} value={customers ?? 0} />
        <Card icon="📅" label={t(locale, "dash.jobs")} value={jobs ?? 0} />
      </div>

      <div style={{ marginTop: 24, background: "#e0ebff", color: "#1d4ed8", padding: "14px 16px", borderRadius: 12, fontSize: 14 }}>
        {t(locale, "dash.secured")}
      </div>
    </div>
  );
}

function Card({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18, boxShadow: "0 6px 18px rgba(15,42,94,.06)" }}>
      <div style={{ fontSize: 24 }}>{icon}</div>
      <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>{value}</div>
      <div style={{ color: "#5c6675", fontWeight: 600, fontSize: 13 }}>{label}</div>
    </div>
  );
}
