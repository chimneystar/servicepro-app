import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { monthBounds } from "@/lib/format";
import { redirect } from "next/navigation";
import ExpensesClient from "./ExpensesClient";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const locale = getLocale();
  const supabase = createClient();
  const { start, end } = monthBounds();

  const [{ data: expenses }, { data: org }, { data: paidInv }] = await Promise.all([
    supabase.from("expenses").select("id, expense_date, category, vendor, amount_minor").order("expense_date", { ascending: false }),
    supabase.from("organizations").select("currency").single(),
    supabase.from("invoices").select("total_minor, issue_date").eq("status", "paid").is("deleted_at", null).gte("issue_date", start).lte("issue_date", end),
  ]);

  const list = expenses ?? [];
  const monthTotal = list.filter((e) => e.expense_date >= start && e.expense_date <= end).reduce((s, e) => s + e.amount_minor, 0);
  const monthSales = (paidInv ?? []).reduce((s, i) => s + i.total_minor, 0);

  return <ExpensesClient locale={locale} expenses={list} currency={org?.currency ?? "USD"} monthTotal={monthTotal} net={monthSales - monthTotal} />;
}
