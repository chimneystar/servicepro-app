import type { Role } from "./auth";

export type NavItem = { href: string; key: string; icon: string; roles: Role[]; bottom?: boolean; group?: "tools" };

export const NAV_ITEMS: NavItem[] = [
  { href: "/tech", key: "nav.tech", icon: "🛠️", roles: ["tech"], bottom: true },
  { href: "/", key: "nav.dashboard", icon: "📊", roles: ["owner", "office", "tech"], bottom: true },
  { href: "/schedule", key: "nav.schedule", icon: "📅", roles: ["owner", "office", "tech"], bottom: true },
  { href: "/dispatch", key: "nav.dispatch", icon: "🧭", roles: ["owner", "office"] },
  { href: "/jobs", key: "nav.jobs", icon: "💼", roles: ["owner", "office", "tech"] },
  { href: "/leads", key: "nav.leads", icon: "🎯", roles: ["owner", "office"] },
  { href: "/customers", key: "nav.customers", icon: "👥", roles: ["owner", "office", "tech"], bottom: true },
  { href: "/messages", key: "nav.messages", icon: "💬", roles: ["owner", "office"] },
  { href: "/estimates", key: "nav.estimates", icon: "📝", roles: ["owner", "office"] },
  { href: "/invoices", key: "nav.invoices", icon: "🧾", roles: ["owner", "office"], bottom: true },
  { href: "/settings/payments", key: "nav.payments", icon: "💳", roles: ["owner", "office"] },
  { href: "/reports", key: "nav.reports", icon: "📈", roles: ["owner", "office"] },
  { href: "/settings", key: "nav.settings", icon: "⚙️", roles: ["owner"] },

  // Grouped under a collapsible "Tools" section to save sidebar space.
  { href: "/route", key: "nav.route", icon: "🗺️", roles: ["owner", "office", "tech"], group: "tools" },
  { href: "/recurring", key: "nav.recurring", icon: "🔁", roles: ["owner", "office"], group: "tools" },
  { href: "/inventory", key: "nav.inventory", icon: "📦", roles: ["owner", "office"], group: "tools" },
  { href: "/pricebook", key: "nav.pricebook", icon: "📚", roles: ["owner", "office"], group: "tools" },
  { href: "/operations", key: "nav.operations", icon: "🔧", roles: ["owner", "office"], group: "tools" },
  { href: "/fleet", key: "nav.fleet", icon: "📍", roles: ["owner", "office"], group: "tools" },
  { href: "/growth", key: "nav.growth", icon: "🚀", roles: ["owner", "office"], group: "tools" },
  { href: "/migration", key: "nav.migration", icon: "⇥", roles: ["owner", "office"], group: "tools" },
];
