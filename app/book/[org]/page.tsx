import { createClient } from "@/lib/supabase/server";
import BookingForm from "./BookingForm";

export const dynamic = "force-dynamic";

export default async function BookingPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgId } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_booking_info", { p_org: orgId });
  const org: any = data;
  const accent = org?.accent_color || "#2563eb";

  if (!org) {
    return <div style={{ minHeight: "100vh", background: "#eef3fb", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <p style={{ color: "#5c6675" }}>This booking link is not valid.</p>
    </div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#eef3fb", borderTop: `5px solid ${accent}`, display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 14px" }}>
      <div style={{ width: "100%", maxWidth: 520 }}>
        <div style={{ background: `linear-gradient(135deg, ${accent}, ${accent})`, color: "#fff", borderRadius: "18px 18px 0 0", padding: "24px 26px", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, overflow: "hidden" }}>
            {org.logo_url ? <img src={org.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "❄️"}
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{org.name}</div>
            <div style={{ fontSize: 13, opacity: .9 }}>{org.tagline || "Request an appointment"}</div>
          </div>
        </div>
        <div style={{ background: "#fff", borderRadius: "0 0 18px 18px", padding: 22, boxShadow: "0 20px 60px rgba(15,42,94,.15)" }}>
          <BookingForm orgId={orgId} accent={accent} phone={org.phone} />
        </div>
        <p style={{ textAlign: "center", color: "#94a3b8", fontSize: 12, marginTop: 14 }}>Powered by {org.name}</p>
      </div>
    </div>
  );
}
