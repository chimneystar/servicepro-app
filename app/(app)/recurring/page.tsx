import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import RecurringClient, { type Plan } from "@/components/RecurringClient";

export const dynamic = "force-dynamic";

export default async function RecurringPage() {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const supabase = createClient();
  const [{ data: plans }, { data: customers }, { data: techs }] = await Promise.all([
    supabase.from("recurring_plans").select("id, customer_id, service, interval_months, price_minor, next_due, assigned_to, customers(name)").order("next_due"),
    supabase.from("customers").select("id, name").is("deleted_at", null).eq("archived", false).order("name"),
    supabase.from("profiles").select("id, full_name").eq("active", true).order("full_name"),
  ]);
  const { data: org } = await supabase.from("organizations").select("currency").single();

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Maintenance plans</h1>
      <p style={{ color: "#5c6675", fontSize: 13, marginBottom: 14 }}>Auto-repeat recurring visits (annual chimney & AC service) so clients never lapse.</p>
      <RecurringClient
        plans={(plans ?? []).map((p: any) => ({ id: p.id, customer_id: p.customer_id, customer_name: p.customers?.name ?? "—", service: p.service, interval_months: p.interval_months, price_minor: p.price_minor, next_due: p.next_due, assigned_to: p.assigned_to })) as Plan[]}
        customers={(customers ?? []).map((c) => ({ id: c.id, label: c.name }))}
        techs={(techs ?? []).map((t) => ({ id: t.id, label: t.full_name || "Tech" }))}
        currency={org?.currency ?? "USD"} />
    </div>
  );
}
