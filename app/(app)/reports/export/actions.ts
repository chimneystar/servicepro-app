"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";
// @ts-ignore -- shared JS module, proven both ways in tests/accounting-sync.test.mjs
import {
  ACCOUNTING_SYNC_STATUS, externalRef, isAccountingTarget, mapRow, reconcile, toCsv as toAccountingCsv,
} from "@/lib/core/accounting.mjs";
// @ts-ignore -- the SHARED revenue engine; tax is derived from it, never re-derived here
import { invoiceRevenueExTaxMinor } from "@/lib/core/reporting.mjs";

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

// =====================================================================
//  ACCOUNTING SYNC — PARTIAL (ledger 6c.12). READ THE STATUS BLOCK.
//
//  This is NOT a QuickBooks or Xero integration. There is no OAuth app, no
//  token store and no API client anywhere in this product, because no developer
//  credentials for either provider exist in this environment and an integration
//  that has never authenticated must not be shipped — a bookkeeping sync that
//  silently fails is discovered at year end.
//
//  What IS here is the part that is real without credentials, and the part the
//  manual monthly CSV re-import genuinely lacked:
//    * a stable external reference per row, so a re-import updates instead of
//      duplicating (the old file had no such column at all);
//    * the importers' own column headers, so the file drops straight in;
//    * a TWO-WAY MATCH against what the ledger reports back, which surfaces the
//      one thing re-import could never see — a row present on both sides with
//      different money.
//
//  `exportCsv` above is UNCHANGED and still produces the plain files.
// =====================================================================

export const accountingSyncStatus = async () => ACCOUNTING_SYNC_STATUS;

export type AccountingExportResult = ExportResult & { rows?: number; totalMinor?: number };

/**
 * Export a period in a target ledger's own import format, and RECORD what was
 * exported so the same rows carry the same reference next month.
 */
