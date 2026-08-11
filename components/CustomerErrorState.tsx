"use client";

import { useEffect } from "react";

/**
 * The error state shown to a CUSTOMER — the public booking page, a shared
 * quote or invoice link, the customer portal.
 *
 * These pages need their own boundary and their own words. The signed-in app
 * can tell someone "your data is safe, try another screen", but a customer has
 * no other screen and no account: they followed a link the business sent them,
 * and if it fails the only useful thing we can say is how to reach the business.
 *
 * Deliberately NOT offering "contact support" — the customer's relationship is
 * with the business, not with us, and sending them to a vendor they have never
 * heard of is worse than telling them plainly to call the people they hired.
 *
 * Shared by three boundaries (`/book`, `/p`, `/portal`) rather than copied into
 * each, because thirteen byte-identical copied overlays are what ledger 6.6 had
 * to undo.
 */
export default function CustomerErrorState({
  error,
  reset,
  he,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  he: boolean;
}) {
  useEffect(() => {
    console.error("ServicePro customer-facing error", { digest: error.digest, error });
  }, [error]);

  return (
    <main className="error-state" role="alert" aria-live="assertive">
      <div className="error-state-mark" aria-hidden="true">
        !
      </div>
      <h1>{he ? "הדף הזה לא נטען" : "This page didn’t load"}</h1>
      <p>
        {he
          ? "לא נשלח דבר ולא חויבתם. אפשר לנסות שוב — ואם זה חוזר, פנו ישירות לעסק שאיתו אתם בקשר."
          : "Nothing was submitted and you have not been charged. Try again — and if it keeps happening, contact the business directly."}
      </p>
      <button type="button" onClick={reset}>
        {he ? "לנסות שוב" : "Try again"}
      </button>
      {error.digest && (
        <small>
          {he ? "מספר תקלה" : "Error reference"}: {error.digest}
        </small>
      )}
    </main>
  );
}
