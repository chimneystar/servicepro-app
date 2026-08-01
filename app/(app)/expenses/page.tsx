import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { monthBounds } from "@/lib/format";
import { redirect } from "next/navigation";
import ExpensesClient from "./ExpensesClient";
import { listAllExpenses } from "@/lib/data/documents-extra";
import { listPaidTotalsInWindow } from "@/lib/data/invoices";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const locale = await getLocale();
  const supabase = await createClient();
  const { start, end } = monthBounds();

  const [list, { data: org }, paidInv] = await Promise.all([
    listAllExpenses(supabase),
    supabase.from("organizations").select("currency").single(),
    listPaidTotalsInWindow(supabase, start, end),
  ]);

  const monthTotal = list
    .filter((e) => e.expense_date >= start && e.expense_date <= end)
    .reduce((s, e) => s + e.amount_minor, 0);
  const monthSales = paidInv.reduce((s, i) => s + i.total_minor, 0);

  return (
    <ExpensesClient
      locale={locale}
      expenses={list}
      currency={org?.currency ?? "USD"}
      monthTotal={monthTotal}
      net={monthSales - monthTotal}
    />
  );
}
