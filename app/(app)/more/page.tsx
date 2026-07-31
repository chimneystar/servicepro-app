import { loadCapabilities, requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { NAV_ITEMS, splitNavigation } from "@/lib/nav";
import Link from "next/link";
import { isPlatformAdmin } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";

export default async function MorePage() {
  const profile = await requireProfile();
  const locale = (await getLocale());
  const [capabilitySet, platformAdmin] = await Promise.all([loadCapabilities(profile), profile.role === "owner" ? isPlatformAdmin(profile.id) : Promise.resolve(false)]);
  // Same split as the tab bar. Filtering on `!i.bottom` here is what hid the
  // overflow: an item the tab bar had already dropped was excluded again.
  const mine = NAV_ITEMS.filter((i) => i.roles.includes(profile.role) && (!i.capability || capabilitySet.has(i.capability)) && (!i.platformOnly || platformAdmin));
  const items = splitNavigation(mine).more;

  return (
    <div>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: 16 }}>{t(locale, "nav.more")}</h1>
      <div className="rlist">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="ritem">
            <div className="avatar-sm" style={{ background: "#eef2f8", color: "#2563eb", fontSize: "1.125rem" }}>{i.icon}</div>
            <div className="rmain"><div className="rtitle">{t(locale, i.key)}</div></div>
            <span style={{ color: "#b6bfcc", fontSize: "1.25rem" }}>›</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
