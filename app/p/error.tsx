"use client";

import CustomerErrorState from "@/components/CustomerErrorState";

// A customer-facing boundary. The shared state lives in one component; see
// components/CustomerErrorState.tsx for why the wording differs from the
// signed-in app's.
export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  const he = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  return <CustomerErrorState {...props} he={he} />;
}
