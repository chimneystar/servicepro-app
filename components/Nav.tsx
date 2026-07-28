import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import LanguageToggle from "@/components/LanguageToggle";
import MobileTabs from "@/components/MobileTabs";
import SidebarTools from "@/components/SidebarTools";
import NavLink from "@/components/NavLink";
import { NAV_ITEMS } from "@/lib/nav";

export default function Nav({ role, businessName, locale }: { role: Role; businessName: string; locale: Locale }) {
  async function signOut() {
    "use server";
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  const roleKey = role === "owner" ? "role.owner" : role === "office" ? "role.office" : "role.tech";
  const mine = NAV_ITEMS.filter((item) => item.roles.includes(role));
  const primary = mine.filter((item) => item.group !== "tools");
  const tools = mine.filter((item) => item.group === "tools").map((item) => ({ href: item.href, label: t(locale, item.key), icon: item.icon }));
  const bottomItems = mine.filter((item) => item.bottom).map((item) => ({ href: item.href, label: t(locale, item.key), icon: item.icon }));
  const hasMore = mine.some((item) => !item.bottom);
  const tabItems = hasMore ? [...bottomItems, { href: "/more", label: t(locale, "nav.more"), icon: "⋯" }] : bottomItems;

  return (
    <>
      <aside className="desk-side">
        <div className="side-brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-copy"><strong>{businessName}</strong><small>{t(locale, roleKey)}</small></span>
        </div>
        <nav className="side-nav" aria-label={locale === "he" ? "ניווט ראשי" : "Main navigation"}>
          {primary.map((item) => <NavLink key={item.href} href={item.href} label={t(locale, item.key)} />)}
          <SidebarTools items={tools} label={t(locale, "nav.tools")} />
        </nav>
        <div className="side-locale"><LanguageToggle current={locale} dark /></div>
        <form action={signOut} className="side-footer"><button type="submit" className="sign-out-btn">{t(locale, "common.signOut")}</button></form>
      </aside>

      <header className="mobile-top">
        <div className="mobile-brand"><span className="brand-mark" aria-hidden="true" /><strong>{businessName}</strong></div>
        <form action={signOut}><button type="submit" className="mobile-sign-out">{t(locale, "common.signOut")}</button></form>
      </header>
      <MobileTabs items={tabItems} />
    </>
  );
}
