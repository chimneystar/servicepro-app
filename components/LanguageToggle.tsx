"use client";

import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";

/** Small EN / עברית switch. Stores the choice in a cookie and reloads. */
export default function LanguageToggle({
  current,
  dark = false,
}: {
  current: Locale;
  dark?: boolean;
}) {
  const router = useRouter();

  function set(locale: Locale) {
    if (locale === current) return;
    document.cookie = `locale=${locale};path=/;max-age=31536000;samesite=lax`;
    router.refresh();
    // dir/lang live on <html>, set by the server layout — reload applies it everywhere.
    window.location.reload();
  }

  const base: React.CSSProperties = {
    border: "none",
    padding: "5px 10px",
    borderRadius: 8,
    fontSize: "0.8125rem",
    fontWeight: 700,
    cursor: "pointer",
  };
  const on = dark
    ? { background: "rgba(255,255,255,.2)", color: "#fff" }
    : { background: "#2563eb", color: "#fff" };
  const off = dark
    ? { background: "transparent", color: "#c6d6f5" }
    : { background: "#e7ecf5", color: "#475569" };

  return (
    <div style={{ display: "inline-flex", gap: 4 }}>
      <button
        type="button"
        style={{ ...base, ...(current === "en" ? on : off) }}
        onClick={() => set("en")}
      >
        EN
      </button>
      <button
        type="button"
        style={{ ...base, ...(current === "he" ? on : off) }}
        onClick={() => set("he")}
      >
        עב
      </button>
    </div>
  );
}
