import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import VisitClient from "./VisitClient";

export const dynamic = "force-dynamic";

/**
 * The customer's appointment page (remediation plan 6c.8).
 *
 * Two defects, one page. Reminders were one-way SMS, so a customer who could
 * not make the appointment had no way to say so — they simply were not there.
 * And the "on my way" text pointed at nothing, so the message meant to prevent
 * the "where are they?" call was the thing that provoked it.
 *
 * WHAT THIS PAGE MAY SEE. `public_appointment` (db/039 §5) returns the service,
 * the date and arrival window, the confirmation state, the technician's FIRST
 * NAME and the arrival timestamps — and the business's own public details. It
 * does NOT return a price, an invoice, a document token, an address, a phone
 * number or any other job. The token expires, is revocable, and revocation is
 * checked before expiry so a leaked link can be killed immediately. Those are
 * the rules migration 023 §10 had to retrofit onto the portal token; here they
 * are the starting point.
 */
export default async function AppointmentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const locale = await getLocale();
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_appointment", { p_token: token });
  const appointment: any = data;

  if (!appointment) {
    return (
      <Shell accent="#0f2a5e">
        <p style={{ color: "#5c6675", textAlign: "center" }}>
          {locale === "he"
            ? "הקישור הזה אינו תקף, פג תוקפו או בוטל."
            : "This link is not valid, has expired, or has been revoked."}
        </p>
      </Shell>
    );
  }

  const accent = appointment.org?.accent_color || "#2563eb";
  return (
    <Shell accent={accent}>
      <VisitClient
        token={token}
        appointment={appointment}
        locale={locale === "he" ? "he" : "en"}
        accent={accent}
      />
    </Shell>
  );
}

function Shell({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#eef3fb",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "24px 14px",
        borderTop: `5px solid ${accent}`,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 20,
          boxShadow: "0 24px 70px rgba(15,42,94,.18)",
          overflow: "hidden",
          maxWidth: 520,
          width: "100%",
        }}
      >
        {children}
      </div>
    </div>
  );
}
