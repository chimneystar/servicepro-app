"use client";

import { useState } from "react";
import { useActionStatus } from "@/components/ActionStatus";
import { submitPortalRequest } from "./actions";

/**
 * A customer-facing form in the portal.
 *
 * WHY IT IS A CLIENT COMPONENT. These were `<form action={submitPortalRequest.bind(null, token)}>`
 * inside a server component, and Next.js discards a server action's return value
 * in that shape. So a customer asking for a different date got the page back with
 * their message gone and no explanation — and had every reason to think the
 * business had been told. Nobody had.
 *
 * Success is stated, not merely implied by the page reloading. A customer has no
 * dashboard to check and no account to log into; if we do not say "we've passed
 * this on", they cannot tell a delivered request from a discarded one.
 */
export default function PortalRequestForm({
  token,
  he,
  className,
  submitLabel,
  successMessage,
  children,
}: {
  token: string;
  he: boolean;
  className?: string;
  submitLabel: string;
  successMessage: string;
  children: React.ReactNode;
}) {
  const { pending, error, run } = useActionStatus(he);
  const [sent, setSent] = useState(false);

  return (
    <form
      className={className}
      action={(data) => {
        setSent(false);
        run(
          () => submitPortalRequest(token, data),
          () => setSent(true),
        );
      }}
    >
      {children}
      <button type="submit" disabled={pending}>
        {pending ? (he ? "שולח…" : "Sending…") : submitLabel}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {sent && !error && (
        <p className="form-success" role="status">
          {successMessage}
        </p>
      )}
    </form>
  );
}
