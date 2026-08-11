"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("ServicePro page error", error);
  }, [error]);
  const he = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  return (
    <main className="error-state" role="alert">
      <div className="error-state-mark">!</div>
      <h1>{he ? "משהו השתבש" : "Something went wrong"}</h1>
      <p>
        {he
          ? "המידע שלכם נשמר. אפשר לנסות שוב, ואם הבעיה חוזרת נפנה אתכם לעזרה."
          : "Your information is safe. Try again, and if the problem continues we’ll help you resolve it."}
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
