"use client";

import { useActionStatus } from "@/components/ActionStatus";
import { reviewManualPayment } from "./actions";

/**
 * The confirm/reject control for a manual (Zelle / cheque) payment.
 *
 * WHY THIS IS A CLIENT COMPONENT. The form was `<form action={reviewManualPayment}>`
 * inside a server component, and Next.js DISCARDS a server action's return value
 * in that shape. So even once the action started reporting its refusals, nobody
 * would ever have seen one: an office user without `can_confirm_manual_payments`
 * pressed "Confirm received", the page refreshed, and the payment was still
 * sitting there with no explanation.
 *
 * `useActionStatus` is the same hook five other screens already use, so this is
 * the existing contract reaching one more place rather than a second opinion
 * about how failures surface. It also catches a THROWN action — a redeploy
 * mid-submit — which the bare form could not.
 */
export default function ManualPaymentReview({
  submissionId,
  he,
  children,
}: {
  submissionId: string;
  he: boolean;
  children: React.ReactNode;
}) {
  const { pending, error, run } = useActionStatus(he);

  return (
    <form
      className="manual-review-card"
      action={(data) => {
        data.set("submission_id", submissionId);
        run(() => reviewManualPayment(data));
      }}
    >
      {children}
      <div className="manual-review-actions">
        <button type="submit" name="decision" value="confirm" disabled={pending}>
          {he ? "אישור קבלה" : "Confirm received"}
        </button>
        <button type="submit" name="decision" value="reject" className="reject" disabled={pending}>
          {he ? "דחייה" : "Reject"}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
