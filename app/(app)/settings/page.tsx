import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import SettingsForm from "./SettingsForm";
import JobTypesEditor from "@/components/JobTypesEditor";
import JobStatusesEditor, { type JobStatus } from "@/components/JobStatusesEditor";
import AppIcon from "@/components/AppIcon";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "owner") redirect("/");
  const locale = await getLocale();
  const he = locale === "he";
  const supabase = await createClient();
  const [{ data: org }, { data: jobTypes }, { data: jobStatuses }] = await Promise.all([
    supabase
      .from("organizations")
      .select(
        "name, tagline, phone, email, address, city, currency, locale, tax_label, tax_rate_bps, invoice_counter, estimate_counter, accent_color, estimate_terms, invoice_terms, document_footer, review_url",
      )
      .eq("id", profile.organization_id!)
      .single(),
    supabase
      .from("job_types")
      .select("id, name, color, duration_min, default_price_minor")
      .order("sort")
      .order("name"),
    supabase
      .from("job_statuses")
      .select("id, name, color, sort, is_done, is_cancelled")
      .order("sort"),
  ]);

  return (
    <div className="settings-shell">
      <header className="settings-heading">
        <div>
          <h1>{he ? "הגדרות" : "Settings"}</h1>
          <p>
            {he
              ? "כל מה שקשור לעסק, למסמכים, לצוות ולאופן העבודה שלך."
              : "Manage your business, documents, team and day-to-day workflow."}
          </p>
        </div>
      </header>
      <div className="settings-grid">
        <div className="settings-main">
          <SettingsForm locale={locale} org={org ?? {}} />
        </div>
        <aside className="settings-side">
          <JobTypesEditor
            locale={locale}
            types={jobTypes ?? []}
            currency={org?.currency ?? "USD"}
          />
          <JobStatusesEditor locale={locale} statuses={(jobStatuses ?? []) as JobStatus[]} />
          <SettingsLink
            href="/settings/booking"
            icon="calendar"
            title={he ? "הזמנה מקוונת" : "Online booking"}
            text={
              he
                ? "שירותים, זמינות, אזורי שירות, מקדמות וקישור לאתר."
                : "Services, availability, service areas, deposits and website link."
            }
          />
          <SettingsLink
            href="/settings/payments"
            icon="payments"
            title={he ? "תשלומים והפקדות" : "Payments & deposits"}
            text={
              he
                ? "Helcim, כרטיס, ACH, Zelle, צ׳קים, מקדמות וקבלות."
                : "Helcim, card, ACH, Zelle, checks, deposits and receipts."
            }
          />
          <SettingsLink
            href="/finance"
            icon="finance"
            title={he ? "כספים, מסים והתאמות" : "Finance, tax & reconciliation"}
            text={
              he
                ? "מעקב אחרי מסים, הפקדות, התאמות בנק ומחלוקות תשלום."
                : "Track tax periods, deposits, bank reconciliation and disputes."
            }
          />
          <SettingsLink
            href="/team"
            icon="team"
            title={he ? "צוות והרשאות" : "Team & permissions"}
            text={
              he
                ? "הזמנת עובדים, בחירת תפקידים ושינוי הרשאות."
                : "Invite teammates, assign roles and manage access."
            }
          />
          <SettingsLink
            href="/appearance"
            icon="appearance"
            title={he ? "מראה ונגישות" : "Appearance & accessibility"}
            text={
              he
                ? "ערכת צבעים, גודל טקסט, ניגודיות והפחתת תנועה."
                : "Theme, text size, contrast and reduced motion."
            }
          />
          <SettingsLink
            href="/settings/privacy"
            icon="privacy"
            title={he ? "פרטיות ושמירת מידע" : "Privacy & data retention"}
            text={
              he
                ? "הסכמות, בקשות פרטיות, תקופות שמירה ומחיקה מבוקרת."
                : "Consent, privacy requests, retention periods and controlled deletion."
            }
          />
          <SettingsLink
            href="/settings/messages"
            icon="messages"
            title={he ? "הודעות ללקוחות" : "Customer messages"}
            text={
              he
                ? "עריכת ההודעות שנשלחות בהזמנה, בתזכורת ובסיום עבודה."
                : "Edit booking, reminder, on-the-way and completion messages."
            }
          />
          <SettingsLink
            href="/settings/custom-fields"
            icon="document"
            title={he ? "שדות מותאמים" : "Custom fields"}
            text={
              he
                ? "מידע נוסף שאתם צריכים בכרטיס הלקוח ובכרטיס העבודה."
                : "Extra information you need on customer and job records."
            }
          />
        </aside>
      </div>
    </div>
  );
}

function SettingsLink({
  href,
  icon,
  title,
  text,
}: {
  href: string;
  icon:
    | "team"
    | "messages"
    | "payments"
    | "calendar"
    | "finance"
    | "appearance"
    | "privacy"
    | "document";
  title: string;
  text: string;
}) {
  return (
    <Link href={href} className="settings-link-card">
      <span className="settings-link-icon">
        <AppIcon name={icon} />
      </span>
      <span className="settings-link-copy">
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      <span className="settings-arrow">›</span>
    </Link>
  );
}
