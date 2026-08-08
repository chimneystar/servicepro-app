// Accounting sync groundwork (ledger 6c.12). Plain ESM.
//
// READ THIS BEFORE ASSUMING THIS FILE IS AN INTEGRATION. IT IS NOT.
// -----------------------------------------------------------------
// A real QuickBooks Online or Xero sync is an OAuth 2 app: a developer account,
// a registered client id and secret, a redirect URI on a real domain, a consent
// screen, refresh-token storage, and a sandbox company to prove writes against.
// None of that exists in this environment and none of it can be invented, so no
// OAuth flow, no token store and no API client is shipped here. Shipping one
// that had never authenticated would be exactly the "stored but inert" defect
// this branch exists to remove — worse, because bookkeeping that silently fails
// is discovered at year end.
//
// WHAT IS HERE is the part that is real without credentials, and the part that
// the manual CSV re-import actually got wrong:
//
//   * IDEMPOTENCY. `externalRef` is a stable, deterministic key per source row.
//     Re-exporting the same month twice produces the same keys, so the second
//     import updates instead of duplicating. The old CSV had no such column at
//     all: re-importing March booked March twice.
//   * MAPPING. `mapRow` produces the exact column headers QuickBooks' and
//     Xero's own invoice/payment import templates expect, so the file drops
//     straight in rather than being hand-massaged each month.
//   * TWO-WAY MATCH. `reconcile` compares what this product believes against
//     what the ledger reports back, and returns three DIFFERENT answers —
//     missing there, missing here, and present in both with different money.
//     The third is the one that matters and the one nobody was checking.
//
// Tests: tests/accounting-sync.test.mjs

export const ACCOUNTING_TARGETS = Object.freeze(["quickbooks", "xero"]);

export function isAccountingTarget(target) {
  return ACCOUNTING_TARGETS.includes(String(target ?? ""));
}

export const EXPORT_KINDS = Object.freeze(["invoices", "payments", "expenses"]);

/**
 * The idempotency key.
 *
 * Deterministic and namespaced, so it cannot collide with a reference the
 * business already uses, and stable across exports so a re-import matches
 * rather than duplicates. It THROWS on a missing id: a blank key would make
 * every row in the file look like the same row.
 */
export function externalRef(kind, id) {
  const k = String(kind ?? "").trim();
  const i = String(id ?? "").trim();
  if (!k || !i) throw new TypeError("externalRef needs a kind and an id");
  return `SP-${k.toUpperCase()}-${i}`;
}

/** Column templates, per target. These are the importers' own header names. */
const COLUMNS = {
  quickbooks: {
    invoices: [
      "InvoiceNo",
      "Customer",
      "InvoiceDate",
      "DueDate",
      "Item(Product/Service)",
      "ItemDescription",
      "ItemQuantity",
      "ItemRate",
      "ItemAmount",
      "Taxable",
      "TaxAmount",
      "TotalAmount",
      "PrivateNote",
    ],
    payments: [
      "RefNumber",
      "Customer",
      "PaymentDate",
      "PaymentMethod",
      "InvoiceNo",
      "Amount",
      "PrivateNote",
    ],
    expenses: ["RefNumber", "Payee", "ExpenseDate", "Category", "Amount", "Memo"],
  },
  xero: {
    invoices: [
      "*ContactName",
      "*InvoiceNumber",
      "*InvoiceDate",
      "*DueDate",
      "Description",
      "*Quantity",
      "*UnitAmount",
      "*AccountCode",
      "*TaxType",
      "TaxAmount",
      "Reference",
    ],
    payments: ["*ContactName", "*InvoiceNumber", "*Date", "*Amount", "Reference", "*AccountCode"],
    expenses: [
      "*ContactName",
      "*InvoiceNumber",
      "*InvoiceDate",
      "*DueDate",
      "Description",
      "*Quantity",
      "*UnitAmount",
      "*AccountCode",
      "Reference",
    ],
  },
};

export function columnsFor(target, kind) {
  if (!isAccountingTarget(target)) throw new TypeError(`unknown accounting target: ${target}`);
  if (!EXPORT_KINDS.includes(String(kind))) throw new TypeError(`unknown export kind: ${kind}`);
  return COLUMNS[target][kind].slice();
}

