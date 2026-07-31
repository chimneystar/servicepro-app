import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import InventoryClient, { type Item } from "@/components/InventoryClient";
import { getLocale } from "@/lib/locale-server";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const profile = await requireProfile();
  const he = (await getLocale()) === "he";
  if (profile.role === "tech") redirect("/");
  const supabase = await createClient();
  const [{ data: items }, { data: org }] = await Promise.all([
    // quantity_milli is the precise balance the ledger derives; quantity is the
    // rounded-down cache the low-stock alert has always used.
    supabase.from("inventory_items").select("id, name, sku, unit, quantity, quantity_milli, low_stock_threshold, cost_minor").order("name"),
    supabase.from("organizations").select("currency").single(),
  ]);
  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>{he ? "מלאי" : "Inventory"}</h1>
      <p style={{ color: "#5c6675", fontSize: 13, marginBottom: 14 }}>{he ? "מעקב אחרי חלקים וחומרים, כולל התראה לפני שנגמר. כל שינוי במלאי נרשם ביומן." : "Track parts and materials, including low-stock alerts. Every change is recorded in the stock ledger."}</p>
      <InventoryClient items={(items ?? []) as Item[]} currency={org?.currency ?? "USD"} />
    </div>
  );
}
