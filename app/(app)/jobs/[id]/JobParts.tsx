"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addJobPart } from "./actions";
import { useAppLocale } from "@/components/LocaleProvider";
// @ts-ignore — pure logic, unit-tested in tests/inventory.test.mjs
import { formatQtyMilli } from "@/lib/core/inventory.mjs";
import { Button, Notice } from "@/components/ui";

export type StockItem = {
  id: string;
  name: string;
  unit: string;
  quantity_milli: number;
  cost_minor: number;
};

/**
 * Fit a part from stock onto this job.
 *
 * Adding it writes the job line AND the stock movement, so the count in the van
 * and the cost on the job move together. Before this, a technician could fit
 * fifty parts and inventory would not notice.
 *
 * When there is not enough stock the answer is not simply "no": the part may
 * genuinely have been fitted. The refusal offers to record it anyway, which
 * takes the balance negative and flags the item for a stock count.
 */
export default function JobParts({ jobId, stock }: { jobId: string; stock: StockItem[] }) {
  const router = useRouter();
  const he = useAppLocale() === "he";
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsOverride, setNeedsOverride] = useState(false);

  function submit(formData: FormData) {
    setError(null);
    start(async () => {
      if (needsOverride) formData.set("allowNegative", "true");
      const r = await addJobPart(jobId, formData);
      if (r.ok) {
        setOpen(false);
        setNeedsOverride(false);
        router.refresh();
        return;
      }
      setError(r.error ?? (he ? "לא הצלחנו לשמור" : "Could not save"));
      setNeedsOverride(r.code === "insufficient_stock");
    });
  }

  if (!stock.length) return null;

  return (
    <div style={{ marginTop: 12 }}>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{ ...btn, background: "#eef2f8", color: "#2563eb" }}
        >
          {he ? "שימוש בחלק מהמלאי" : "Use a part from stock"}
        </button>
      )}
      {open && (
        <form
          action={submit}
          style={{
            background: "#f8fbff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            padding: 14,
          }}
        >
          <select
            name="inventoryItemId"
            required
            aria-label={he ? "בחירת חלק" : "Choose a part"}
            className="sp-select sp-control--lg"
          >
            <option value="">{he ? "בחירת חלק" : "Choose a part"}</option>
            {stock.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {formatQtyMilli(s.quantity_milli)} {s.unit}
              </option>
            ))}
          </select>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <input
              name="qty"
              type="number"
              step="0.001"
              min="0.001"
              defaultValue="1"
              placeholder={he ? "כמות" : "Qty"}
              aria-label={he ? "כמות" : "Qty"}
              className="sp-input sp-control--lg"
            />
            <input
              name="price"
              type="number"
              step="0.01"
              min="0"
              placeholder={he ? "מחיר ללקוח" : "Price to customer"}
              aria-label={he ? "מחיר ללקוח" : "Price to customer"}
              className="sp-input sp-control--lg"
            />
          </div>
          {error && (
            <Notice role="alert" mt={3}>
              {error}
            </Notice>
          )}
          {needsOverride && (
            <label
              style={{ display: "block", fontSize: "0.8125rem", color: "#9a3412", marginTop: 8 }}
            >
              <input type="checkbox" name="allowNegative" value="true" defaultChecked />{" "}
              {he
                ? "לרשום בכל זאת — החלק הותקן בפועל. הפריט יסומן לספירת מלאי."
                : "Record it anyway — the part really was fitted. The item is flagged for a stock count."}
            </label>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Button type="submit" disabled={pending} size="md">
              {pending ? (he ? "שומרים…" : "Saving…") : he ? "שמירה" : "Save"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
                setNeedsOverride(false);
              }}
              style={{ ...btn, background: "#e2e9f4", color: "#2563eb" }}
            >
              {he ? "ביטול" : "Cancel"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  padding: "9px 15px",
  borderRadius: 10,
  fontWeight: 700,
  cursor: "pointer",
};
