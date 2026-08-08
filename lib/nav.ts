import type { CapabilityKey, Role } from "./auth";

export type NavItem = {
  href: string;
  key: string;
  icon: string;
  roles: Role[];
  bottom?: boolean;
  group?: "tools";
  capability?: CapabilityKey;
  platformOnly?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/tech", key: "nav.tech", icon: "🛠️", roles: ["tech"], bottom: true },
  { href: "/", key: "nav.dashboard", icon: "📊", roles: ["owner"], bottom: true },
  {
    href: "/dispatch",
    key: "nav.dispatch",
    icon: "🧭",
    roles: ["owner", "office"],
    capability: "schedule.manage",
    bottom: true,
  },
  {
    href: "/schedule",
    key: "nav.schedule",
    icon: "📅",
    roles: ["owner", "office", "tech"],
    capability: "schedule.manage",
    bottom: true,
  },
  {
    href: "/jobs",
    key: "nav.jobs",
    icon: "💼",
    roles: ["owner", "office", "tech"],
    capability: "jobs.edit",
  },
  { href: "/leads", key: "nav.leads", icon: "🎯", roles: ["owner", "office"] },
  {
    href: "/customers",
    key: "nav.customers",
    icon: "👥",
    roles: ["owner", "office", "tech"],
    capability: "customers.view",
    bottom: true,
  },
  { href: "/messages", key: "nav.messages", icon: "💬", roles: ["owner", "office"] },
  { href: "/calls", key: "nav.calls", icon: "☎", roles: ["owner", "office"] },
  {
    href: "/estimates",
    key: "nav.estimates",
    icon: "📝",
    roles: ["owner", "office"],
    capability: "estimates.manage",
  },
  {
    href: "/invoices",
    key: "nav.invoices",
    icon: "🧾",
    roles: ["owner", "office"],
    capability: "invoices.manage",
    bottom: true,
  },
  { href: "/expenses", key: "nav.expenses", icon: "💸", roles: ["owner", "office"] },
  {
    href: "/finance",
    key: "nav.finance",
    icon: "💰",
    roles: ["owner", "office"],
    capability: "payments.manage",
  },
  {
    href: "/settings/payments",
    key: "nav.payments",
    icon: "💳",
    roles: ["owner", "office"],
    capability: "payments.manage",
  },
  {
    href: "/reports",
    key: "nav.reports",
    icon: "📈",
    roles: ["owner", "office"],
    capability: "reports.view",
  },
  { href: "/team", key: "nav.team", icon: "👥", roles: ["owner"] },
  { href: "/settings", key: "nav.settings", icon: "⚙️", roles: ["owner"] },
  { href: "/admin", key: "nav.admin", icon: "🔐", roles: ["owner"], platformOnly: true },

  // Grouped under a collapsible "Tools" section to save sidebar space.
  {
    href: "/route",
    key: "nav.route",
    icon: "🗺️",
    roles: ["owner", "office", "tech"],
    group: "tools",
  },
  {
    href: "/recurring",
    key: "nav.recurring",
    icon: "🔁",
    roles: ["owner", "office"],
    group: "tools",
  },
  {
    href: "/inventory",
    key: "nav.inventory",
    icon: "📦",
    roles: ["owner", "office"],
    group: "tools",
  },
  {
    href: "/pricebook",
    key: "nav.pricebook",
    icon: "📚",
    roles: ["owner", "office"],
    group: "tools",
  },
  {
    href: "/operations",
    key: "nav.operations",
    icon: "🔧",
    roles: ["owner", "office"],
    group: "tools",
  },
  {
    href: "/warranties",
    key: "nav.warranties",
    icon: "🛡",
    roles: ["owner", "office"],
    group: "tools",
  },
  { href: "/fleet", key: "nav.fleet", icon: "📍", roles: ["owner", "office"], group: "tools" },
  { href: "/growth", key: "nav.growth", icon: "🚀", roles: ["owner", "office"], group: "tools" },
  {
    href: "/migration",
    key: "nav.migration",
    icon: "⇥",
    roles: ["owner", "office"],
    group: "tools",
  },
  // Restoring is exactly as privileged as deleting: owner/office. A screen that
  // cannot be reached is the same as no screen, which is what 6a.4 was.
  { href: "/trash", key: "nav.trash", icon: "🗑", roles: ["owner", "office"], group: "tools" },
  { href: "/settings/privacy", key: "nav.privacy", icon: "🛡", roles: ["owner"], group: "tools" },
  {
    href: "/appearance",
    key: "nav.appearance",
    icon: "◐",
    roles: ["owner", "office", "tech"],
    group: "tools",
  },
];

/** How many destinations fit in the mobile tab bar beside the "More" tab. */
export const MOBILE_TAB_SLOTS = 4;

/**
 * Split a member's navigation into the mobile tab bar and everything else.
 *
 * THE BUG THIS EXISTS FOR: the tab bar rendered `bottomItems.slice(0, 4)` and
 * `/more` rendered `!item.bottom`. Six items are marked `bottom`, so for an
 * owner the fifth and sixth — INVOICES among them — were dropped by the slice
 * and then excluded by /more for being `bottom`. Invoices was unreachable on a
 * phone entirely: not in the tab bar, not in More, no link anywhere.
 *
 * The cause is that two files each decided the split independently, using
 * different rules. They now call this, so an item can never fall through the gap
 * between them again.
 */
export function splitNavigation(items: NavItem[]): { tabs: NavItem[]; more: NavItem[] } {
  const bottom = items.filter((item) => item.bottom);
  const rest = items.filter((item) => !item.bottom);

  // Everything that does not fit in the tab bar overflows into More — including
  // `bottom` items. Nothing is dropped by either side.
  const tabs = bottom.slice(0, MOBILE_TAB_SLOTS);
  const overflow = bottom.slice(MOBILE_TAB_SLOTS);
  return { tabs, more: [...overflow, ...rest] };
}
