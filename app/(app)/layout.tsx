import { cookies } from "next/headers";
import { loadCapabilities, requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import TopBar from "@/components/TopBar";
import { DEFAULT_LOCALE, dirFor, isLocale, type Locale } from "@/lib/i18n";
import { LocaleProvider } from "@/components/LocaleProvider";
import QuickCreate from "@/components/QuickCreate";
import { isPlatformAdmin } from "@/lib/platform-admin";

/** Protected area. Loads the profile (redirects if not logged in / no org). */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const [{ data: org }, capabilitySet, platformAdmin] = await Promise.all([
    supabase.from("organizations").select("name, locale").eq("id", profile.organization_id!).single(),
    loadCapabilities(profile),
    profile.role === "owner" ? isPlatformAdmin(profile.id) : Promise.resolve(false),
  ]);

  const cookieLocale = (await cookies()).get("locale")?.value;
  const locale: Locale = isLocale(cookieLocale)
    ? cookieLocale
    : isLocale(org?.locale) ? (org!.locale as Locale) : DEFAULT_LOCALE;

  return (
    <div className="shell" dir={dirFor(locale)}>
      {/* WCAG 2.4.1. Up to 29 navigation links come before the page content in
          the DOM, so without this a keyboard user tabs through the entire
          sidebar on every single screen before reaching anything they came for.
          Invisible until focused — see `.skip-link` in globals.css. */}
      <a href="#main-content" className="skip-link">{locale === "he" ? "דילוג לתוכן" : "Skip to content"}</a>
      <Nav role={profile.role} businessName={org?.name ?? "ServicePro"} locale={locale} capabilities={[...capabilitySet]} platformAdmin={platformAdmin} />
      {profile.role !== "tech" && <QuickCreate locale={locale} mobile />}
      <main id="main-content" tabIndex={-1} className="app-content">
        <LocaleProvider locale={locale}>
          <TopBar canManage={profile.role !== "tech"} locale={locale} />
          {children}
        </LocaleProvider>
      </main>
    </div>
  );
}
