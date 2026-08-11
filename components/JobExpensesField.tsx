"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { setJobExpenses } from "@/app/(app)/jobs/[id]/actions";
import { useAppLocale } from "@/components/LocaleProvider";
import { ActionError, useActionStatus } from "@/components/ActionStatus";

export default function JobExpensesField({ jobId, value }: { jobId: string; value: number }) {
  const router = useRouter();
  const he = useAppLocale() === "he";
  const { pending, error, run } = useActionStatus(he);
  const [amt, setAmt] = useState((value / 100).toFixed(2));
  const [saved, setSaved] = useState(false);
  const descId = useId();

  function save() {
    // The tick used to appear whether or not the amount was stored — and this
    // number feeds technician commission.
    run(
      () => setJobExpenses(jobId, amt),
      () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
        router.refresh();
      },
    );
  }
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 14,
        marginTop: 12,
      }}
    >
      <div
        id={descId}
        style={{ fontSize: "0.875rem", fontWeight: 700, color: "#334155", marginBottom: 6 }}
      >
        {he
          ? "עלויות העבודה, כמו חומרים ועמלות. הסכום משמש לחישוב עמלה."
          : "Job costs, such as materials and fees. Used to calculate commission."}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
          type="number"
          step="0.01"
          style={{
            flex: 1,
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            padding: "9px 12px",
            fontSize: "1rem",
            outline: "none",
          }}
          placeholder="0.00"
          aria-labelledby={descId}
        />
        <button
          type="button"
          onClick={save}
          disabled={pending}
          style={{
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "9px 14px",
            fontWeight: 700,
            cursor: "pointer",
          }}
          aria-label={he ? "שמירה" : "Save"}
        >
          {saved ? "✓" : he ? "שמירה" : "Save"}
        </button>
      </div>
      <ActionError error={error} />
    </div>
  );
}
