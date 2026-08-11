import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdmin } from "@/lib/platform-admin";
import AdminConsole from "./AdminConsole";
import * as fieldData from "@/lib/data/field";

export const dynamic = "force-dynamic";
export default async function AdminPage() {
  const profile = await requireProfile(),
    platform = await getPlatformAdmin(profile.id);
  if (!platform) redirect("/");
  const locale = await getLocale(),
    he = locale === "he",
    admin = createAdminClient();
  const [orgRows, memberRows, privacyRows, merchantRows, cases, sessions, flags, releases] =
    await Promise.all([
      fieldData.listAllOrganizationsForAdmin(admin),
      fieldData.listActiveProfilesForAdmin(admin),
      fieldData.listPrivacySettingsForAdmin(admin),
      fieldData.listMerchantConnectionsForAdmin(admin),
      fieldData.listSupportCasesForAdmin(admin, 100),
      fieldData.listSupportSessionsForAdmin(admin, 100),
      fieldData.listFeatureFlagsForAdmin(admin),
      fieldData.listReleaseRecordsForAdmin(admin),
    ]);
  const orgs = orgRows.map((row) => ({
    ...row,
    members: memberRows.filter((member) => member.organization_id === row.id).length,
    privacyReady: Boolean(
      privacyRows.find((item) => item.organization_id === row.id)?.privacy_email,
    ),
    merchantStatus:
      merchantRows.find((item) => item.organization_id === row.id)?.status || "not connected",
  }));
  return (
    <div className="ops-page">
      <header className="ops-heading">
        <div>
          <span>{he ? "תפעול ServicePro" : "ServicePro operations"}</span>
          <h1>{he ? "תמיכה וגרסאות מבוקרות" : "Support & controlled releases"}</h1>
          <p>
            {he
              ? "מטפלים בתקלות, מגבילים גישת תמיכה ושומרים על כל תכונה לפני פרסום."
              : "Resolve issues, constrain support access and protect every product capability before release."}
          </p>
        </div>
        <div className="ops-heading-mark" aria-hidden="true">
          SP
        </div>
      </header>
      <AdminConsole
        locale={locale}
        role={platform.role}
        organizations={orgs}
        cases={cases as any}
        sessions={sessions as any}
        flags={flags}
        releases={releases as any}
      />
    </div>
  );
}
