"use client";

import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";

/** Accessible EN / עברית switch. Stores the choice in a cookie and reloads. */
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

  // The look lives in `.language-toggle` in globals.css, not in inline styles.
  // That is deliberate: the stylesheet is where the 14px (0.875rem) readable
  // floor and the 44px hit target are enforced, and where `aria-pressed`
  // drives the "on" state — so the selected language is ANNOUNCED, not only
  // coloured. The old inline version painted the state and said nothing.
  return (
    <div
      className={`language-toggle${dark ? " dark" : ""}`}
      role="group"
      aria-label={current === "he" ? "בחירת שפה" : "Choose language"}
    >
      <button
        type="button"
        aria-pressed={current === "en"}
        aria-label="English"
        lang="en"
        onClick={() => set("en")}
      >
        EN
      </button>
      <button
        type="button"
        aria-pressed={current === "he"}
        aria-label="עברית"
        lang="he"
        onClick={() => set("he")}
      >
        עב
      </button>
    </div>
  );
}
