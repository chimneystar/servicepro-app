import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { t, isLocale, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import LanguageToggle from "@/components/LanguageToggle";
import { INDUSTRY_PACKS, catalogItemsFor } from "@/lib/industry-packs";
import { randomUUID } from "crypto";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const userId = user.id;

  const { data: profile } = await supabase
    .from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
  if (profile?.organization_id) redirect("/");

  // If this user was invited to a business, join it automatically and skip setup.
  const { data: joinedOrg } = await supabase.rpc("accept_invitation");
  if (joinedOrg) redirect("/");

  const c = (await cookies()).get("locale")?.value;
  const locale: Locale = isLocale(c) ? c : DEFAULT_LOCALE;

  async function createOrg(formData: FormData) {
    "use server";
    const orgName = String(formData.get("orgName") ?? "").trim();
    const ownerName = String(formData.get("ownerName") ?? "").trim();
    const lang = String(formData.get("locale") ?? "en");
    const currency = String(formData.get("currency") ?? "USD");
    const taxLabel = String(formData.get("taxLabel") ?? "Sales Tax").trim() || "Sales Tax";
    const taxPct = Number(formData.get("taxRate") ?? 0);
    const taxRateBps = Number.isFinite(taxPct) ? Math.max(0, Math.round(taxPct * 100)) : 0;
    const trades = formData.getAll("trades").map(String).filter((key) => INDUSTRY_PACKS.some((pack) => pack.key === key));
    const includeParts = formData.get("includeParts") === "on";
    const addSampleData = formData.get("sampleData") === "on";
    const packLocale: Locale = isLocale(lang) ? lang : locale;

    const supabase = await createClient();
    const { data: orgId, error } = await supabase.rpc("create_org_and_owner", {
      org_name: orgName, owner_name: ownerName,
    });
    if (error) throw new Error(error.message);

    // Persist locale/currency/tax on the organization (allowed: caller is now owner).
    await supabase.from("organizations")
      .update({ locale: lang, currency, tax_label: taxLabel, tax_rate_bps: taxRateBps })
      .eq("id", orgId as string);

    if (trades.length > 0) {
      const items = catalogItemsFor(trades, includeParts, packLocale);
      const selectedServices = INDUSTRY_PACKS.filter((pack) => trades.includes(pack.key)).flatMap((pack) =>
        pack.items.filter((item) => item.kind === "service").map((item) => ({ pack, item })),
      );
      const { data: batch } = await supabase.from("catalog_import_batches").insert({
        organization_id: orgId,
        source: "onboarding",
        industry_keys: trades,
        included_parts: includeParts,
        item_count: items.length,
        created_by: userId,
      }).select("id").single();
      await supabase.from("organization_industries").insert(trades.map((industryKey) => ({
        organization_id: orgId,
        industry_key: industryKey,
        services_imported: true,
        parts_imported: includeParts,
      })));
      if (items.length > 0) await supabase.from("price_book").insert(items.map((item) => ({ ...item, organization_id: orgId, import_batch_id: batch?.id ?? null })));
      if (selectedServices.length > 0) {
        const jobTypes = selectedServices.map(({ item }, sort) => ({
          id: randomUUID(), organization_id: orgId, name: packLocale === "he" ? item.he : item.en,
          duration_min: 60, default_price_minor: 0, color: "#2b66f6", sort,
        }));
        await supabase.from("job_types").insert(jobTypes);
        await supabase.from("booking_services").upsert(selectedServices.map(({ item }, sort) => ({
          organization_id: orgId, job_type_id: jobTypes[sort].id, name_en: item.en, name_he: item.he,
          duration_min: 60, price_minor: 0, book_as: "job", active: true, sort,
        })), { onConflict: "organization_id,job_type_id" });
      }
    }

    if (addSampleData) {
      const sampleBatchId = randomUUID();
      const { data: customer } = await supabase.from("customers").insert({
        organization_id: orgId,
        name: packLocale === "he" ? "לקוח לדוגמה" : "Sample customer",
        phone: "(555) 010-2026",
        email: "sample@example.com",
        address: "120 Service Lane",
        city: "Austin",
        source: "sample",
        notes: packLocale === "he" ? "רשומה לדוגמה שאפשר למחוק בכל רגע." : "Sample record you can remove at any time.",
        created_by: userId,
        sample_batch_id: sampleBatchId,
      }).select("id").single();
      if (customer?.id) await supabase.from("jobs").insert({
        organization_id: orgId,
        customer_id: customer.id,
        assigned_to: userId,
        service: packLocale === "he" ? "עבודת שירות לדוגמה" : "Sample service job",
        status: "scheduled",
        price_minor: 0,
        scheduled_date: new Date().toISOString().slice(0, 10),
        start_time: "09:00",
        end_time: "10:30",
        notes: packLocale === "he" ? "נסו לפתוח את העבודה ולעבור על שלבי הביצוע." : "Open this job to try the field workflow.",
        created_by: userId,
        sample_batch_id: sampleBatchId,
      });
    }

    // Match the UI language to the business choice.
    if (isLocale(lang)) (await cookies()).set("locale", lang, { path: "/", maxAge: 31536000, sameSite: "lax" });

    revalidatePath("/");
    redirect("/");
  }

  const card: React.CSSProperties = { width: "100%", maxWidth: 880, background: "#fff", borderRadius: 24, padding: 28, boxShadow: "0 20px 50px rgba(15,42,94,.12)" };
  const label: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: "#334155", display: "block", marginBottom: 6 };
  const field: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 12, padding: "11px 13px", fontSize: 15, marginBottom: 14 };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <form action={createOrg} style={card}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <LanguageToggle current={locale} />
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>{t(locale, "onb.welcome")}</h1>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 18 }}>{t(locale, "onb.desc")}</p>

        <label style={label}>{t(locale, "onb.orgName")}</label>
        <input name="orgName" required defaultValue={String(user.user_metadata?.business_name ?? "")} placeholder={t(locale, "onb.orgNamePh")} style={field} />

        <label style={label}>{t(locale, "onb.yourName")}</label>
        <input name="ownerName" defaultValue={String(user.user_metadata?.full_name ?? "")} placeholder={t(locale, "onb.yourNamePh")} style={field} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={label}>{t(locale, "onb.language")}</label>
            <select name="locale" defaultValue={locale} style={field}>
              <option value="en">English</option>
              <option value="he">עברית</option>
            </select>
          </div>
          <div>
            <label style={label}>{t(locale, "onb.currency")}</label>
            <select name="currency" defaultValue="USD" style={field}>
              <option value="USD">USD ($)</option>
              <option value="ILS">ILS (₪)</option>
              <option value="EUR">EUR (€)</option>
            </select>
          </div>
          <div>
            <label style={label}>{t(locale, "onb.taxLabel")}</label>
            <input name="taxLabel" defaultValue="Sales Tax" style={field} />
          </div>
          <div>
            <label style={label}>{t(locale, "onb.taxRate")}</label>
            <input name="taxRate" type="number" step="0.001" min="0" defaultValue="0" placeholder="8.25" style={field} />
          </div>
        </div>

        <div style={{ margin: "8px 0 18px", paddingTop: 18, borderTop: "1px solid #e2e8f0" }}>
          <h2 style={{ fontSize: 17, fontWeight: 850, marginBottom: 5 }}>{locale === "he" ? "אילו שירותים אתם מציעים?" : "What services do you provide?"}</h2>
          <p style={{ color: "#64748b", fontSize: 14, marginBottom: 12 }}>{locale === "he" ? "נוסיף לספר המחירים שירותים שימושיים עם מחיר ריק. אפשר לערוך הכול אחר כך." : "We’ll add a ready-to-use catalog with blank prices. You can edit everything later."}</p>
          <div className="onboarding-trade-grid">
            {INDUSTRY_PACKS.map((pack) => <label key={pack.key} className="onboarding-trade-choice"><input type="checkbox" name="trades" value={pack.key} /><span>{locale === "he" ? pack.he : pack.en}</span><small>{pack.items.filter((item) => item.kind === "service").length} {locale === "he" ? "שירותים" : "services"}</small></label>)}
          </div>
          <label className="onboarding-option"><input type="checkbox" name="includeParts" defaultChecked /><span><b>{locale === "he" ? "להוסיף גם חלקים וחומרים" : "Also add common parts and materials"}</b><small>{locale === "he" ? "גם כאן המחירים נשארים ריקים עד שתעדכנו אותם." : "Their prices also stay blank until you set them."}</small></span></label>
          <label className="onboarding-option"><input type="checkbox" name="sampleData" defaultChecked /><span><b>{locale === "he" ? "להוסיף לקוח ועבודה לדוגמה" : "Add a sample customer and job"}</b><small>{locale === "he" ? "דרך מהירה להכיר את המערכת. הרשומות מסומנות כדוגמה." : "A quick way to learn the workflow. Sample records are clearly marked."}</small></span></label>
        </div>

        <button type="submit" style={{ width: "100%", background: "#2563eb", color: "#fff", border: "none", borderRadius: 12, padding: 14, fontSize: 16, fontWeight: 700, cursor: "pointer" }}>
          {t(locale, "onb.create")}
        </button>
      </form>
    </div>
  );
}
