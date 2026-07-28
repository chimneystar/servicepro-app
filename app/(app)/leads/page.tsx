import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import LeadsBoard, { type Lead } from "./LeadsBoard";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const supabase = createClient();
  const { data } = await supabase.from("leads")
    .select("id, name, phone, email, address, city, service, notes, status, source, preferred_date, created_at")
    .order("created_at", { ascending: false });

  return (
    <div style={{ maxWidth: 780 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Leads</h1>
      <p style={{ color: "#5c6675", fontSize: 13, marginBottom: 14 }}>Appointment requests and your sales pipeline.</p>
      <LeadsBoard leads={(data ?? []) as Lead[]} orgId={profile.organization_id!} />
    </div>
  );
}
