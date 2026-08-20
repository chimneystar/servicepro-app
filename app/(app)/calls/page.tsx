import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { createClient } from "@/lib/supabase/server";
import CallCenter, { type CallRow, type TrackingNumberRow } from "@/components/CallCenter";

export const dynamic = "force-dynamic";

export default async function CallsPage() {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/tech");
  const locale = await getLocale();
  const supabase = await createClient();
  const [{ data: calls }, { data: numbers }, { data: customers }, { data: jobs }, { data: org }] =
    await Promise.all([
      supabase
        .from("call_events")
        .select(
          "id,direction,status,from_number,to_number,reason,outcome,notes,needs_follow_up,duration_seconds,started_at,customers(name),jobs(service),tracked_phone_numbers(label,lead_source)",
        )
        .order("started_at", { ascending: false })
        .limit(250),
      supabase
        .from("tracked_phone_numbers")
        .select(
          "id,phone_number,label,lead_source,campaign,destination_number,active,recording_enabled",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("customers")
        .select("id,name,phone")
        .is("deleted_at", null)
        .order("name")
        .limit(1000),
      supabase
        .from("jobs")
        .select("id,service,customer_id,scheduled_date,customers!jobs_customer_org_fk(name)")
        .is("deleted_at", null)
        .order("scheduled_date", { ascending: false })
        .limit(300),
      supabase.from("organizations").select("phone").single(),
    ]);
  return (
    <CallCenter
      locale={locale}
      calls={(calls ?? []) as CallRow[]}
      numbers={(numbers ?? []) as TrackingNumberRow[]}
      customers={(customers ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone ?? "",
      }))}
      jobs={(jobs ?? []).map((row) => ({
        id: row.id,
        customerId: row.customer_id,
        label: `${row.service} · ${relationName(row.customers)}`,
      }))}
      businessPhone={org?.phone ?? ""}
      providerReady={Boolean(
        process.env.TWILIO_AUTH_TOKEN && process.env.SUPABASE_SERVICE_ROLE_KEY,
      )}
    />
  );
}

function relationName(value: { name: string } | { name: string }[] | null) {
  return Array.isArray(value) ? (value[0]?.name ?? "") : (value?.name ?? "");
}
