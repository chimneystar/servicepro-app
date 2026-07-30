import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import LanguageToggle from "@/components/LanguageToggle";
import MobileTabs from "@/components/MobileTabs";
import SidebarTools from "@/components/SidebarTools";
import NavLink from "@/components/NavLink";
import { NAV_ITEMS } from "@/lib/nav";
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
  const todayHref = role === "owner" ? "/" : role === "office" ? "/dispatch" : "/tech";
  const today = mine.find((item) => item.href === todayHref) ?? mine[0];
  const scheduleRoutes = new Set(["/dispatch", "/schedule", "/jobs", "/recurring", "/route"]);
  const customerRoutes = new Set(["/leads", "/customers", "/messages", "/calls", "/warranties"]);
  const moneyRoutes = new Set(["/estimates", "/invoices", "/expenses", "/finance", "/settings/payments", "/reports"]);
  const scheduleItems = mine.filter((item) => item.href !== today?.href && scheduleRoutes.has(item.href));
  const customerItems = mine.filter((item) => customerRoutes.has(item.href));
  const moneyItems = mine.filter((item) => moneyRoutes.has(item.href));
  const grouped = new Set([today?.href, ...scheduleItems.map((item) => item.href), ...customerItems.map((item) => item.href), ...moneyItems.map((item) => item.href)]);
  const moreItems = mine.filter((item) => !grouped.has(item.href));
  const tools = (items: typeof mine) => items.map((item) => ({ href: item.href, label: t(locale, item.key), icon: item.icon }));
  const customerHome = customerItems.find((item) => item.href === "/customers") ?? customerItems[0];
  const scheduleHome = scheduleItems.find((item) => item.href === "/schedule") ?? scheduleItems[0];
  const moneyHome = moneyItems.find((item) => item.href === "/invoices") ?? moneyItems[0];
  const tabItems = [
    today && { href: today.href, label: t(locale, "nav.today"), icon: today.icon },
    scheduleHome && { href: scheduleHome.href, label: t(locale, "nav.schedule"), icon: scheduleHome.icon },
    customerHome && { href: customerHome.href, label: t(locale, "nav.customers"), icon: customerHome.icon },
    role === "tech"
      ? mine.find((item) => item.href === "/jobs") && { href: "/jobs", label: t(locale, "nav.jobs"), icon: "💼" }
      : moneyHome && { href: moneyHome.href, label: t(locale, "nav.money"), icon: moneyHome.icon },
    { href: "/more", label: t(locale, "nav.more"), icon: "⋯" },
  ].filter(Boolean) as { href: string; label: string; icon: string }[];

  return (
    <>
      <aside className="desk-side">
        <div className="side-brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-copy"><strong>{businessName}</strong><small>{t(locale, roleKey)}</small></span>
        </div>
        <nav className="side-nav" aria-label={locale === "he" ? "ניווט ראשי" : "Main navigation"}>
          {today && <NavLink href={today.href} label={t(locale, "nav.today")} />}
          <SidebarTools items={tools(scheduleItems)} label={t(locale, "nav.schedule")} icon="calendar" />
          <SidebarTools items={tools(customerItems)} label={t(locale, "nav.customers")} icon="customers" />
          <SidebarTools items={tools(moneyItems)} label={t(locale, "nav.money")} icon="finance" />
          <SidebarTools items={tools(moreItems)} label={t(locale, "nav.more")} />
        </nav>
        <div className="side-utilities">
          <Link href="/appearance" className="side-appearance"><AppIcon name="appearance" /><span>{t(locale, "nav.appearance")}</span></Link>
          <div className="side-locale"><LanguageToggle current={locale} dark /></div>
        </div>
        <form action={signOut} className="side-footer"><button type="submit" className="sign-out-btn">{t(locale, "common.signOut")}</button></form>
      </aside>

      <header className="mobile-top">
        <div className="mobile-brand"><span className="brand-mark" aria-hidden="true" /><span className="mobile-brand-copy"><strong>{businessName}</strong><small>{t(locale, roleKey)}</small></span></div>
        <form action={signOut}><button type="submit" className="mobile-sign-out">{t(locale, "common.signOut")}</button></form>
      </header>
      <MobileTabs items={tabItems} />
    </>
  );
}
