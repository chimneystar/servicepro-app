"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendAppointmentConfirmation, revokeAppointmentLink, markArrived } from "./actions";
import type { Locale } from "@/lib/i18n";

/**
 * Appointment confirmation and arrival tracking (remediation plan 6c.8).
 *
 * Reminders were one-way SMS: the customer could not confirm, could not say
 * "not that day", and the "on my way" message pointed nowhere. Those are the
 * top two drivers of no-shows and of inbound "where are they?" calls.
 *
 * The link is expiring and revocable and shows one appointment only — the rules
 * migration 023 §10 had to retrofit onto the portal token, applied here from
 * the start.
 */
export default function JobAppointment({
  locale,
  jobId,
  confirmation,
  confirmedAt,
  declinedAt,
  note,
  link,
  arrivedAt,
  onMyWayAt,
}: {
  locale: Locale;
  jobId: string;
  confirmation: string;
  confirmedAt: string | null;
  declinedAt: string | null;
  note: string | null;
  link: { token: string; expiresAt: string } | null;
  arrivedAt: string | null;
  onMyWayAt: string | null;
}) {
  const he = locale === "he";
  const router = useRouter();
  const [busy, start] = useTransition();
  const [url, setUrl] = useState<string | null>(link ? `/p/${link.token}/visit` : null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tone =
    confirmation === "confirmed"
      ? { bg: "#e6f6ec", fg: "#15803d" }
      : confirmation === "declined"
        ? { bg: "#fdeaea", fg: "#dc2626" }
        : { bg: "#eef1f6", fg: "#57606f" };
  const label =
    confirmation === "confirmed"
      ? he
        ? "הלקוח אישר"
        : "Customer confirmed"
      : confirmation === "declined"
        ? he
          ? "הלקוח ביקש לשנות"
          : "Customer declined"
        : he
          ? "ממתין לאישור הלקוח"
          : "Awaiting customer confirmation";
  const stamp =
    confirmation === "confirmed" ? confirmedAt : confirmation === "declined" ? declinedAt : null;

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 14,
        padding: 16,
        marginTop: 12,
      }}
    >
      <div style={{ fontWeight: 800, fontSize: "0.875rem", marginBottom: 8 }}>
        {he ? "אישור הפגישה ומעקב הגעה" : "Appointment confirmation & arrival"}
      </div>
      <div
        style={{
          background: tone.bg,
          color: tone.fg,
          borderRadius: 10,
          padding: "9px 12px",
          fontSize: "0.8125rem",
          fontWeight: 700,
        }}
      >
        {label}
        {stamp ? ` · ${new Date(stamp).toLocaleString(he ? "he-IL" : "en-US")}` : ""}
      </div>
      {note && (
        <div style={{ fontSize: "0.8125rem", color: "#5c6675", marginTop: 6 }}>
          {he ? "הערת הלקוח" : "Customer note"}: {note}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <button
          type="button"
          disabled={busy}
          style={btn}
          onClick={() =>
            start(async () => {
              setError(null);
              setNotice(null);
              const result = await sendAppointmentConfirmation(jobId);
              if (!result.ok) {
                setError(result.error ?? null);
                return;
              }
              setUrl(result.url ?? null);
              setNotice(
                result.sent
                  ? he
                    ? "נשלחה בקשת אישור ללקוח."
                    : "Confirmation request sent to the customer."
                  : (result.notice ?? null),
              );
              router.refresh();
            })
          }
        >
          {he ? "שליחת בקשת אישור" : "Send confirmation request"}
        </button>
        {url && (
          <button
            type="button"
            disabled={busy}
            style={ghost}
            onClick={() =>
              start(async () => {
                setError(null);
                setNotice(null);
                const result = await revokeAppointmentLink(jobId);
                if (!result.ok) {
                  setError(result.error ?? null);
                  return;
                }
                setUrl(null);
                setNotice(
                  he ? "הקישור בוטל ואינו פעיל יותר." : "The link is revoked and no longer works.",
                );
                router.refresh();
              })
            }
          >
            {he ? "ביטול הקישור" : "Revoke link"}
          </button>
        )}
        {onMyWayAt && !arrivedAt && (
          <button
            type="button"
            disabled={busy}
            style={ghost}
            onClick={() =>
              start(async () => {
                await markArrived(jobId);
                router.refresh();
              })
            }
          >
            {he ? "סימון הגעה" : "Mark arrived"}
          </button>
        )}
      </div>

      {url && (
        <div style={{ marginTop: 10, fontSize: "0.8125rem" }}>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#2563eb", fontWeight: 700, wordBreak: "break-all" }}
          >
            {url}
          </a>
          <div style={{ color: "#5c6675", marginTop: 3 }}>
            {he
              ? "קישור זה פג תוקף ואפשר לבטלו. הוא מציג רק את הפגישה הזו — לא מחיר, לא מסמך ולא עבודה אחרת."
              : "This link expires and can be revoked. It shows this appointment only — no price, no document, no other job."}
            {link
              ? ` ${he ? "בתוקף עד" : "Valid until"} ${new Date(link.expiresAt).toLocaleDateString(he ? "he-IL" : "en-US")}.`
              : ""}
          </div>
        </div>
      )}
      {notice && (
        <div
          style={{
            background: "#fff5e0",
            color: "#a15c07",
            padding: "9px 12px",
            borderRadius: 10,
            fontSize: "0.8125rem",
            marginTop: 10,
          }}
        >
          {notice}
        </div>
      )}
      {error && (
        <div
          style={{
            background: "#fdeaea",
            color: "#dc2626",
            padding: "9px 12px",
            borderRadius: 10,
            fontSize: "0.8125rem",
            marginTop: 10,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  padding: "9px 14px",
  borderRadius: 10,
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "0.875rem",
};
const ghost: React.CSSProperties = {
  background: "#eef1f6",
  color: "#334155",
  border: "none",
  padding: "9px 14px",
  borderRadius: 10,
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "0.875rem",
};
