"use client";

import BulkActions, { type BulkRow } from "@/components/BulkActions";
import { bulkSendInvoices, bulkSetInvoicePaid } from "./actions";

/**
 * The invoice list's multi-select (ledger 6c.10).
 *
 * LIST-LEVEL ONLY. Editing an invoice is owned by another workstream on this
 * branch and nothing here touches it: these three actions send a payment link,
 * mark paid, and mark unpaid — exactly the things that used to cost one click
 * per row.
 */
export default function InvoiceBulkBar({ rows }: { rows: BulkRow[] }) {
  return (
    <BulkActions
      noun="invoice"
      rows={rows}
      actions={[
        {
          key: "send",
          label: "✉ Send selected",
          confirm:
            "Send a payment link for every selected invoice? Customers who have opted out will be skipped, and you will be told which.",
          run: (ids) => bulkSendInvoices(ids),
        },
        {
          key: "paid",
          label: "✓ Mark paid",
          confirm:
            "Mark every selected invoice as paid? A manual payment is recorded for each one that has none.",
          run: (ids) => bulkSetInvoicePaid(ids, true),
        },
        {
          key: "unpaid",
          label: "↺ Mark unpaid",
          tone: "danger",
          confirm: "Mark every selected invoice as unpaid?",
          run: (ids) => bulkSetInvoicePaid(ids, false),
        },
      ]}
    />
  );
}
