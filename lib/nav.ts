import type { Role } from "./auth";

export type NavItem = { href: string; key: string; icon: string; roles: Role[]; bottom?: boolean };

export const NAV_ITEMS: NavItem[] = [
  { href: "/", key: "nav.dashboard", icon: "📊", roles: ["owner", "office", "tech"], bottom: true },
  { href: "/schedule", key: "nav.schedule", icon: "📅", roles: ["owner", "office", "tech"], bottom: true },
  { href: "/leads", key: "nav.leads", icon: "🎯", roles: ["owner", "office"] },
  { href: "/customers", key: "nav.customers", icon: "👥", roles: ["owner", "office", "tech"], bottom: true },
  { href: "/estimates", key: "nav.estimates", icon: "📝", roles: ["owner", "office"] },
  { href: "/invoices", key: "nav.invoices", icon: "🧾", roles: ["owner", "office"], bottom: true },
  { href: "/pricebook", key: "nav.pricebook", icon: "📚", roles: ["owner", "office"] },
  { href: "/expenses", key: "nav.expenses", icon: "💸", roles: ["owner", "office"] },
  { href: "/reports", key: "nav.reports", icon: "📈", roles: ["owner", "office"] },
  { href: "/team", key: "nav.team", icon: "🛠️", roles: ["owner"] },
  { href: "/settings", key: "nav.settings", icon: "⚙️", roles: ["owner"] },
];
