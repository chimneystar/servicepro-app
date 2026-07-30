import { loadCapabilities, requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { NAV_ITEMS } from "@/lib/nav";
import Link from "next/link";
import { isPlatformAdmin } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";

export default async function MorePage() {
  const profile = await requireProfile();
  const locale = (await getLocale());
  const [capabilitySet, platformAdmin] = await Promise.all([loadCapabilities(profile), profile.role === "owner" ? isPlatformAdmin(profile.id) : Promise.resolve(false)]);
  // The mobile More hub is the complete route directory. Keeping even the
  // bottom-tab destinations here prevents a navigation redesign from making
  // an existing feature unreachable for a role.
  const items = NAV_ITEMS.filter((i) => i.roles.includes(profile.role) && (!i.capability || capabilitySet.has(i.capability)) && (!i.platformOnly || platformAdmin));

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>{t(locale, "nav.more")}</h1>
      <div className="rlist">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="ritem">
            <div className="avatar-sm" style={{ background: "#eef2f8", color: "#2563eb", fontSize: 18 }}>{i.icon}</div>
            <div className="rmain"><div className="rtitle">{t(locale, i.key)}</div></div>
            <span style={{ color: "#b6bfcc", fontSize: 20 }}>›</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
