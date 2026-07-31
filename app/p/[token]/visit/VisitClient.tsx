"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
// @ts-ignore -- pure logic, proven both ways in tests/appointments.test.mjs
import { arrivalState, describeArrival } from "@/lib/core/appointments.mjs";

/**
 * Confirm, decline, and watch the technician arrive.
 *
 * The answer goes to `respond_to_appointment`, a token-scoped security-definer
 * RPC. Declining deliberately does NOT cancel the job: a cancellation moves a
 * technician's whole day and interacts with the double-book constraint, so it
 * is an operational decision. The refusal is recorded loudly and the business
 * calls back — which is also what stops a leaked link from wiping a schedule.
 */
export default function VisitClient({ token, appointment, locale, accent }: {
  token: string; appointment: any; locale: "en" | "he"; accent: string;
}) {
  const he = locale === "he";
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);

  const state = arrivalState(appointment) as string;
  const message = describeArrival(appointment, { locale }) as string;
  const answered = appointment.confirmation === "confirmed" || appointment.confirmation === "declined";
  const closed = appointment.status === "done" || appointment.status === "cancelled";

  const window = [appointment.start_time, appointment.end_time]
    .filter(Boolean).map((value: string) => String(value).slice(0, 5)).join("–");

  async function respond(response: "confirmed" | "declined") {
    setBusy(true); setError(null);
    try {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("respond_to_appointment", {
        p_token: token, p_response: response, p_note: note.trim() || null,
      });
      const result = data as any;
      if (rpcError || !result?.ok) {
        setError(result?.error === "link_expired"
          ? (he ? "הקישור פג תוקף. אנא התקשרו אלינו." : "This link has expired. Please call us.")
          : result?.error === "appointment_closed"
            ? (he ? "הפגישה כבר נסגרה." : "This appointment is already closed.")
            : (he ? "לא הצלחנו לשמור את התשובה. נסו שוב." : "We couldn't save your answer. Please try again."));
        return;
      }
      setAsking(false);
      router.refresh();
    } catch {
      setError(he ? "לא הצלחנו לשמור את התשובה." : "We couldn't save your answer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ background: accent, color: "#fff", padding: "22px 24px" }}>
        <div style={{ fontSize: "1.25rem", fontWeight: 800 }}>{appointment.org?.name}</div>
        {appointment.org?.tagline && <div style={{ fontSize: "0.8125rem", opacity: .85 }}>{appointment.org.tagline}</div>}
      </div>

      <div style={{ padding: "22px 24px" }}>
        <div style={{ fontSize: "0.8125rem", color: "#94a3b8", fontWeight: 800, letterSpacing: .6, textTransform: "uppercase" }}>
          {he ? "הביקור שלכם" : "Your visit"}
        </div>
        <div style={{ fontSize: "1.25rem", fontWeight: 800, marginTop: 4 }}>{appointment.service}</div>
        <div style={{ fontSize: "0.875rem", color: "#5c6675", marginTop: 2 }}>
          {appointment.date}{window ? ` · ${window}` : ""}
          {appointment.technician ? ` · ${he ? "טכנאי" : "Technician"}: ${appointment.technician}` : ""}
        </div>

        {/* Arrival — the half of "on my way" that never existed. */}
        <div style={{
          marginTop: 16, borderRadius: 12, padding: "14px 16px", fontSize: "0.9375rem", fontWeight: 700,
          background: state === "arrived" || state === "completed" ? "#e6f6ec" : state === "due" ? "#fff5e0" : "#f4f7fb",
          color: state === "arrived" || state === "completed" ? "#15803d" : state === "due" ? "#a15c07" : "#334155",
        }}>
          {message}
        </div>

        {/* Confirm / decline */}
        {!closed && (
          <div style={{ marginTop: 18 }}>
            {answered ? (
              <div style={{
                borderRadius: 12, padding: "12px 14px", fontWeight: 700, fontSize: "0.875rem",
                background: appointment.confirmation === "confirmed" ? "#e6f6ec" : "#fdeaea",
                color: appointment.confirmation === "confirmed" ? "#15803d" : "#dc2626",
              }}>
                {appointment.confirmation === "confirmed"
                  ? (he ? "✓ אישרתם את הפגישה. תודה!" : "✓ You confirmed this appointment. Thank you!")
                  : (he ? "ביקשתם לשנות את המועד — ניצור קשר בהקדם." : "You asked to change this appointment — we will call you shortly.")}
                <div style={{ fontWeight: 400, fontSize: "0.8125rem", marginTop: 4 }}>
                  {he ? "אפשר לשנות את התשובה למטה." : "You can change your answer below."}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: "0.875rem", color: "#334155", marginBottom: 8 }}>
                {he ? "המועד מתאים לכם?" : "Does this time still work for you?"}
              </div>
            )}

            {asking && (
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2}
                placeholder={he ? "מתי כן יתאים לכם? (לא חובה)" : "When would suit you better? (optional)"}
                style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: "0.875rem", marginTop: 10 }} />
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" disabled={busy} onClick={() => respond("confirmed")}
                style={{ flex: "1 1 150px", background: accent, color: "#fff", border: "none", padding: "13px 14px", borderRadius: 11, fontWeight: 800, fontSize: "0.9375rem", cursor: "pointer" }}>
                {he ? "מאשר/ת" : "Confirm"}
              </button>
              <button type="button" disabled={busy}
                onClick={() => (asking ? respond("declined") : setAsking(true))}
                style={{ flex: "1 1 150px", background: "#eef1f6", color: "#334155", border: "none", padding: "13px 14px", borderRadius: 11, fontWeight: 800, fontSize: "0.9375rem", cursor: "pointer" }}>
                {asking ? (he ? "שליחת הבקשה" : "Send request") : (he ? "צריך מועד אחר" : "Need a different time")}
              </button>
            </div>
          </div>
        )}

        {error && <div style={{ background: "#fdeaea", color: "#dc2626", padding: "10px 12px", borderRadius: 10, fontSize: "0.8125rem", marginTop: 12 }}>{error}</div>}

        {appointment.org?.phone && (
          <div style={{ marginTop: 16, textAlign: "center", fontSize: "0.875rem" }}>
            <a href={`tel:${String(appointment.org.phone).replace(/[^0-9+]/g, "")}`} style={{ color: accent, fontWeight: 700, textDecoration: "none" }}>
              {he ? "התקשרו אלינו" : "Call us"} · {appointment.org.phone}
            </a>
          </div>
        )}
        <div style={{ marginTop: 14, fontSize: "0.8125rem", color: "#94a3b8", textAlign: "center" }}>
          {he ? "קישור אישי לפגישה זו בלבד. הוא פג תוקף וניתן לביטול." : "A private link to this appointment only. It expires and can be revoked."}
        </div>
      </div>
    </div>
  );
}
