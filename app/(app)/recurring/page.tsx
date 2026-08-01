import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import RecurringClient, { type Plan } from "@/components/RecurringClient";
import { getLocale } from "@/lib/locale-server";
import * as operationsRepo from "@/lib/data/operations";
import * as customersRepo from "@/lib/data/customers";
import * as profilesRepo from "@/lib/data/profiles";

export const dynamic = "force-dynamic";

export default async function RecurringPage() {
  const profile = await requireProfile();
  const he = (await getLocale()) === "he";
  if (profile.role === "tech") redirect("/");
  const supabase = await createClient();
  const [plans, customers, techs] = await Promise.all([
    operationsRepo.listRecurringPlans(supabase),
    customersRepo.listPickable(supabase),
    profilesRepo.listActive(supabase),
  ]);
  const { data: org } = await supabase.from("organizations").select("currency").single();

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: 4 }}>
        {he ? "עבודות חוזרות" : "Recurring work"}
      </h1>
      <p style={{ color: "#5c6675", fontSize: "0.8125rem", marginBottom: 14 }}>
        {he
          ? "עבודות תחזוקה שחוזרות אוטומטית במועד שבוחרים."
          : "Maintenance visits that repeat automatically on your schedule."}
      </p>
      <RecurringClient
        plans={
          plans.map((p: any) => ({
            id: p.id,
            customer_id: p.customer_id,
            customer_name: p.customers?.name ?? "—",
            service: p.service,
            interval_months: p.interval_months,
            price_minor: p.price_minor,
            next_due: p.next_due,
            assigned_to: p.assigned_to,
          })) as Plan[]
        }
        customers={customers.map((c) => ({ id: c.id, label: c.name }))}
        techs={techs.map((t) => ({
          id: t.id,
          label: t.full_name || (he ? "טכנאי" : "Technician"),
        }))}
        currency={org?.currency ?? "USD"}
        today={new Date().toISOString().slice(0, 10)}
      />
    </div>
  );
}
