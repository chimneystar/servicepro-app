import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { t, isLocale, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import LanguageToggle from "@/components/LanguageToggle";

export default async function OnboardingPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
  if (profile?.organization_id) redirect("/");

  const c = cookies().get("locale")?.value;
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

    const supabase = createClient();
    const { data: orgId, error } = await supabase.rpc("create_org_and_owner", {
      org_name: orgName, owner_name: ownerName,
    });
    if (error) throw new Error(error.message);

    // Persist locale/currency/tax on the organization (allowed: caller is now owner).
    await supabase.from("organizations")
      .update({ locale: lang, currency, tax_label: taxLabel, tax_rate_bps: taxRateBps })
      .eq("id", orgId as string);

    // Match the UI language to the business choice.
    if (isLocale(lang)) cookies().set("locale", lang, { path: "/", maxAge: 31536000, sameSite: "lax" });

    revalidatePath("/");
    redirect("/");
  }

  const card: React.CSSProperties = { width: "100%", maxWidth: 440, background: "#fff", borderRadius: 20, padding: 28, boxShadow: "0 20px 50px rgba(15,42,94,.12)" };
  const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", marginBottom: 6 };
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
        <input name="orgName" required placeholder={t(locale, "onb.orgNamePh")} style={field} />

        <label style={label}>{t(locale, "onb.yourName")}</label>
        <input name="ownerName" placeholder={t(locale, "onb.yourNamePh")} style={field} />

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

        <button type="submit" style={{ width: "100%", background: "#2563eb", color: "#fff", border: "none", borderRadius: 12, padding: 14, fontSize: 16, fontWeight: 700, cursor: "pointer" }}>
          {t(locale, "onb.create")}
        </button>
      </form>
    </div>
  );
}
