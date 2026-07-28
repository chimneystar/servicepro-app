import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { redirect } from "next/navigation";
import PriceBookClient from "./PriceBookClient";

export const dynamic = "force-dynamic";

export default async function PriceBookPage() {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const locale = getLocale();
  const supabase = createClient();
  const [{ data: items }, { data: org }] = await Promise.all([
    supabase.from("price_book").select("id, name, category, unit, price_minor, cost_minor").order("name"),
    supabase.from("organizations").select("currency").single(),
  ]);
  return <PriceBookClient locale={locale} items={items ?? []} currency={org?.currency ?? "USD"} />;
}
