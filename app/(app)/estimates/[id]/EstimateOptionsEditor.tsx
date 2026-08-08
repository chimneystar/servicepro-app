"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addEstimateOption,
  deleteEstimateOption,
  addEstimateOptionItem,
  deleteEstimateOptionItem,
  chooseEstimateOption,
} from "../actions";
import { money } from "@/lib/format";
// @ts-ignore -- pure logic, proven both ways in tests/estimate-options.test.mjs
import { OPTION_TIERS, describeOptions, tierLabel } from "@/lib/core/estimate-options.mjs";
import type { Locale } from "@/lib/i18n";

export type OptionItemRow = {
  id: string;
  option_id: string;
  title: string | null;
  description: string;
  qty_milli: number;
  unit_price_minor: number;
  cost_minor: number;
  taxable: boolean;
};
export type OptionRow = {
  id: string;
  tier: string;
  title: string;
  description: string | null;
  recommended: boolean;
  deposit_minor: number;
  total_minor: number;
  sort: number;
};

/**
 * Build good / better / best (remediation plan 6c.4).
 *
 * Presenting three priced options is the single biggest close-rate lever in
 * this trade, and the product could only ever produce one flat price. Choosing
 * an option copies its lines into the estimate, so the deposit link and the
 * conversion path (db/024) both keep working unchanged.
 */
