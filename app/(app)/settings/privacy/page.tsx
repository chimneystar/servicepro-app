import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import PrivacyCenter from "./PrivacyCenter";
import * as profilesRepo from "@/lib/data/profiles";
import * as reporting from "@/lib/data/reporting";

export const dynamic = "force-dynamic";
export default async function PrivacyPage() {
  const profile = await requireProfile();
  if (profile.role !== "owner") redirect(profile.role === "tech" ? "/tech" : "/dispatch");
  const locale = await getLocale(),
    he = locale === "he",
    supabase = await createClient();
  const [{ data: settings }, customers, members, consents, requests, holds, runs] =
    await Promise.all([
      supabase
        .from("organization_privacy_settings")
        .select("*")
        .eq("organization_id", profile.organization_id!)
        .single(),
      reporting.listCustomersForPrivacy(supabase),
      profilesRepo.listActive(supabase),
      reporting.listRecentConsentEvents(supabase, 250),
      reporting.listPrivacyRequests(supabase),
      reporting.listRetentionHolds(supabase),
      reporting.listRecentRetentionRuns(supabase, 10),
    ]);
  const defaults = {
    privacy_email: null,
    privacy_phone: null,
    location_retention_days: 30,
    call_recording_retention_days: 90,
    communication_retention_days: 730,
    job_media_retention_days: 2555,
    audit_retention_days: 2555,
    auto_enforce: false,
  };
  return (
    <div className="ops-page">
      <header className="ops-heading">
        <div>
          <span>{he ? "אמון ושליטה" : "Trust & control"}</span>
          <h1>{he ? "פרטיות ושמירת מידע" : "Privacy & data retention"}</h1>
          <p>
            {he
              ? "מנהלים הסכמות, בקשות לקוחות ומחיקה אחראית בלי לפגוע במסמכים שחייבים לשמור."
              : "Manage consent, customer requests and responsible deletion without losing records that must be retained."}
          </p>
        </div>
        <div className="ops-heading-mark" aria-hidden="true">
          ✓
        </div>
      </header>
      <p style={{ marginBottom: 14, fontSize: "0.875rem" }}>
        {/* `audit_retention_days` was configurable here while the audit log itself had no reader. */}
        <Link href="/settings/security">
          {he ? "יומן הביקורת של העסק ואבטחת חשבון →" : "Business audit log & account security →"}
        </Link>
      </p>
      <PrivacyCenter
        locale={locale}
        settings={(settings ?? defaults) as any}
        customers={customers}
        members={members}
        consents={consents as any}
        requests={requests as any}
        holds={holds as any}
        runs={runs as any}
      />
    </div>
  );
}
