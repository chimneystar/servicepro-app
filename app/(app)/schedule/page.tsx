import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import JobForm from "./JobForm";

export const dynamic = "force-dynamic";

const ST: Record<string, string> = { scheduled: "st.scheduled", in_progress: "st.in_progress", done: "st.done", cancelled: "st.cancelled" };
const STC: Record<string, string> = { scheduled: "#e0ebff|#2563eb", in_progress: "#fdf1dc|#b45309", done: "#e6f6ec|#15803d", cancelled: "#eef1f6|#57606f" };

export default async function SchedulePage() {
  const profile = await requireProfile();
  const locale = getLocale();
  const supabase = createClient();

  const [{ data: jobs }, { data: customers }, { data: profiles }] = await Promise.all([
    supabase.from("jobs")
      .select("id, service, status, price_minor, scheduled_date, start_time, end_time, customer_id, assigned_to, customers(name), profiles!jobs_assigned_to_fkey(full_name)")
      .is("deleted_at", null)
      .order("scheduled_date", { ascending: true }).order("start_time", { ascending: true }),
    supabase.from("customers").select("id, name").is("deleted_at", null).order("name"),
    supabase.from("profiles").select("id, full_name").order("full_name"),
  ]);

  const custOpts = (customers ?? []).map((c) => ({ id: c.id, label: c.name }));
  const techOpts = (profiles ?? []).map((p) => ({ id: p.id, label: p.full_name || "—" }));

  // group by date
  const groups: Record<string, any[]> = {};
  (jobs ?? []).forEach((j) => { (groups[j.scheduled_date] = groups[j.scheduled_date] || []).push(j); });
  const dates = Object.keys(groups).sort();

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>{t(locale, "sched.title")}</h1>
        <JobForm locale={locale} customers={custOpts} techs={techOpts} />
      </div>

      {dates.length === 0 && (
        <div style={{ textAlign: "center", padding: 50, color: "#5c6675", background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📅</div>{t(locale, "sched.empty")}
        </div>
      )}

      {dates.map((date) => (
        <div key={date} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#5c6675", padding: "6px 4px" }}>{fmtDate(date)}</div>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", boxShadow: "0 6px 18px rgba(15,42,94,.06)" }}>
            {groups[date].map((j) => {
              const [bg, fg] = (STC[j.status] ?? STC.scheduled).split("|");
              return (
                <div key={j.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 15px", borderTop: "1px solid #eef1f6" }}>
                  <div style={{ minWidth: 58, textAlign: "center" }}>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{(j.start_time ?? "").slice(0, 5) || "—"}</div>
                    <div style={{ fontSize: 11, color: "#5c6675" }}>{(j.end_time ?? "").slice(0, 5)}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{j.customers?.name ?? "—"}</div>
                    <div style={{ fontSize: 12.5, color: "#5c6675" }}>{j.service} · {j.profiles?.full_name || t(locale, "job.unassigned")}</div>
                  </div>
                  <div style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{money(j.price_minor)}</div>
                  <span style={{ background: bg, color: fg, padding: "4px 11px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{t(locale, ST[j.status] ?? "st.scheduled")}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function fmtDate(iso: string) { const d = new Date(iso + "T00:00:00"); return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`; }
function money(minor: number) { return "$" + ((minor ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
