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

/**
 * PostgREST caps a response at a default 1000 rows. Every branch of this export
 * relied on a single unpaginated request, so any business past that count sent
 * its accountant a SILENTLY INCOMPLETE ledger — no error, no warning, just
 * missing money. This pages until the source is exhausted.
 */
const PAGE = 1000;
async function fetchAllPages<T>(build: (fromRow: number, toRow: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < PAGE) return all;
    if (page > 500) throw new Error("export_too_large"); // 500k rows: refuse rather than hang
  }
}

/** Export invoices, payments, or expenses to a QuickBooks-friendly CSV. */
export async function exportCsv(kind: "invoices" | "payments" | "expenses", from: string, to: string): Promise<ExportResult> {
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
    return { ok: false, error: "invalid_range" };
  }
  const supabase = await createClient();

  try {
    if (kind === "invoices") {
      const data = await fetchAllPages<any>((a, b) => supabase.from("invoices")
        .select("number, issue_date, status, total_minor, tax_rate_bps, discount_minor, customers(name)")
        .is("deleted_at", null).gte("issue_date", from).lte("issue_date", to).order("number").range(a, b));
      const rows = data.map((i: any) => [i.number, i.issue_date, i.customers?.name ?? "", i.status, money(i.total_minor)]);
      return { ok: true, filename: `invoices_${from}_${to}.csv`, csv: toCsv(["Invoice #", "Date", "Customer", "Status", "Total"], rows) };
    }

    if (kind === "payments") {
      // Filtered in SQL, not in JavaScript after the fact. The old code fetched
      // every payment ever recorded and then filtered by date in memory, so the
      // 1000-row cap silently decided which payments the accountant saw.
      const data = await fetchAllPages<any>((a, b) => supabase.from("payments")
        .select("amount_minor, base_amount_minor, refunded_minor, normalized_status, method, reference, paid_at, invoices(number, customers(name))")
        .gte("paid_at", `${from}T00:00:00`).lte("paid_at", `${to}T23:59:59`)
        .order("paid_at").range(a, b));
      const rows = data.map((p: any) => [
        (p.paid_at ?? "").slice(0, 10),
        p.invoices?.number ?? "",
        p.invoices?.customers?.name ?? "",
        p.method ?? "",
        p.reference ?? "",
        money(Number(p.base_amount_minor ?? p.amount_minor ?? 0)),
        money(Number(p.refunded_minor ?? 0)),
        // Status matters to an accountant: a declined card and a settled payment
        // were previously indistinguishable in this file.
        p.normalized_status ?? p.status ?? "",
      ]);
      return {
        ok: true,
        filename: `payments_${from}_${to}.csv`,
        csv: toCsv(["Date", "Invoice #", "Customer", "Method", "Reference", "Amount", "Refunded", "Status"], rows),
      };
    }

    const data = await fetchAllPages<any>((a, b) => supabase.from("expenses")
      .select("expense_date, category, vendor, amount_minor, notes")
      .gte("expense_date", from).lte("expense_date", to).order("expense_date").range(a, b));
    const rows = data.map((e: any) => [e.expense_date, e.category, e.vendor ?? "", money(e.amount_minor), e.notes ?? ""]);
    return { ok: true, filename: `expenses_${from}_${to}.csv`, csv: toCsv(["Date", "Category", "Vendor", "Amount", "Notes"], rows) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[export] ${kind} failed:`, message);
    return { ok: false, error: message === "export_too_large" ? "export_too_large" : "export_failed" };
  }
}
