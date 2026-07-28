"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";

export type ExportResult = { ok: boolean; csv?: string; filename?: string; error?: string };

function esc(v: any): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers: string[], rows: (any[])[]): string {
  return [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}
const money = (minor: number) => (minor / 100).toFixed(2);

/** Export invoices, payments, or expenses to a QuickBooks-friendly CSV. */
export async function exportCsv(kind: "invoices" | "payments" | "expenses", from: string, to: string): Promise<ExportResult> {
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }
  const supabase = await createClient();

  if (kind === "invoices") {
    const { data } = await supabase.from("invoices")
      .select("number, issue_date, status, total_minor, tax_rate_bps, discount_minor, customers(name)")
      .is("deleted_at", null).gte("issue_date", from).lte("issue_date", to).order("number");
    const rows = (data ?? []).map((i: any) => [i.number, i.issue_date, i.customers?.name ?? "", i.status, money(i.total_minor)]);
    return { ok: true, filename: `invoices_${from}_${to}.csv`, csv: toCsv(["Invoice #", "Date", "Customer", "Status", "Total"], rows) };
  }
  if (kind === "payments") {
    const { data } = await supabase.from("payments")
      .select("amount_minor, method, reference, paid_at, invoices(number, customers(name))")
      .order("paid_at");
    const rows = (data ?? [])
      .filter((p: any) => { const d = (p.paid_at ?? "").slice(0, 10); return d >= from && d <= to; })
      .map((p: any) => [(p.paid_at ?? "").slice(0, 10), p.invoices?.number ?? "", p.invoices?.customers?.name ?? "", p.method ?? "", p.reference ?? "", money(p.amount_minor)]);
    return { ok: true, filename: `payments_${from}_${to}.csv`, csv: toCsv(["Date", "Invoice #", "Customer", "Method", "Reference", "Amount"], rows) };
  }
  // expenses
  const { data } = await supabase.from("expenses")
    .select("expense_date, category, vendor, amount_minor, notes")
    .gte("expense_date", from).lte("expense_date", to).order("expense_date");
  const rows = (data ?? []).map((e: any) => [e.expense_date, e.category, e.vendor ?? "", money(e.amount_minor), e.notes ?? ""]);
  return { ok: true, filename: `expenses_${from}_${to}.csv`, csv: toCsv(["Date", "Category", "Vendor", "Amount", "Notes"], rows) };
}