export async function exportForAccounting(
  target: "quickbooks" | "xero",
  kind: "invoices" | "payments" | "expenses",
  from: string, to: string,
): Promise<AccountingExportResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }
  if (!isAccountingTarget(target)) return { ok: false, error: "unknown_target" };
  if (!["invoices", "payments", "expenses"].includes(kind)) return { ok: false, error: "unknown_kind" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
    return { ok: false, error: "invalid_range" };
  }

  const supabase = await createClient();
  try {
    const mapped: Record<string, string>[] = [];
    const ledger: { sourceType: string; sourceId: string; ref: string; amountMinor: number }[] = [];

    if (kind === "invoices") {
      const invoices = await fetchAllPages<any>((a, b) => supabase.from("invoices")
        .select("id, number, issue_date, total_minor, discount_minor, tax_rate_bps, customers(name)")
        .is("deleted_at", null).gte("issue_date", from).lte("issue_date", to).order("number").range(a, b));
      const ids = invoices.map((row: any) => row.id);
      const items = ids.length
        ? await fetchAllPages<any>((a, b) => supabase.from("invoice_items")
            .select("invoice_id, qty_milli, unit_price_minor, cost_minor, taxable").in("invoice_id", ids).range(a, b))
        : [];
      const byInvoice: Record<string, any[]> = {};
      for (const item of items) (byInvoice[item.invoice_id] ||= []).push(item);

      for (const invoice of invoices) {
        // Tax comes from the SHARED reporting engine, not a second formula: it
        // is total minus revenue-ex-tax, computed by the same code /reports uses.
        const exTax = invoiceRevenueExTaxMinor(invoice, byInvoice[invoice.id] ?? []) as number;
        const taxMinor = Number(invoice.total_minor ?? 0) - exTax;
        mapped.push(mapRow(target, "invoices", {
          id: invoice.id, number: invoice.number, customer_name: invoice.customers?.name ?? "",
          issue_date: invoice.issue_date, description: "Services rendered",
          qty_milli: 1000, unit_price_minor: exTax, line_total_minor: exTax,
          tax_minor: taxMinor, total_minor: invoice.total_minor, taxable: taxMinor > 0,
        }) as Record<string, string>);
        ledger.push({ sourceType: "invoice", sourceId: invoice.id, ref: externalRef("invoice", invoice.id) as string, amountMinor: Number(invoice.total_minor ?? 0) });
      }
    } else if (kind === "payments") {
      const payments = await fetchAllPages<any>((a, b) => supabase.from("payments")
        .select("id, amount_minor, base_amount_minor, refunded_minor, method, paid_at, invoices(number, customers(name))")
        .gte("paid_at", `${from}T00:00:00`).lte("paid_at", `${to}T23:59:59`).order("paid_at").range(a, b));
      for (const payment of payments) {
        const net = Number(payment.base_amount_minor ?? payment.amount_minor ?? 0) - Number(payment.refunded_minor ?? 0);
        mapped.push(mapRow(target, "payments", {
          id: payment.id, customer_name: payment.invoices?.customers?.name ?? "",
          invoice_number: payment.invoices?.number ?? "", paid_at: payment.paid_at,
          method: payment.method ?? "", base_amount_minor: payment.base_amount_minor ?? payment.amount_minor,
          refunded_minor: payment.refunded_minor,
        }) as Record<string, string>);
        ledger.push({ sourceType: "payment", sourceId: payment.id, ref: externalRef("payment", payment.id) as string, amountMinor: net });
      }
    } else {
      const expenses = await fetchAllPages<any>((a, b) => supabase.from("expenses")
        .select("id, expense_date, category, vendor, amount_minor")
        .gte("expense_date", from).lte("expense_date", to).order("expense_date").range(a, b));
      for (const expense of expenses) {
        mapped.push(mapRow(target, "expenses", expense) as Record<string, string>);
        ledger.push({ sourceType: "expense", sourceId: expense.id, ref: externalRef("expense", expense.id) as string, amountMinor: Number(expense.amount_minor ?? 0) });
      }
    }

    const totalMinor = ledger.reduce((sum, row) => sum + row.amountMinor, 0);

    // Record the batch and its rows. `accounting_export_rows` is unique on
    // (organization_id, target, source_type, source_id), so re-exporting the
    // same month re-uses the same reference rather than minting a new one —
    // which is what makes the re-import idempotent.
    const { data: batch, error: batchError } = await supabase.from("accounting_exports").insert({
      organization_id: profile.organization_id, target, kind,
      period_start: from, period_end: to, row_count: ledger.length, total_minor: totalMinor,
      created_by: profile.id,
    }).select("id").maybeSingle();
    if (batchError) console.error(`[export] could not record the ${target} batch: ${batchError.message}`);

    if (ledger.length) {
      const { error: rowsError } = await supabase.from("accounting_export_rows").upsert(
        ledger.map((row) => ({
          organization_id: profile.organization_id, export_id: batch?.id ?? null, target,
          source_type: row.sourceType, source_id: row.sourceId,
          external_ref: row.ref, amount_minor: row.amountMinor,
          exported_on: new Date().toISOString().slice(0, 10),
        })),
        { onConflict: "organization_id,target,source_type,source_id" },
      );
      if (rowsError) {
        // Loud, because an export whose references were not recorded cannot be
        // reconciled afterwards — the operator must know before they import it.
        console.error(`[export] could not record ${target} export references: ${rowsError.message}`);
        return { ok: false, error: `The file was built but its references could not be recorded, so it cannot be reconciled later: ${rowsError.message}` };
      }
    }

    return {
      ok: true,
      rows: ledger.length,
      totalMinor,
      filename: `${target}_${kind}_${from}_${to}.csv`,
      csv: toAccountingCsv(target, kind, mapped) as string,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[export] accounting ${target}/${kind} failed:`, message);
    return { ok: false, error: message === "export_too_large" ? "export_too_large" : message };
  }
}

export type ReconcileResult = {
  ok: boolean;
  error?: string;
  balanced?: boolean;
  matched?: number;
  missingRemote?: { ref: string; amountMinor: number }[];
  missingLocal?: { ref: string; amountMinor: number }[];
  amountMismatch?: { ref: string; localMinor: number; remoteMinor: number; differenceMinor: number }[];
  localTotalMinor?: number;
  remoteTotalMinor?: number;
};

/**
 * Two-way match against a CSV exported from the ledger.
 *
 * The bookkeeper exports their side (any file with a reference column and an
 * amount column), and this reports THREE distinct answers: rows we sent that
 * never landed, money in the ledger this product does not have, and — the one
 * that matters — rows present on both sides that DISAGREE. Nobody was checking
 * the third, which is how a tax return quietly misstates.
 *
 * When an API integration eventually exists, the remote side comes from it
 * instead of from a file; the comparison itself does not change.
 */
export async function reconcileAgainstLedger(target: "quickbooks" | "xero", csvText: string): Promise<ReconcileResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }
  if (!isAccountingTarget(target)) return { ok: false, error: "unknown_target" };

  const text = String(csvText ?? "").trim();
  if (!text) return { ok: false, error: "Paste or upload the ledger's own export first." };
  if (text.length > 4_000_000) return { ok: false, error: "That file is too large to reconcile in one pass." };

  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return { ok: false, error: "That file has no data rows." };

  // Find the reference and amount columns by name rather than by position, so
  // an exporter that reorders its columns does not silently reconcile the wrong
  // two fields against each other.
  const header = splitCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase());
  const refIndex = header.findIndex((cell) => /(reference|privatenote|memo|description|ref)/.test(cell));
  const amountIndex = header.findIndex((cell) => /(amount|total|debit|credit)/.test(cell));
  if (refIndex < 0 || amountIndex < 0) {
    return { ok: false, error: "Could not find a reference column and an amount column in that file." };
  }

  const remote: { ref: string; amountMinor: number }[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const raw = String(cells[refIndex] ?? "");
    const match = raw.match(/SP-(?:INVOICE|PAYMENT|EXPENSE)-[0-9a-f-]{36}/i);
    if (!match) continue; // a row this product did not originate; not our business
    const amount = Math.round(Number(String(cells[amountIndex] ?? "0").replace(/[^0-9.\-]/g, "")) * 100);
    remote.push({ ref: match[0].toUpperCase(), amountMinor: Number.isFinite(amount) ? amount : 0 });
  }

  const supabase = await createClient();
  // Paged, like every other read in this file: a business past 1000 exported
  // rows would otherwise reconcile against a silently truncated local side and
  // report hundreds of phantom "missing from the ledger" findings.
  const local = await fetchAllPages<{ external_ref: string; amount_minor: number }>((a, b) =>
    supabase.from("accounting_export_rows")
      .select("external_ref, amount_minor").eq("target", target).range(a, b));

  const result = reconcile(
    local.map((row) => ({ ref: row.external_ref, amountMinor: row.amount_minor })),
    remote,
  ) as {
    matched: unknown[]; missingRemote: { ref: string; amountMinor: number }[];
    missingLocal: { ref: string; amountMinor: number }[];
    amountMismatch: { ref: string; localMinor: number; remoteMinor: number; differenceMinor: number }[];
    balanced: boolean; localTotalMinor: number; remoteTotalMinor: number;
  };

  return {
    ok: true,
    balanced: result.balanced,
    matched: result.matched.length,
    missingRemote: result.missingRemote.slice(0, 100),
    missingLocal: result.missingLocal.slice(0, 100),
    amountMismatch: result.amountMismatch.slice(0, 100),
    localTotalMinor: result.localTotalMinor,
    remoteTotalMinor: result.remoteTotalMinor,
  };
}

/** Minimal RFC 4180 row splitter — quoted cells may contain commas. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ",") { cells.push(current); current = ""; }
    else current += char;
  }
  cells.push(current);
  return cells;
}
