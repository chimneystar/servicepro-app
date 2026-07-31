"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recomputeJobLabourCost } from "./actions";
import { money } from "@/lib/format";
import type { Locale } from "@/lib/i18n";

/**
 * The job's real profit and loss (remediation plan 6c.2).
 *
 * Clock in / out has been collected since migration 009 and reached NO profit
 * figure anywhere: /reports costed a job from its line items only, so every
 * margin the owner has ever seen treated the technician's time as free. This
 * panel is where the owner sees the whole cost, and the recompute button is
 * what pushes the labour snapshot onto the job so invoicing carries it into the
 * margin report.
 *
 * Owner and office only. A technician never sees it — see db/023 §5, which
 * moved cost and margin data out of technicians' reach, and db/039 §1, which
 * keeps the wage itself owner-only even from this screen.
 */
export default function JobCosting({ locale, currency, jobId, revenueMinor, materialsMinor, expensesMinor, labour }: {
  locale: Locale; currency: string; jobId: string;
  revenueMinor: number; materialsMinor: number; expensesMinor: number;
  labour: { minutes: number; costMinor: number; unpriced: number; openEntries: number; available: boolean; costedAt: string | null };
}) {
  const he = locale === "he";
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cost = materialsMinor + labour.costMinor + expensesMinor;
  const profit = revenueMinor - cost;
  const marginPct = revenueMinor > 0 ? Math.round((profit / revenueMinor) * 100) : null;
  const hours = (labour.minutes / 60).toFixed(2);

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 16, marginTop: 12 }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>{he ? "רווחיות העבודה" : "Job profitability"}</div>
      {!labour.available && (
        <div style={warn}>
          {he ? "תמחור עבודה אינו זמין — יש להריץ את מיגרציה 039." : "Job costing is unavailable — migration 039 has not been run."}
        </div>
      )}
      <Row label={he ? "הכנסה" : "Revenue"} value={money(revenueMinor, currency)} />
      <Row label={he ? "חומרים" : "Materials"} value={"−" + money(materialsMinor, currency)} />
      <Row label={`${he ? "עבודה" : "Labour"} (${hours} ${he ? "שעות" : "h"})`} value={"−" + money(labour.costMinor, currency)} />
      <Row label={he ? "הוצאות שהוזנו" : "Entered expenses"} value={"−" + money(expensesMinor, currency)} />
      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, marginTop: 6, borderTop: "2px solid #e2e8f0", fontWeight: 800 }}>
        <span>{he ? "רווח" : "Profit"}</span>
        <span style={{ color: profit >= 0 ? "#15803d" : "#dc2626" }}>
          {money(profit, currency)}{marginPct === null ? "" : ` · ${marginPct}%`}
        </span>
      </div>

      {/* The figure says when it understates reality instead of quietly doing it. */}
      {(labour.unpriced > 0 || labour.openEntries > 0) && (
        <div style={warn}>
          {labour.unpriced > 0 && (he
            ? `ל-${labour.unpriced} עובד/ים אין תעריף עלות, ולכן שעותיהם מתומחרות באפס. הזינו תעריף במסך "צוות".`
            : `${labour.unpriced} person(s) on this job have no cost rate, so their hours are costed at zero. Enter a rate on the Team screen.`)}
          {labour.unpriced > 0 && labour.openEntries > 0 ? " " : ""}
          {labour.openEntries > 0 && (he
            ? `${labour.openEntries} שעון/ים עדיין פתוחים — השעות שלהם אינן נספרות עד לסגירה.`
            : `${labour.openEntries} timer(s) are still running — those hours are NOT counted until they are clocked out.`)}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" disabled={busy || !labour.available} style={btn}
          onClick={() => start(async () => {
            const result = await recomputeJobLabourCost(jobId);
            setError(result.ok ? null : (result.error ?? null));
            if (result.ok) router.refresh();
          })}>
          {busy ? (he ? "מחשבים…" : "Recalculating…") : (he ? "חישוב מחדש של עלות העבודה" : "Recalculate labour cost")}
        </button>
        <small style={{ color: "#5c6675" }}>
          {labour.costedAt
            ? `${he ? "עודכן" : "snapshot"} ${new Date(labour.costedAt).toLocaleString(he ? "he-IL" : "en-US")}`
            : (he ? "עוד לא נשמר תצלום עלות." : "No snapshot saved yet.")}
        </small>
      </div>
      {error && <div style={{ ...warn, background: "#fdeaea", color: "#dc2626" }}>{error}</div>}
      <div style={{ fontSize: 12, color: "#5c6675", marginTop: 8, lineHeight: 1.5 }}>
        {he
          ? "עלות העבודה נכנסת לחשבונית כשורת עלות במחיר 0, ולכן היא מגיעה לדוח הרווחיות בלי לחייב את הלקוח פעמיים."
          : "The labour cost is carried onto the invoice as a zero-priced cost line, which is how it reaches the margin report without charging the customer twice."}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13.5, color: "#334155" }}>
      <span>{label}</span><b>{value}</b>
    </div>
  );
}

const btn: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", padding: "9px 14px", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 13.5 };
const warn: React.CSSProperties = { background: "#fff5e0", color: "#a15c07", padding: "9px 12px", borderRadius: 10, fontSize: 12.5, marginTop: 10, lineHeight: 1.5 };
