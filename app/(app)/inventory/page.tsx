import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import InventoryClient, { type Item } from "@/components/InventoryClient";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const supabase = createClient();
  const [{ data: items }, { data: org }] = await Promise.all([
    supabase.from("inventory_items").select("id, name, sku, unit, quantity, low_stock_threshold, cost_minor").order("name"),
    supabase.from("organizations").select("currency").single(),
  ]);
  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Inventory</h1>
      <p style={{ color: "#5c6675", fontSize: 13, marginBottom: 14 }}>Track parts & materials, with low-stock alerts.</p>
      <InventoryClient items={(items ?? []) as Item[]} currency={org?.currency ?? "USD"} />
    </div>
  );
}
