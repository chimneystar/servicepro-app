"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/format";
// @ts-ignore -- pure logic, proven both ways in tests/estimate-options.test.mjs
import { describeOptions, tierLabel } from "@/lib/core/estimate-options.mjs";

/**
 * The customer picks good / better / best (remediation plan 6c.4).
 *
 * Goes straight to `select_estimate_option`, a security-definer RPC keyed on
 * the document's public token — the same shape as `approve_document`, which is
 * how every other action on this anonymous page already works. The RPC copies
 * the chosen option's lines into the estimate and recomputes the total, so the
 * price the customer sees here is the price that converts to an invoice.
 *
 * Choosing is refused once the estimate is SIGNED: re-pricing the lines under
 * an existing signature would defeat the sign-once guard migration 023 §6 had
 * to add, just as thoroughly as re-signing would.
 */
export default function OptionChooser({
  token,
  options,
  selectedId,
  currency,
  accent,
  locale,
  discountMinor,
  taxRateBps,
  estimateDeposit,
  signed,
}: {
  token: string;
  options: any[];
  selectedId: string | null;
  currency: string;
  accent: string;
  locale: "en" | "he";
  discountMinor: number;
  taxRateBps: number;
  estimateDeposit: number;
  signed: boolean;
}) {
  const he = locale === "he";
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = describeOptions(options, { discountMinor, taxRateBps, estimateDeposit }) as {
    id: string;
    tier: string;
    title: string;
    description: string | null;
    recommended: boolean;
    totalMinor: number;
    depositMinor: number;
    upgradeMinor: number;
  }[];
  if (!rows.length) return null;

  async function choose(optionId: string) {
    setBusy(optionId);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("select_estimate_option", {
        p_token: token,
        p_option: optionId,
        p_by: null,
      });
      const result = data as any;
      if (rpcError || !result?.ok) {
        setError(
          result?.error === "already_signed"
            ? he
              ? "ההצעה כבר אושרה ואי אפשר לשנות את הבחירה. דברו איתנו."
              : "This estimate has already been approved, so the choice can no longer be changed. Please call us."
            : he
              ? "לא הצלחנו לשמור את הבחירה. נסו שוב."
              : "We couldn't save your choice. Please try again.",
        );
        return;
      }
      router.refresh();
    } catch {
      setError(he ? "לא הצלחנו לשמור את הבחירה." : "We couldn't save your choice.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div
        style={{
          fontSize: "0.875rem",
          color: "#5c6675",
          fontWeight: 800,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        {he ? "בחרו את החבילה שלכם" : "Choose your package"}
      </div>
      {error && (
        <div
          style={{
            background: "#fdeaea",
            color: "#dc2626",
            padding: "10px 12px",
            borderRadius: 10,
            fontSize: "0.875rem",
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      )}
      <div style={{ display: "grid", gap: 10 }}>
        {rows.map((row) => {
          const chosen = selectedId === row.id;
          return (
            <div
              key={row.id}
              style={{
                border: `2px solid ${chosen ? accent : "#e2e8f0"}`,
                borderRadius: 14,
                padding: "14px 16px",
                background: chosen ? `${accent}0d` : "#fff",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <b style={{ fontSize: "0.9375rem" }}>
                  {row.title || (tierLabel(row.tier, locale) as string)}
                </b>
                {row.recommended && (
                  <span
                    style={{
                      background: `${accent}22`,
                      color: accent,
                      borderRadius: 999,
                      padding: "2px 9px",
                      fontSize: "0.875rem",
                      fontWeight: 800,
                    }}
                  >
                    {he ? "מומלץ" : "Recommended"}
                  </span>
                )}
                <span
                  style={{
                    marginInlineStart: "auto",
                    fontSize: "1.125rem",
                    fontWeight: 800,
                    color: accent,
                  }}
                >
                  {money(row.totalMinor, currency)}
                </span>
              </div>
              {row.description && (
                <div style={{ fontSize: "0.875rem", color: "#5c6675", marginTop: 4 }}>
                  {row.description}
                </div>
              )}
              {row.depositMinor > 0 && (
                <div style={{ fontSize: "0.875rem", color: "#5c6675", marginTop: 3 }}>
                  {he ? "מקדמה לתיאום" : "Deposit to schedule"}: {money(row.depositMinor, currency)}
                </div>
              )}
              {chosen ? (
                <div
                  style={{ marginTop: 10, color: "#15803d", fontWeight: 800, fontSize: "0.875rem" }}
                >
                  ✓ {he ? "זו הבחירה שלכם" : "This is your choice"}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!!busy || signed}
                  onClick={() => choose(row.id)}
                  style={{
                    marginTop: 10,
                    width: "100%",
                    background: signed ? "#cbd5e1" : accent,
                    color: "#fff",
                    border: "none",
                    padding: "12px 14px",
                    borderRadius: 11,
                    fontWeight: 800,
                    fontSize: "0.9375rem",
                    cursor: signed ? "not-allowed" : "pointer",
                  }}
                >
                  {busy === row.id
                    ? he
                      ? "שומרים…"
                      : "Saving…"
                    : he
                      ? "בחירה בחבילה זו"
                      : "Choose this package"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: "0.875rem", color: "#5c6675", marginTop: 8 }}>
        {signed
          ? he
            ? "ההצעה כבר אושרה — הבחירה נעולה."
            : "This estimate is approved — your choice is locked in."
          : he
            ? "אפשר לשנות את הבחירה עד לאישור ההצעה. הסכום למעלה מתעדכן לפי הבחירה."
            : "You can change your choice until you approve the estimate. The total above updates to match."}
      </div>
    </div>
  );
}
