import { loadCapabilities, requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { NAV_ITEMS, splitNavigation } from "@/lib/nav";
import Link from "next/link";
import { isPlatformAdmin } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";

export default async function MorePage() {
  const profile = await requireProfile();
  const locale = await getLocale();
  const [capabilitySet, platformAdmin] = await Promise.all([
    loadCapabilities(profile),
    profile.role === "owner" ? isPlatformAdmin(profile.id) : Promise.resolve(false),
  ]);
  const mine = NAV_ITEMS.filter(
    (i) =>
      i.roles.includes(profile.role) &&
      (!i.capability || capabilitySet.has(i.capability)) &&
      (!i.platformOnly || platformAdmin),
  );
  // The mobile More hub is the complete route directory. Keeping even the
  // bottom-tab destinations here prevents a navigation redesign from making an
  // existing feature unreachable for a role.
  //
  // That is the same goal AUDIT A4 came at from the other side, so both
  // mechanisms stay. `splitNavigation` is still the single authority on what
  // the tab bar carries — re-filtering this page to exclude the tab-bar rows is
  // exactly what hid the overflow before, and Invoices was then reachable
  // nowhere on a phone: dropped by the bar's cut and excluded again here.
  // Here the split decides only the ORDER: what the tab bar could not carry is
  // listed first, then the rest, then the destinations that are also tabs. The
  // directory decides the CONTENTS, which is everything.
  const { tabs, more } = splitNavigation(mine);
  const items = [...more, ...tabs];

  return (
    <div>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: 16 }}>
        {t(locale, "nav.more")}
      </h1>
      <div className="rlist">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="ritem">
            <div
              className="avatar-sm"
              style={{ background: "#eef2f8", color: "#2563eb", fontSize: "1.125rem" }}
            >
              {i.icon}
            </div>
            <div className="rmain">
              <div className="rtitle">{t(locale, i.key)}</div>
            </div>
            <span style={{ color: "#b6bfcc", fontSize: "1.25rem" }}>›</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
