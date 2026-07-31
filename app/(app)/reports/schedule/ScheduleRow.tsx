"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteReportSchedule, setReportScheduleEnabled } from "./actions";

export type Schedule = {
  id: string; name: string; frequency: string; enabled: boolean;
  recipient_profile_ids: string[] | null;
  last_period_key: string | null; last_run_at: string | null; last_error: string | null;
};

/**
 * One scheduled digest.
 *
 * `last_error` is rendered in full and in red. A schedule that has been failing
 * for a fortnight must not look like a schedule that is working — that silence
 * is the whole class of defect this branch exists to remove.
 */
export default function ScheduleRow({ schedule, names }: { schedule: Schedule; names: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    start(async () => {
      const result = await fn();
      setError(result.ok ? null : result.error ?? "That did not work.");
      router.refresh();
    });
  };

  const recipients = (schedule.recipient_profile_ids ?? []).map((id) => names[id] ?? id.slice(0, 8));

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
        <b>{schedule.name}</b>
        <span style={{ fontSize: 12.5, color: schedule.enabled ? "#15803d" : "#5c6675", fontWeight: 700 }}>
          {schedule.enabled ? `● ${schedule.frequency}` : "paused"}
        </span>
      </div>

      <div style={{ fontSize: 12.5, color: "#5c6675", marginTop: 4 }}>
        To: {recipients.length ? recipients.join(", ") : <b style={{ color: "#b45309" }}>nobody — this will send nothing</b>}
      </div>
      <div style={{ fontSize: 12.5, color: "#5c6675" }}>
        {schedule.last_run_at
          ? `Last run ${schedule.last_run_at.slice(0, 10)}${schedule.last_period_key ? ` · covered ${schedule.last_period_key}` : ""}`
          : "Has not run yet"}
      </div>

      {schedule.last_error && (
        <div role="alert" style={{ marginTop: 8, background: "#fdeaea", border: "1px solid #f5b5b5", color: "#b91c1c", borderRadius: 9, padding: "8px 10px", fontSize: 12.5 }}>
          Last run reported: {schedule.last_error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" style={button} disabled={pending} onClick={() => act(() => setReportScheduleEnabled(schedule.id, !schedule.enabled))}>
          {schedule.enabled ? "Pause" : "Resume"}
        </button>
        <button
          type="button" style={{ ...button, background: "#fdeaea", color: "#b91c1c" }} disabled={pending}
          onClick={() => { if (window.confirm(`Delete the "${schedule.name}" schedule?`)) act(() => deleteReportSchedule(schedule.id)); }}
        >
          Delete
        </button>
      </div>

      {error && <div role="alert" style={{ marginTop: 8, color: "#b91c1c", fontSize: 13, fontWeight: 700 }}>{error}</div>}
    </div>
  );
}

const button: React.CSSProperties = {
  background: "#eef2f8", color: "#0b1524", border: "none", borderRadius: 8,
  padding: "7px 12px", fontWeight: 700, fontSize: 12.5, cursor: "pointer",
};
