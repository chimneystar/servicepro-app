import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { providers } from "@/lib/providers";
import ActionForm from "@/components/ActionForm";
import ScheduleRow, { type Schedule } from "./ScheduleRow";
import { createReportSchedule } from "./actions";

/**
 * Scheduled / emailed reports (ledger 6c.9).
 *
 * Every number in this product required somebody to log in and look at it. The
 * digest goes out on the EXISTING daily cron — no second endpoint, no second
 * secret — and its revenue figures come from lib/core/reporting.mjs, the same
 * engine this screen's parent uses, so the email and /reports cannot disagree.
 */
export const dynamic = "force-dynamic";

export default async function ReportSchedulePage() {
  const profile = await requireProfile();
  if (profile.role !== "owner") redirect("/reports");

  const supabase = await createClient();
  const [{ data: schedules }, { data: members }, { data: recent }] = await Promise.all([
    supabase
      .from("report_schedules")
      .select(
        "id, name, frequency, enabled, recipient_profile_ids, last_period_key, last_run_at, last_error",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, full_name, role, active, notify_email_opt_in")
      .eq("active", true)
      .order("full_name"),
    supabase
      .from("report_deliveries")
      .select("id, period_key, status, reason, recipients, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const names: Record<string, string> = {};
  for (const member of members ?? []) names[member.id] = member.full_name || member.id.slice(0, 8);

  return (
    <div style={{ maxWidth: 760 }}>
      <Link href="/reports" style={back}>
        ‹ Reports
      </Link>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: "8px 0 4px" }}>Emailed reports</h1>
      <p style={{ color: "#5c6675", fontSize: "0.8125rem", marginBottom: 14 }}>
        A summary of collected revenue, margin, expenses and receivables, sent on the nightly run.
      </p>

      {!providers.email() && (
        <div
          role="alert"
          style={{
            background: "#fdeaea",
            border: "1px solid #f5b5b5",
            color: "#b91c1c",
            borderRadius: 12,
            padding: "11px 14px",
            fontSize: "0.8125rem",
            marginBottom: 16,
          }}
        >
          <b>No email provider is connected</b>, so nothing will be delivered. Schedules stay due
          rather than being marked sent, and they will go out the day Resend is configured.
        </div>
      )}

      <ActionForm
        action={createReportSchedule}
        successLabel="Report scheduled"
        className="ops-form"
      >
        <div
          style={{
            display: "grid",
            gap: 10,
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            padding: 14,
            marginBottom: 18,
          }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              name="name"
              placeholder="Name (e.g. Weekly summary)"
              aria-label="Name (e.g. Weekly summary)"
              maxLength={80}
              style={input}
            />
            <select name="frequency" defaultValue="weekly" style={input} aria-label="How often">
              <option value="daily">Daily (yesterday)</option>
              <option value="weekly">Weekly (last 7 days)</option>
              <option value="monthly">Monthly (last complete month)</option>
            </select>
          </div>
          <fieldset style={{ border: "1px solid #eef1f6", borderRadius: 10, padding: 10 }}>
            <legend
              style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#5c6675", padding: "0 6px" }}
            >
              Send to
            </legend>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))",
                gap: 4,
              }}
            >
              {(members ?? []).map((member) => (
                <label
                  key={member.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: "0.8125rem",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    name="recipients"
                    value={member.id}
                    defaultChecked={member.id === profile.id}
                  />
                  <span>
                    {member.full_name || "(no name)"}{" "}
                    <span style={{ color: "#5c6675" }}>· {member.role}</span>
                    {member.notify_email_opt_in === false && (
                      <b style={{ color: "#b45309" }}> · alerts off</b>
                    )}
                  </span>
                </label>
              ))}
            </div>
            <p style={{ fontSize: "0.75rem", color: "#5c6675", margin: "8px 0 0" }}>
              Recipients are teammates, not free-text addresses. Anyone who has turned notification
              email off is skipped at send time, with the reason recorded — the same opt-out rule
              that protects customers.
            </p>
          </fieldset>
          <div>
            <button type="submit" style={primary}>
              + Schedule report
            </button>
          </div>
        </div>
      </ActionForm>

      <h3 style={h3}>Schedules ({(schedules ?? []).length})</h3>
      {(schedules ?? []).map((schedule) => (
        <ScheduleRow key={schedule.id} schedule={schedule as Schedule} names={names} />
      ))}
      {(schedules ?? []).length === 0 && (
        <div className="rempty">No reports are scheduled yet.</div>
      )}

      {(recent ?? []).length > 0 && (
        <>
          <h3 style={h3}>Recent runs</h3>
          <div className="rlist">
            {(recent ?? []).map((run) => (
              <div className="ritem" key={run.id}>
                <div className="rmain">
                  <div className="rtitle">{run.period_key}</div>
                  <div className="rsub">
                    {run.created_at?.slice(0, 10)} · {run.recipients} recipient
                    {run.recipients === 1 ? "" : "s"}
                    {run.reason ? ` · ${run.reason}` : ""}
                  </div>
                </div>
                <div className="rend">
                  <b
                    style={{
                      color:
                        run.status === "sent"
                          ? "#15803d"
                          : run.status === "failed"
                            ? "#dc2626"
                            : "#5c6675",
                    }}
                  >
                    {run.status}
                  </b>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const back: React.CSSProperties = {
  color: "#2563eb",
  fontWeight: 700,
  fontSize: "0.875rem",
  textDecoration: "none",
};
const h3: React.CSSProperties = { fontSize: "1rem", fontWeight: 800, margin: "18px 0 8px" };
const input: React.CSSProperties = {
  border: "1px solid #d7dee9",
  borderRadius: 9,
  padding: "9px 11px",
  fontSize: "0.875rem",
  minWidth: 180,
};
const primary: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 9,
  padding: "9px 16px",
  fontWeight: 700,
  fontSize: "0.875rem",
  cursor: "pointer",
};
