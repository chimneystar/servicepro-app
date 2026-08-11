"use client";

import BulkActions, { type BulkRow } from "@/components/BulkActions";
import { bulkOptOut, bulkSendStatements } from "./actions";

/**
 * The customer list's multi-select (ledger 6c.10), plus bulk statements (6c.6).
 *
 * There is deliberately NO bulk opt-IN. Consent is given by the person, not
 * applied to a list by an operator; a button that could re-subscribe forty
 * people who replied STOP is a legal problem, not a convenience.
 */
export default function CustomerBulkBar({ rows }: { rows: BulkRow[] }) {
  return (
    <BulkActions
      noun="customer"
      rows={rows}
      actions={[
        {
          key: "statement-email",
          label: "🧾 Email statement",
          confirm:
            "Email an account statement to every selected customer? Anyone who has unsubscribed will be skipped, and you will be told which.",
          run: (ids) => bulkSendStatements(ids, "email"),
        },
        {
          key: "statement-sms",
          label: "💬 Text statement",
          confirm:
            "Text an account statement summary to every selected customer? Anyone who replied STOP will be skipped, and you will be told which.",
          run: (ids) => bulkSendStatements(ids, "sms"),
        },
        {
          key: "optout-sms",
          label: "🚫 Record SMS opt-out",
          tone: "danger",
          confirm:
            "Record an SMS opt-out for every selected customer? This cannot be undone in bulk — re-consent has to be given one customer at a time.",
          run: (ids) => bulkOptOut(ids, "sms"),
        },
        {
          key: "optout-email",
          label: "🚫 Record email opt-out",
          tone: "danger",
          confirm:
            "Record an email unsubscribe for every selected customer? This cannot be undone in bulk.",
          run: (ids) => bulkOptOut(ids, "email"),
        },
      ]}
    />
  );
}
