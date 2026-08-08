"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setJobStage, createInvoiceFromJob } from "@/app/(app)/jobs/[id]/actions";
import { useAppLocale } from "@/components/LocaleProvider";
import { ActionError, useActionStatus } from "@/components/ActionStatus";

export type Stage = { name: string; color: string };

export default function JobActions({
  jobId,
  stage,
  stages,
  canInvoice,
}: {
  jobId: string;
  stage: string;
  stages: Stage[];
  canInvoice: boolean;
}) {
  const router = useRouter();
  const he = useAppLocale() === "he";
  const { pending, error, run } = useActionStatus(he);
  // Success is tracked as its own flag. It used to be inferred from the message
  // starting with "✓" — which the success string ("Invoice created") never did,
  // so a created invoice was reported in error red.
  const [ok, setOk] = useState<string | null>(null);
  const list = stages.length ? stages : [{ name: "Scheduled", color: "#2563eb" }];
  const current = list.find((s) => s.name === stage) ?? list[0];

  function changeStage(s: string) {
    setOk(null);
    run(
      () => setJobStage(jobId, s),
      () => router.refresh(),
    );
  }
  function makeInvoice() {
    if (!confirm(he ? "ליצור חשבונית מהעבודה?" : "Create an invoice from this job?")) return;
    setOk(null);
    run(
      () => createInvoiceFromJob(jobId),
      () => {
        setOk(he ? "החשבונית נוצרה" : "Invoice created");
        router.refresh();
      },
    );
  }

  return (
    <div>
      <label className="sp-field">
        <span
          style={{
            fontSize: "0.875rem",
            fontWeight: 700,
            color: "#334155",
            display: "block",
            marginBottom: 6,
          }}
        >
          {he ? "סטטוס" : "Status"}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 4,
              background: current?.color ?? "#2563eb",
              flexShrink: 0,
            }}
            aria-hidden="true"
          />
          <select
            value={stage}
            disabled={pending}
            onChange={(e) => changeStage(e.target.value)}
            style={{
              flex: 1,
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: "11px 12px",
              background: "#fff",
              fontWeight: 600,
            }}
          >
            {list.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </label>
      {canInvoice && (
        <button
          type="button"
          onClick={makeInvoice}
          disabled={pending}
          style={{
            width: "100%",
            background: "#15803d",
            color: "#fff",
            border: "none",
            borderRadius: 12,
            padding: 14,
            fontWeight: 800,
            fontSize: "0.9375rem",
            cursor: "pointer",
          }}
        >
          {he ? "יצירת חשבונית מהעבודה" : "Create invoice from job"}
        </button>
      )}
      {ok && (
        <div
          role="status"
          style={{ marginTop: 10, color: "#15803d", fontSize: "0.875rem", fontWeight: 600 }}
        >
          ✓ {ok}
        </div>
      )}
      <ActionError error={error} style={{ marginTop: 10 }} />
    </div>
  );
}
