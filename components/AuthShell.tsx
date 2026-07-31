import Link from "next/link";
import LanguageToggle from "@/components/LanguageToggle";
import type { Locale } from "@/lib/i18n";

export default function AuthShell({
  locale,
  eyebrow,
  title,
  description,
  children,
}: {
  locale: Locale;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const he = locale === "he";
  return (
    <main className="auth-page">
      <section
        className="auth-story"
        aria-label={he ? "מה אפשר לעשות ב-ServicePro" : "What ServicePro helps you do"}
      >
        <Link className="auth-brand" href="/login" aria-label="ServicePro">
          <span className="brand-mark" aria-hidden="true" />
          <span>
            <strong>ServicePro</strong>
            <small>{he ? "העסק מתקדם. אתם בשליטה." : "Keep the day moving."}</small>
          </span>
        </Link>
        <div className="auth-story-copy">
          <span className="auth-kicker">
            {he ? "מהפנייה הראשונה עד התשלום" : "From first call to final payment"}
          </span>
          <h2>{he ? "כל העבודה זורמת במקום אחד." : "One clear flow for every service call."}</h2>
          <p>
            {he
              ? "משרד, טכנאים ולקוחות רואים בדיוק מה צריך לקרות עכשיו — בלי ללמוד מערכת מסובכת."
              : "Office staff, technicians, and customers always know what happens next—without wrestling with complicated software."}
          </p>
        </div>
        <div className="auth-route" aria-label={he ? "מסלול העבודה" : "Service workflow"}>
          <span>
            <b>1</b>
            {he ? "פנייה" : "Lead"}
          </span>
          <i aria-hidden="true" />
          <span>
            <b>2</b>
            {he ? "עבודה" : "Booked"}
          </span>
          <i aria-hidden="true" />
          <span>
            <b>3</b>
            {he ? "תשלום" : "Paid"}
          </span>
        </div>
        <div className="auth-proof">
          <article>
            <strong>{he ? "עברית + English" : "English + עברית"}</strong>
            <span>{he ? "עבודה טבעית בשתי השפות" : "Natural in both languages"}</span>
          </article>
          <article>
            <strong>{he ? "משרד + שטח" : "Office + field"}</strong>
            <span>{he ? "אותו מידע, בדיוק בזמן" : "The same truth, right on time"}</span>
          </article>
          <article>
            <strong>{he ? "גם בלי קליטה" : "Works offline"}</strong>
            <span>{he ? "הטכנאי ממשיך לעבוד" : "Technicians keep moving"}</span>
          </article>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-language">
          <LanguageToggle current={locale} />
        </div>
        <div className="auth-card">
          <div className="auth-card-heading">
            <span>{eyebrow}</span>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {children}
        </div>
        <p className="auth-legal">
          {he
            ? "ServicePro מאבטחת את נתוני העסק ומפרידה אותם מחשבונות אחרים."
            : "ServicePro keeps each business account securely separated."}
        </p>
      </section>
    </main>
  );
}
