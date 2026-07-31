import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import LanguageToggle from "@/components/LanguageToggle";
import MobileTabs from "@/components/MobileTabs";
import SidebarTools from "@/components/SidebarTools";
import SideNavScroller from "@/components/SideNavScroller";
import NavLink from "@/components/NavLink";
import { NAV_ITEMS, splitNavigation } from "@/lib/nav";
import type { CapabilityKey } from "@/lib/auth";
import Link from "next/link";
import AppIcon from "@/components/AppIcon";

export default function Nav({ role, businessName, locale, capabilities, platformAdmin = false }: { role: Role; businessName: string; locale: Locale; capabilities: CapabilityKey[]; platformAdmin?: boolean }) {
  async function signOut() {
    "use server";
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  const roleKey = role === "owner" ? "role.owner" : role === "office" ? "role.office" : "role.tech";
  const allowed = new Set(capabilities);
  const mine = NAV_ITEMS.filter((item) => item.roles.includes(role) && (!item.capability || allowed.has(item.capability)) && (!item.platformOnly || platformAdmin));
  const primary = mine.filter((item) => item.group !== "tools");
  // `/appearance` is rendered by `.side-utilities` a few lines down, so listing
  // it inside Tools as well printed the same destination twice in one nav —
  // a duplicate row in a list the audit measured as 1245px too tall, and two
  // identically-named links for a screen reader. It stays reachable here
  // (utilities) and on mobile (`splitNavigation` keys off `bottom`, not
  // `group`, so /more still carries it). Nothing is dropped.
  const tools = mine
    .filter((item) => item.group === "tools" && item.href !== "/appearance")
    .map((item) => ({ href: item.href, label: t(locale, item.key), icon: item.icon }));
  // One shared split, so the tab bar and /more cannot disagree about who owns an
  // item. They used to, and Invoices fell through the gap on mobile.
  const { tabs, more } = splitNavigation(mine);
  const bottomItems = tabs.map((item) => ({ href: item.href, label: t(locale, item.key), icon: item.icon }));
  const tabItems = more.length > 0
    ? [...bottomItems, { href: "/more", label: t(locale, "nav.more"), icon: "⋯" }]
    : bottomItems;

  return (
    <>
      <aside className="desk-side">
        <div className="side-brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-copy"><strong>{businessName}</strong><small>{t(locale, roleKey)}</small></span>
        </div>
        <SideNavScroller label={locale === "he" ? "ניווט ראשי" : "Main navigation"}>
          {primary.map((item) => <NavLink key={item.href} href={item.href} label={t(locale, item.key)} />)}
          <SidebarTools items={tools} label={t(locale, "nav.tools")} />
        </SideNavScroller>
        <div className="side-utilities">
          <Link href="/appearance" className="side-appearance"><AppIcon name="appearance" /><span>{t(locale, "nav.appearance")}</span></Link>
          <div className="side-locale"><LanguageToggle current={locale} dark /></div>
        </div>
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
