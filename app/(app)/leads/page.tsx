import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import LeadsBoard, { type Lead } from "./LeadsBoard";
import { getLocale } from "@/lib/locale-server";
import * as operationsRepo from "@/lib/data/operations";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const profile = await requireProfile();
  const he = (await getLocale()) === "he";
  if (profile.role === "tech") redirect("/");
  const supabase = await createClient();
  const data = await operationsRepo.listLeads(supabase);

  return (
    <div style={{ maxWidth: 780 }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: 4 }}>
        {he ? "לידים" : "Leads"}
      </h1>
      <p style={{ color: "#5c6675", fontSize: "0.8125rem", marginBottom: 14 }}>
        {he
          ? "פניות חדשות והתקדמות המכירה, עד שהלקוח קובע עבודה."
          : "New requests and sales progress until a job is booked."}
      </p>
      <LeadsBoard leads={data as Lead[]} orgId={profile.organization_id!} />
    </div>
  );
}
