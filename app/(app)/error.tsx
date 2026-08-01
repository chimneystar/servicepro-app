"use client";

import { useEffect } from "react";

/**
 * The error boundary for the signed-in app.
 *
 * WHY THIS EXISTS SEPARATELY FROM `app/error.tsx`.
 *
 * A boundary replaces everything BELOW the layout it sits in. With only the root
 * boundary, an error thrown by any screen inside `(app)` replaced the entire app
 * shell — sidebar, tab bar, the lot — so a failure on /invoices left the user on
 * a bare page with no navigation and no way back except the browser's own
 * controls. On a phone, where the tab bar IS the navigation, that is a dead end.
 *
 * Living at `app/(app)/error.tsx` it renders inside `<main className="app-content">`,
 * so the shell survives and the user can simply go somewhere else.
 *
 * `reset()` re-renders the segment. Most failures here are a Supabase read that
 * timed out or a row that vanished mid-request, and those genuinely do succeed
 * on a second try — which is why the button is offered rather than decorative.
 */
export default function AppSectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only thing tying what the user saw to what the server
    // logged; without it a support conversation starts from nothing.
    console.error("ServicePro app-section error", { digest: error.digest, error });
  }, [error]);

  const he = typeof document !== "undefined" && document.documentElement.dir === "rtl";

  return (
    <section className="error-state" role="alert" aria-live="assertive">
      <div className="error-state-mark" aria-hidden="true">
        !
      </div>
      <h1>{he ? "לא הצלחנו לטעון את המסך הזה" : "This screen didn’t load"}</h1>
      <p>
        {he
          ? "שום דבר לא נמחק והנתונים שלכם בטוחים. אפשר לנסות שוב, או לעבור למסך אחר מהתפריט."
          : "Nothing was deleted and your data is safe. Try again, or use the menu to go somewhere else."}
      </p>
      <button type="button" onClick={reset}>
        {he ? "לנסות שוב" : "Try again"}
      </button>
      {error.digest && (
        <small>
          {he ? "מספר תקלה" : "Error reference"}: {error.digest}
        </small>
      )}
    </section>
  );
}
