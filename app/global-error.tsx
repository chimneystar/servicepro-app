"use client";

import { useEffect } from "react";

/**
 * The last boundary: an error thrown by the ROOT layout itself.
 *
 * `app/error.tsx` cannot catch this, because it renders inside the root layout —
 * if that layout is what failed, there is nothing left to render into. Without a
 * `global-error.tsx` Next.js falls back to its own unstyled page, which in
 * production is a blank screen with no explanation, no error reference, and no
 * Hebrew.
 *
 * This file must supply its own `<html>` and `<body>`: it REPLACES the root
 * layout rather than nesting inside it. That also means it cannot use the
 * stylesheet's layout classes with any confidence, so the styling here is
 * deliberately inline and self-contained — a boundary that depends on the thing
 * that just failed is not a boundary.
 *
 * `lang`/`dir` are hardcoded rather than read from a cookie for the same reason:
 * whatever supplies the locale may be exactly what threw.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("ServicePro root layout error", { digest: error.digest, error });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "1.5rem",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#f6f8fc",
          color: "#0b1524",
        }}
      >
        <main role="alert" style={{ maxWidth: "34rem", textAlign: "center" }}>
          <div
            aria-hidden="true"
            style={{
              width: "3rem",
              height: "3rem",
              margin: "0 auto 1rem",
              display: "grid",
              placeItems: "center",
              borderRadius: "50%",
              background: "#fdeaea",
              color: "#dc2626",
              fontSize: "1.5rem",
              fontWeight: 800,
            }}
          >
            !
          </div>
          <h1 style={{ fontSize: "1.375rem", margin: "0 0 0.5rem" }}>ServicePro couldn’t start</h1>
          <p style={{ margin: "0 0 0.25rem", color: "#5c6675", lineHeight: 1.55 }}>
            Your business data is safe — this is a problem loading the app itself, not with your
            records.
          </p>
          <p
            lang="he"
            dir="rtl"
            style={{ margin: "0 0 1.25rem", color: "#5c6675", lineHeight: 1.55 }}
          >
            הנתונים העסקיים שלכם בטוחים — זו תקלה בטעינת האפליקציה עצמה, לא ברשומות שלכם.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              border: "none",
              borderRadius: "0.625rem",
              padding: "0.75rem 1.25rem",
              background: "#2563eb",
              color: "#fff",
              fontSize: "0.9375rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Reload · טעינה מחדש
          </button>
          {error.digest && (
            <p style={{ marginTop: "1.25rem", fontSize: "0.8125rem", color: "#5c6675" }}>
              Error reference · מספר תקלה: <code>{error.digest}</code>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
