import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import AccountSecurity from "./AccountSecurity";
import AuditLog, { type AuditRow, type AuditFilters } from "./AuditLog";
import * as profilesRepo from "@/lib/data/profiles";
import * as reporting from "@/lib/data/reporting";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * The security centre (ledger 6b.2, 6b.3, 6b.4, 6b.5, 6b.6).
 *
 * "What changed in my business last week, and who did it?" was unanswerable.
 * `audit_log` had exactly one reader in the whole product — a 30-row timeline
 * on a single record — so a populated, correct audit trail was, in practice,
 * write-only. This page is its first real reader, alongside the three streams
 * that did not exist at all before migration 038: permission changes, sign-in
 * attempts and e-signature evidence.
 *
 * Every member gets the account half (password, two-factor, devices). Only an
 * owner gets the business half, which is exactly what the RLS policies in
 * migration 038 §8 allow — the screen and the database agree.
 */
export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireProfile();
  const locale = await getLocale();
  const he = locale === "he";
  const supabase = await createClient();
  const isOwner = profile.role === "owner";

  const query = await searchParams;
  const one = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const filters: AuditFilters = {
    from: (one("from") ?? "").slice(0, 10),
    to: (one("to") ?? "").slice(0, 10),
    table: one("table") ?? "",
    action: one("action") ?? "",
    actor: one("actor") ?? "",
    page: Math.max(1, Number(one("page") ?? 1) || 1),
  };

  const [{ data: security }, myEvents] = await Promise.all([
    supabase
      .from("profile_security")
      .select(
        "login_alerts_enabled, mfa_enrolled_at, mfa_removed_at, sessions_revoked_at, last_password_change_at, last_sign_in_at",
      )
      .eq("profile_id", profile.id)
      .maybeSingle(),
    reporting.listAccountSecurityEvents(supabase, profile.id, 40),
  ]);

  let audit: AuditRow[] = [];
  let auditTotal = 0;
  let permissionChanges: any[] = [];
  let loginAttempts: any[] = [];
  let signatures: any[] = [];
  let people: { id: string; full_name: string }[] = [];

  if (isOwner) {
    const [auditResult, permissions, attempts, signed, members] = await Promise.all([
      reporting.listAuditLogPage(
        supabase,
        filters,
        profile.organization_id!,
        filters.page,
        PAGE_SIZE,
      ),
      reporting.listRecentPermissionChanges(supabase, 60),
      reporting.listRecentLoginAttempts(supabase, 60),
      reporting.listRecentSignatureEvents(supabase, 30),
      profilesRepo.listInOrganization(supabase, profile.organization_id!),
    ]);

    audit = auditResult.rows as AuditRow[];
    auditTotal = auditResult.total;
    permissionChanges = permissions;
    loginAttempts = attempts;
    signatures = signed;
    people = members as { id: string; full_name: string }[];
  }

  return (
    <div className="ops-page">
      <header className="ops-heading">
        <div>
          <span>{he ? "אבטחה" : "Security"}</span>
          <h1>{he ? "אבטחת חשבון ויומן ביקורת" : "Account security & audit log"}</h1>
          <p>
            {he
              ? "סיסמה, אימות דו-שלבי, ניתוק מכשירים — ולבעלים, מה השתנה בעסק ומי עשה זאת."
              : "Password, two-factor, device sign-out — and, for the owner, what changed in the business and who did it."}
          </p>
        </div>
        <div className="ops-heading-mark" aria-hidden="true">
          🔒
        </div>
      </header>

      <AccountSecurity
        locale={locale}
        security={security ?? null}
        events={myEvents as any[]}
        role={profile.role}
      />

      {isOwner ? (
        <AuditLog
          locale={locale}
          filters={filters}
          rows={audit}
          total={auditTotal}
          pageSize={PAGE_SIZE}
          people={people}
          permissionChanges={permissionChanges}
          loginAttempts={loginAttempts}
          signatures={signatures}
        />
      ) : (
        <p className="ops-empty">
          {he
            ? "יומן הביקורת של העסק זמין לבעלים בלבד."
            : "The business audit log is available to the owner."}
        </p>
      )}

      <p className="settings-section-note" style={{ marginTop: 16 }}>
        <Link href="/settings/privacy">
          {he ? "פרטיות ושמירת מידע" : "Privacy & data retention"}
        </Link>
        {" · "}
        <Link href="/team">{he ? "צוות והרשאות" : "Team & permissions"}</Link>
      </p>
    </div>
  );
}
