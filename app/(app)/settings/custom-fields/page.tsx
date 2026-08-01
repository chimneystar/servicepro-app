import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import CustomFieldsEditor from "./CustomFieldsEditor";
import type { CustomFieldDefinition } from "./load";

export const dynamic = "force-dynamic";

/**
 * Custom field definitions (ledger 5.10).
 *
 * `custom_field_definitions` and `custom_field_values` were created by migration
 * 019 in 2026 and had zero references anywhere in `app/`, `components/` or
 * `lib/` — there was no way to define a field, fill one in, or see one. This is
 * where they are defined; they are filled in and shown on the customer and job
 * records themselves.
 */
export default async function CustomFieldsPage() {
  const profile = await requireProfile();
  if (profile.role !== "owner") redirect("/");
  const locale = await getLocale();
  const he = locale === "he";
  const supabase = await createClient();
  const { data } = await supabase
    .from("custom_field_definitions")
    .select("id, label, entity_type, field_type, options_json, required, active, sort")
    .order("sort")
    .order("label");
  const definitions = (data ?? []) as CustomFieldDefinition[];

  return (
    <div className="settings-shell">
      <header className="settings-heading">
        <div>
          <Link href="/settings" className="sp-link">
            {he ? "‹ הגדרות" : "‹ Settings"}
          </Link>
          <h1>{he ? "שדות מותאמים" : "Custom fields"}</h1>
          <p>
            {he
              ? "מידע שהעסק שלכם צריך ולא קיים במסך — קוד שער, מספר יחידה, סוג חוזה. השדות מופיעים בכרטיס הלקוח ובכרטיס העבודה."
              : "The information your business needs that isn't already on the screen — a gate code, a unit number, a contract type. Fields appear on the customer and job records."}
          </p>
        </div>
      </header>
      <div className="settings-grid">
        <div className="settings-main">
          <CustomFieldsEditor
            locale={locale}
            entityType="customer"
            definitions={definitions.filter((d) => d.entity_type === "customer")}
          />
        </div>
        <aside className="settings-side">
          <CustomFieldsEditor
            locale={locale}
            entityType="job"
            definitions={definitions.filter((d) => d.entity_type === "job")}
          />
        </aside>
      </div>
    </div>
  );
}