const finite = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Minor units → the decimal string an importer expects.
 *
 * Integer arithmetic all the way to the string: `(1999/100).toFixed(2)` is fine
 * but `(0.1+0.2)*100` is not, and an accounting file is the last place to
 * discover a float.
 */
export function decimalFromMinor(minor) {
  const value = Math.trunc(finite(minor));
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Milli-quantity → decimal string, same reasoning. */
export function decimalFromMilli(milli) {
  const value = Math.trunc(finite(milli));
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}${Math.trunc(abs / 1000)}.${String(abs % 1000).padStart(3, "0")}`;
}

/**
 * Map one source row to the target's columns.
 *
 * The `Reference` / `PrivateNote` column always carries `externalRef`, because
 * that is the only field both importers round-trip and it is what makes the
 * import idempotent.
 */
export function mapRow(target, kind, row) {
  const columns = columnsFor(target, kind);
  const ref = externalRef(
    kind === "invoices" ? "invoice" : kind === "payments" ? "payment" : "expense",
    row?.id,
  );
  const out = Object.fromEntries(columns.map((c) => [c, ""]));

  if (kind === "invoices") {
    const number = String(row?.number ?? "");
    const contact = String(row?.customer_name ?? "");
    const date = String(row?.issue_date ?? "").slice(0, 10);
    const due = String(row?.due_date ?? date).slice(0, 10);
    if (target === "quickbooks") {
      Object.assign(out, {
        InvoiceNo: number,
        Customer: contact,
        InvoiceDate: date,
        DueDate: due,
        "Item(Product/Service)": String(row?.item_name ?? "Services"),
        ItemDescription: String(row?.description ?? ""),
        ItemQuantity: decimalFromMilli(row?.qty_milli ?? 1000),
        ItemRate: decimalFromMinor(row?.unit_price_minor),
        ItemAmount: decimalFromMinor(row?.line_total_minor ?? row?.total_minor),
        Taxable: row?.taxable === false ? "N" : "Y",
        TaxAmount: decimalFromMinor(row?.tax_minor),
        TotalAmount: decimalFromMinor(row?.total_minor),
        PrivateNote: ref,
      });
    } else {
      Object.assign(out, {
        "*ContactName": contact,
        "*InvoiceNumber": number,
        "*InvoiceDate": date,
        "*DueDate": due,
        Description: String(row?.description ?? ""),
        "*Quantity": decimalFromMilli(row?.qty_milli ?? 1000),
        "*UnitAmount": decimalFromMinor(row?.unit_price_minor),
        "*AccountCode": String(row?.account_code ?? "200"),
        "*TaxType": row?.taxable === false ? "NONE" : "OUTPUT",
        TaxAmount: decimalFromMinor(row?.tax_minor),
        Reference: ref,
      });
    }
    return out;
  }

  if (kind === "payments") {
    const contact = String(row?.customer_name ?? "");
    const date = String(row?.paid_at ?? "").slice(0, 10);
    const amount = decimalFromMinor(
      finite(row?.base_amount_minor ?? row?.amount_minor) - finite(row?.refunded_minor),
    );
    if (target === "quickbooks") {
      Object.assign(out, {
        RefNumber: ref,
        Customer: contact,
        PaymentDate: date,
        PaymentMethod: String(row?.method ?? ""),
        InvoiceNo: String(row?.invoice_number ?? ""),
        Amount: amount,
        PrivateNote: ref,
      });
    } else {
      Object.assign(out, {
        "*ContactName": contact,
        "*InvoiceNumber": String(row?.invoice_number ?? ""),
        "*Date": date,
        "*Amount": amount,
        Reference: ref,
        "*AccountCode": String(row?.account_code ?? "090"),
      });
    }
    return out;
  }

  const date = String(row?.expense_date ?? "").slice(0, 10);
  const payee = String(row?.vendor ?? "");
  if (target === "quickbooks") {
    Object.assign(out, {
      RefNumber: ref,
      Payee: payee,
      ExpenseDate: date,
      Category: String(row?.category ?? ""),
      Amount: decimalFromMinor(row?.amount_minor),
      Memo: ref,
    });
  } else {
    Object.assign(out, {
      "*ContactName": payee || "Sundry",
      "*InvoiceNumber": ref,
      "*InvoiceDate": date,
      "*DueDate": date,
      Description: String(row?.category ?? ""),
      "*Quantity": "1.000",
      "*UnitAmount": decimalFromMinor(row?.amount_minor),
      "*AccountCode": String(row?.account_code ?? "400"),
      Reference: ref,
    });
  }
  return out;
}

/** RFC 4180 CSV. Also escapes a leading =/+/-/@ so a ledger cell is never a formula. */
export function csvCell(value) {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /["\n,\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(target, kind, rows) {
  const columns = columnsFor(target, kind);
  const body = (rows ?? []).map((row) => columns.map((c) => csvCell(row[c])).join(","));
  return [columns.join(","), ...body].join("\r\n");
}

/**
 * Two-way match.
 *
 * `local`  — [{ ref, amountMinor, date }] from this product.
 * `remote` — [{ ref, amountMinor, date }] read back out of the ledger (today,
 *            from a CSV the bookkeeper exports; later, from the API).
 *
 * Three distinct answers, because they need three different actions:
 *   missingRemote  — we billed it, the ledger never got it. Re-export.
 *   missingLocal   — the ledger has money this product does not. Investigate;
 *                    this is how a payment taken outside the app is found.
 *   amountMismatch — both sides have it and they DISAGREE. This is the one the
 *                    monthly CSV re-import could never surface, and the one
 *                    that silently misstates a tax return.
 */
export function reconcile(local, remote) {
  const byRef = (rows) => {
    const map = new Map();
    for (const row of rows ?? []) {
      const ref = String(row?.ref ?? "").trim();
      if (!ref) continue;
      map.set(ref, {
        ref,
        amountMinor: Math.trunc(finite(row?.amountMinor)),
        date: String(row?.date ?? "").slice(0, 10),
      });
    }
    return map;
  };
  const l = byRef(local);
  const r = byRef(remote);

  const matched = [];
  const amountMismatch = [];
  const missingRemote = [];
  const missingLocal = [];

  for (const [ref, row] of l) {
    const other = r.get(ref);
    if (!other) {
      missingRemote.push(row);
      continue;
    }
    if (other.amountMinor !== row.amountMinor) {
      amountMismatch.push({
        ref,
        localMinor: row.amountMinor,
        remoteMinor: other.amountMinor,
        differenceMinor: row.amountMinor - other.amountMinor,
      });
      continue;
    }
    matched.push(row);
  }
  for (const [ref, row] of r) if (!l.has(ref)) missingLocal.push(row);

  return {
    matched,
    missingRemote,
    missingLocal,
    amountMismatch,
    // `balanced` is the whole point: it is false whenever ANY of the three
    // problem lists is non-empty, so "the books agree" cannot be reported by a
    // run that found sixty discrepancies.
    balanced:
      missingRemote.length === 0 && missingLocal.length === 0 && amountMismatch.length === 0,
    localTotalMinor: [...l.values()].reduce((sum, row) => sum + row.amountMinor, 0),
    remoteTotalMinor: [...r.values()].reduce((sum, row) => sum + row.amountMinor, 0),
  };
}

/**
 * What is NOT built, in one place, so the UI can say it rather than imply
 * otherwise. Rendered verbatim on /reports/export.
 */
export const ACCOUNTING_SYNC_STATUS = Object.freeze({
  status: "partial",
  built: Object.freeze([
    "Idempotent export keys (SP-INVOICE-<id>) on every exported row",
    "QuickBooks Online and Xero import column mapping",
    "Two-way reconciliation against a ledger export, including amount mismatches",
    "A recorded export batch, so the same period is not re-sent blind",
  ]),
  remaining: Object.freeze([
    "An OAuth 2 app registration (client id + secret) for QuickBooks Online and for Xero",
    "A redirect URI on a real domain and a consent screen",
    "Encrypted refresh-token storage, rotated the way merchant_secrets is",
    "A sandbox company to prove a write actually posts before any real ledger is touched",
    "Automatic pull of the ledger side of the reconciliation (today it is a file the bookkeeper exports)",
  ]),
  reason:
    "No developer credentials for either provider exist in this environment, so no API call has ever been made. Nothing here claims to have talked to an accounting system.",
});
