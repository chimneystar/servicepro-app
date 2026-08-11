"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateCommission } from "@/app/(app)/reports/commission/actions";
import { ActionError, useActionStatus } from "@/components/ActionStatus";

export type TechRow = {
  profileId: string;
  name: string;
  pct: number;
  jobs: number;
  revenueMinor: number;
  expensesMinor: number;
};
const SYM: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };

export default function CommissionClient({
  rows,
  currency,
  canEditPct,
}: {
  rows: TechRow[];
  currency: string;
  canEditPct: boolean;
}) {
  const router = useRouter();
  // Saving a commission percentage that the database refused used to leave the
  // new figure sitting in the input, so payroll was calculated from a number
  // nobody had actually stored.
  const { pending, error, run } = useActionStatus();
  const [saved, setSaved] = useState<string | null>(null);
  const [ccFee, setCcFee] = useState("0");
  const [pcts, setPcts] = useState<Record<string, number>>(
    Object.fromEntries(rows.map((r) => [r.profileId, r.pct])),
  );
  const cur = SYM[currency] ?? "$";
  const m = (v: number) =>
    cur + (v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ccPct = parseFloat(ccFee) || 0;

  const calc = (r: TechRow) => {
    const cc = Math.round((r.revenueMinor * ccPct) / 100);
    const net = r.revenueMinor - r.expensesMinor - cc;
    const commission = Math.round((net * (pcts[r.profileId] ?? 0)) / 100);
    return { cc, net, commission };
  };
  const totalCommission = rows.reduce((s, r) => s + calc(r).commission, 0);

  function savePct(id: string) {
    setSaved(null);
    run(
      () => updateCommission(id, pcts[id] ?? 0),
      () => {
        setSaved(id);
        setTimeout(() => setSaved(null), 1800);
        router.refresh();
      },
    );
  }
  function exportCsv() {
    const esc = (v: any) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      [
        "Technician",
        "Jobs",
        "Revenue",
        "Job costs",
        "CC fees",
        "Net",
        "Commission %",
        "Commission pay",
      ].join(","),
    ];
    rows.forEach((r) => {
      const c = calc(r);
      lines.push(
        [
          r.name,
          r.jobs,
          (r.revenueMinor / 100).toFixed(2),
          (r.expensesMinor / 100).toFixed(2),
          (c.cc / 100).toFixed(2),
          (c.net / 100).toFixed(2),
          pcts[r.profileId] ?? 0,
          (c.commission / 100).toFixed(2),
        ]
          .map(esc)
          .join(","),
      );
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "commission.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <label style={{ fontSize: "0.875rem", fontWeight: 700, color: "#334155" }}>
          Credit-card fee %
          <input
            value={ccFee}
            onChange={(e) => setCcFee(e.target.value)}
            type="number"
            step="0.01"
            style={{
              width: 80,
              marginInlineStart: 8,
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "7px 10px",
              fontSize: "0.9375rem",
            }}
          />
        </label>
        <button
          type="button"
          onClick={exportCsv}
          style={{
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "9px 14px",
            fontWeight: 700,
            fontSize: "0.875rem",
            cursor: "pointer",
          }}
        >
          <span aria-hidden="true">⬇</span> Export CSV
        </button>
        <div style={{ marginInlineStart: "auto", fontWeight: 800, fontSize: "1rem" }}>
          Total payout: <span style={{ color: "#15803d" }}>{m(totalCommission)}</span>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {rows.map((r) => {
          const c = calc(r);
          return (
            <div
              key={r.profileId}
              style={{
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 14,
                padding: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <b style={{ fontSize: "0.9375rem" }}>{r.name}</b>
                <div style={{ fontWeight: 800, color: "#15803d", fontSize: "1rem" }}>
                  {m(c.commission)}
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(90px,1fr))",
                  gap: 8,
                  margin: "10px 0",
                  fontSize: "0.875rem",
                }}
              >
                <KV label="Jobs done" v={String(r.jobs)} />
                <KV label="Revenue" v={m(r.revenueMinor)} />
                <KV label="Job costs" v={m(r.expensesMinor)} />
                <KV label="CC fees" v={m(c.cc)} />
                <KV label="Net" v={m(c.net)} strong />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: "0.875rem", color: "#5c6675", fontWeight: 600 }}>
                    Commission
                  </span>
                  <input
                    type="number"
                    value={pcts[r.profileId] ?? 0}
                    disabled={!canEditPct}
                    onChange={(e) =>
                      setPcts({ ...pcts, [r.profileId]: parseInt(e.target.value, 10) || 0 })
                    }
                    style={{
                      width: 70,
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      padding: "7px 10px",
                      fontSize: "0.9375rem",
                    }}
                  />
                </label>
                <span className="sp-text-muted">%</span>
                {canEditPct && (
                  <button
                    type="button"
                    onClick={() => savePct(r.profileId)}
                    disabled={pending}
                    style={{
                      background: "#eef2f8",
                      color: "#2563eb",
                      border: "none",
                      borderRadius: 8,
                      padding: "7px 12px",
                      fontWeight: 700,
                      fontSize: "0.875rem",
                      cursor: "pointer",
                    }}
                  >
                    {saved === r.profileId ? (
                      <>
                        <span aria-hidden="true">✓</span> Saved
                      </>
                    ) : (
                      "Save %"
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="rempty">
            No completed jobs with an assigned technician in this period.
          </div>
        )}
      </div>
      <ActionError error={error} />
      <p style={{ color: "#5c6675", fontSize: "0.875rem", marginTop: 12 }}>
        Net = job revenue − job costs (entered on each job) − credit-card fees. Commission = net ×
        the technician’s %. Only jobs in a “Done” status count.
      </p>
    </div>
  );
}

function KV({ label, v, strong }: { label: string; v: string; strong?: boolean }) {
  return (
    <div style={{ background: "#f8fafc", borderRadius: 8, padding: "7px 10px" }}>
      <div style={{ color: "#5c6675", fontWeight: 700, fontSize: "0.875rem" }}>{label}</div>
      <b style={{ color: strong ? "#15803d" : "#0b1524" }}>{v}</b>
    </div>
  );
}