export default function EstimateOptionsEditor({
  locale,
  currency,
  estimateId,
  options,
  items,
  selectedOptionId,
  signed,
  discountMinor,
  taxRateBps,
  estimateDeposit,
}: {
  locale: Locale;
  currency: string;
  estimateId: string;
  options: OptionRow[];
  items: OptionItemRow[];
  selectedOptionId: string | null;
  signed: boolean;
  discountMinor: number;
  taxRateBps: number;
  estimateDeposit: number;
}) {
  const he = locale === "he";
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const result = await fn();
      setError(result.ok ? null : (result.error ?? (he ? "לא הצלחנו לשמור" : "Couldn't save")));
      if (result.ok) router.refresh();
    });

  const withItems = options.map((option) => ({
    ...option,
    items: items.filter((row) => row.option_id === option.id),
  }));
  const described = describeOptions(withItems, { discountMinor, taxRateBps, estimateDeposit }) as {
    id: string;
    tier: string;
    title: string;
    recommended: boolean;
    totalMinor: number;
    depositMinor: number;
    upgradeMinor: number;
  }[];
  const missingTiers = OPTION_TIERS.filter((tier: string) => !options.some((o) => o.tier === tier));

  return (
    <div style={card}>
      <div style={{ fontWeight: 800, fontSize: "0.9375rem", marginBottom: 6 }}>
        {he ? "חלופות מחיר (בסיסי / מומלץ / מקסימלי)" : "Price options (good / better / best)"}
      </div>
      <p style={hint}>
        {he
          ? "הלקוח בוחר חלופה בעמוד הציבורי, והחלופה שנבחרה היא זו שהופכת לחשבונית. מקדמה שכבר שולמה נשארת מקושרת להצעה ומזוכה בחשבונית."
          : "The customer picks one on their own page, and the chosen option is what converts to an invoice. A deposit already paid stays attached to this estimate and is still credited."}
      </p>
      {error && <div style={errBox}>{error}</div>}
      {signed && (
        <div style={warnBox}>
          {he
            ? "ההצעה נחתמה — אי אפשר לשנות חלופות."
            : "This estimate is signed — options can no longer be changed."}
        </div>
      )}

      {!signed && missingTiers.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {missingTiers.map((tier: string) => (
            <button
              key={tier}
              type="button"
              disabled={busy}
              style={btn}
              onClick={() =>
                run(() =>
                  addEstimateOption(estimateId, { tier, title: tierLabel(tier, locale) as string }),
                )
              }
            >
              + {tierLabel(tier, locale) as string}
            </button>
          ))}
        </div>
      )}

      {described.length === 0 && (
        <div style={hint}>
          {he
            ? "עוד לא הוגדרו חלופות. ההצעה תישלח במחיר יחיד."
            : "No options yet — this estimate goes out at a single price."}
        </div>
      )}

      {described.map((summary) => {
        const option = withItems.find((row) => row.id === summary.id)!;
        const chosen = selectedOptionId === option.id;
        return (
          <div
            key={option.id}
            style={{
              border: `1px solid ${chosen ? "#15803d" : "#e2e8f0"}`,
              borderRadius: 12,
              padding: 12,
              marginBottom: 10,
              background: chosen ? "#f4fbf6" : "#fff",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <b>{tierLabel(option.tier, locale) as string}</b>
              {option.recommended && (
                <span className="pill" style={{ background: "#e0ebff", color: "#1d4ed8" }}>
                  {he ? "מומלץ" : "recommended"}
                </span>
              )}
              {chosen && (
                <span className="pill" style={{ background: "#e6f6ec", color: "#15803d" }}>
                  {he ? "נבחר" : "chosen"}
                </span>
              )}
              <span style={{ marginInlineStart: "auto", fontWeight: 800 }}>
                {money(summary.totalMinor, currency)}
              </span>
              {summary.upgradeMinor > 0 && (
                <small style={{ color: "#5c6675" }}>+{money(summary.upgradeMinor, currency)}</small>
              )}
            </div>
            {summary.depositMinor > 0 && (
              <div style={{ fontSize: "0.75rem", color: "#5c6675", marginTop: 2 }}>
                {he ? "מקדמה" : "Deposit"}: {money(summary.depositMinor, currency)}
              </div>
            )}

            {option.items.map((row) => (
              <div
                key={row.id}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  fontSize: "0.8125rem",
                  padding: "5px 0",
                  borderTop: "1px solid #f1f4f9",
                }}
              >
                <span className="sp-flex-fill">
                  {row.title || row.description} ·{" "}
                  {(row.qty_milli / 1000).toLocaleString(locale === "he" ? "he-IL" : "en-US")} ×{" "}
                  {money(row.unit_price_minor, currency)}
                </span>
                {!signed && (
                  <button
                    type="button"
                    disabled={busy}
                    style={rm}
                    aria-label={he ? "מחיקת שורה" : "Remove line"}
                    onClick={() => run(() => deleteEstimateOptionItem(row.id, estimateId))}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}

            {!signed && (
              <form
                style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}
                action={(formData) =>
                  run(() => addEstimateOptionItem(option.id, estimateId, formData))
                }
              >
                <input
                  name="description"
                  required
                  placeholder={he ? "תיאור" : "description"}
                  aria-label={he ? "תיאור" : "description"}
                  style={{ ...inp, flex: "2 1 160px" }}
                />
                <input
                  name="qty"
                  defaultValue="1"
                  inputMode="decimal"
                  style={{ ...inp, flex: "0 0 70px" }}
                  aria-label={he ? "כמות" : "qty"}
                />
                <input
                  name="price"
                  defaultValue="0"
                  inputMode="decimal"
                  style={{ ...inp, flex: "0 0 90px" }}
                  aria-label={he ? "מחיר" : "price"}
                />
                <input
                  name="cost"
                  defaultValue="0"
                  inputMode="decimal"
                  style={{ ...inp, flex: "0 0 90px" }}
                  aria-label={he ? "עלות" : "cost"}
                />
                <button type="submit" disabled={busy} style={btn}>
                  {he ? "הוספת שורה" : "Add line"}
                </button>
              </form>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {!signed && !chosen && option.items.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  style={ghost}
                  onClick={() => run(() => chooseEstimateOption(estimateId, option.id))}
                >
                  {he ? "בחירה בשם הלקוח" : "Choose on the customer's behalf"}
                </button>
              )}
              {!signed && (
                <button
                  type="button"
                  disabled={busy}
                  style={rm}
                  onClick={() => run(() => deleteEstimateOption(option.id, estimateId))}
                >
                  {he ? "מחיקת החלופה" : "Delete option"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 14,
  padding: 16,
  marginTop: 14,
};
const hint: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "#5c6675",
  marginBottom: 10,
  lineHeight: 1.5,
};
const inp: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 9,
  padding: "8px 10px",
  fontSize: "0.8125rem",
  outline: "none",
  background: "#fff",
};
const btn: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  padding: "8px 13px",
  borderRadius: 9,
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "0.8125rem",
};
const ghost: React.CSSProperties = {
  background: "#eef1f6",
  color: "#334155",
  border: "none",
  padding: "8px 13px",
  borderRadius: 9,
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "0.8125rem",
};
const rm: React.CSSProperties = {
  background: "#fdeaea",
  color: "#dc2626",
  border: "none",
  padding: "6px 11px",
  borderRadius: 9,
  fontWeight: 700,
  fontSize: "0.8125rem",
  cursor: "pointer",
};
const errBox: React.CSSProperties = {
  background: "#fdeaea",
  color: "#dc2626",
  padding: "9px 12px",
  borderRadius: 10,
  fontSize: "0.8125rem",
  marginBottom: 10,
};
const warnBox: React.CSSProperties = {
  background: "#fff5e0",
  color: "#a15c07",
  padding: "9px 12px",
  borderRadius: 10,
  fontSize: "0.8125rem",
  marginBottom: 10,
};
