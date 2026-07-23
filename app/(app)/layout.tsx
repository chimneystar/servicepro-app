import { cookies } from "next/headers";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import { DEFAULT_LOCALE, dirFor, isLocale, type Locale } from "@/lib/i18n";

/** Protected area. Loads the profile (redirects if not logged in / no org). */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const supabase = createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("name, locale")
    .eq("id", profile.organization_id!)
    .single();

  const cookieLocale = cookies().get("locale")?.value;
  const locale: Locale = isLocale(cookieLocale)
    ? cookieLocale
    : isLocale(org?.locale) ? (org!.locale as Locale) : DEFAULT_LOCALE;

  return (
    <div className="shell" dir={dirFor(locale)}>
      <Nav role={profile.role} businessName={org?.name ?? "ServicePro"} locale={locale} />
      <main className="app-content">{children}</main>
    </div>
  );
}
