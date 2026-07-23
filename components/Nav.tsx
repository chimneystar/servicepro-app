import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { Role } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import LanguageToggle from "@/components/LanguageToggle";

const ITEMS: { href: string; key: string; icon: string; roles: Role[] }[] = [
  { href: "/", key: "nav.dashboard", icon: "📊", roles: ["owner", "office", "tech"] },
  { href: "/schedule", key: "nav.schedule", icon: "📅", roles: ["owner", "office", "tech"] },
  { href: "/customers", key: "nav.customers", icon: "👥", roles: ["owner", "office", "tech"] },
  { href: "/estimates", key: "nav.estimates", icon: "📝", roles: ["owner", "office"] },
  { href: "/invoices", key: "nav.invoices", icon: "🧾", roles: ["owner", "office"] },
  { href: "/reports", key: "nav.reports", icon: "📈", roles: ["owner", "office"] },
  { href: "/settings", key: "nav.settings", icon: "⚙️", roles: ["owner"] },
];

export default function Nav({ role, businessName, locale }: { role: Role; businessName: string; locale: Locale }) {
  async function signOut() {
    "use server";
    const supabase = createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  const roleKey = role === "owner" ? "role.owner" : role === "office" ? "role.office" : "role.tech";

  return (
    <aside style={{ width: 240, flex: "0 0 240px", background: "linear-gradient(175deg,#0f2a5e,#153a7a)", color: "#dbe6ff", minHeight: "100vh", position: "sticky", top: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "20px 18px", borderBottom: "1px solid rgba(255,255,255,.08)", display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: "linear-gradient(135deg,#38bdf8,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>❄️</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, color: "#fff", fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{businessName}</div>
          <div style={{ fontSize: 11.5, color: "#9db6e6" }}>{t(locale, roleKey)}</div>
        </div>
      </div>
      <nav style={{ padding: 12, flex: 1 }}>
        {ITEMS.filter((i) => i.roles.includes(role)).map((i) => (
          <Link key={i.href} href={i.href}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: 11, color: "#c6d6f5", textDecoration: "none", fontSize: 14.5, fontWeight: 600, marginBottom: 3 }}>
            <span style={{ fontSize: 18, width: 22, textAlign: "center" }}>{i.icon}</span>{t(locale, i.key)}
          </Link>
        ))}
      </nav>
      <div style={{ padding: "10px 14px", display: "flex", justifyContent: "center" }}>
        <LanguageToggle current={locale} dark />
      </div>
      <form action={signOut} style={{ padding: 14, borderTop: "1px solid rgba(255,255,255,.08)" }}>
        <button type="submit" style={{ width: "100%", background: "rgba(255,255,255,.08)", color: "#dbe6ff", border: "none", borderRadius: 10, padding: 11, fontWeight: 700, cursor: "pointer" }}>
          {t(locale, "common.signOut")}
        </button>
      </form>
    </aside>
  );
}
