import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { t, isLocale, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import LanguageToggle from "@/components/LanguageToggle";
import { INDUSTRY_PACKS, bookableServicesFor, catalogItemsFor } from "@/lib/industry-packs";
import { randomUUID } from "crypto";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const userId = user.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.organization_id) redirect("/");

  // Joining a business now requires the token from the invitation email, which
  // `/join` parked in an httpOnly cookie. Acceptance used to match on EMAIL
  // ALONE — the generated token was never checked by anything, so possession of
  // a mailbox was the entire control.
  const inviteToken = (await cookies()).get("invite_token")?.value ?? "";
  let joinError: "mismatch" | null = null;
  if (inviteToken) {
    const { data: joinedOrg, error: joinRpcError } = await supabase.rpc("accept_invitation", {
      invite_token: inviteToken,
    });
    if (joinedOrg) redirect("/");
    if (joinRpcError?.message?.includes("invitation_email_mismatch")) joinError = "mismatch";
  }

  // Requiring the token must not strand someone who signed up without opening
  // the link: tell them an invitation is waiting instead of letting them create
  // a second business by accident. This reveals no token and grants nothing.
  const { data: hintRows } = await supabase.rpc("pending_invitation_hint");
  const pendingInvite = Array.isArray(hintRows) ? hintRows[0] : hintRows;

  const c = (await cookies()).get("locale")?.value;
  const locale: Locale = isLocale(c) ? c : DEFAULT_LOCALE;

  async function createOrg(formData: FormData) {
    "use server";
    const orgName = String(formData.get("orgName") ?? "").trim();
    const ownerName = String(formData.get("ownerName") ?? "").trim();
    // `organizations.locale` is CHECK-constrained to 'en' and 'he'; this write
    // was unvalidated, same as the one in settings/actions.ts. `isLocale` is
    // this codebase's own guard for exactly that set — it was imported here
    // already and used for the page's own locale, just not for the write.
    const langRaw = String(formData.get("locale") ?? "en");
    const lang = isLocale(langRaw) ? langRaw : DEFAULT_LOCALE;
    // USD only — see the note on the currency field below.
    const currency = "USD";
    const taxLabel = String(formData.get("taxLabel") ?? "Sales Tax").trim() || "Sales Tax";
    const taxPct = Number(formData.get("taxRate") ?? 0);
    const taxRateBps = Number.isFinite(taxPct) ? Math.max(0, Math.round(taxPct * 100)) : 0;
    const trades = formData
      .getAll("trades")
      .map(String)
      .filter((key) => INDUSTRY_PACKS.some((pack) => pack.key === key));
    const includeParts = formData.get("includeParts") === "on";
    const addSampleData = formData.get("sampleData") === "on";
    const packLocale: Locale = isLocale(lang) ? lang : locale;

    const supabase = await createClient();
    const { data: orgId, error } = await supabase.rpc("create_org_and_owner", {
      org_name: orgName,
      owner_name: ownerName,
    });
    if (error) throw new Error(error.message);

    // Persist locale/currency/tax on the organization (allowed: caller is now owner).
    await supabase
      .from("organizations")
      .update({ locale: lang, currency, tax_label: taxLabel, tax_rate_bps: taxRateBps })
      .eq("id", orgId as string);

    if (trades.length > 0) {
      const items = catalogItemsFor(trades, includeParts, packLocale);
      const { data: batch } = await supabase
        .from("catalog_import_batches")
        .insert({
          organization_id: orgId,
          source: "onboarding",
          industry_keys: trades,
          included_parts: includeParts,
          item_count: items.length,
          created_by: userId,
        })
        .select("id")
        .single();
      await supabase.from("organization_industries").insert(
        trades.map((industryKey) => ({
          organization_id: orgId,
          industry_key: industryKey,
          services_imported: true,
          parts_imported: includeParts,
        })),
      );
      if (items.length > 0)
        await supabase.from("price_book").insert(
          items.map((item) => ({
            ...item,
            organization_id: orgId,
            import_batch_id: batch?.id ?? null,
          })),
        );
    }

    // What this business will actually publish for booking: the trades it just
    // chose, in BOTH languages — or the neutral fallback list if it chose none,
    // which is still its own list rather than migration 005's HVAC menu.
    //
    // `name` keeps the business's own language for its own screens, while
    // `name_en` / `name_he` (migration 041) carry the translations the public
    // page needs. The booking_services upsert below is deliberately explicit
    // and not left to the 041 sync trigger alone: it also sets `book_as` and
    // `sort`, which no job type carries.
    const bookable = bookableServicesFor(trades, packLocale);
    if (bookable.length > 0) {
      const jobTypes = bookable.map((service) => ({
        id: randomUUID(),
        organization_id: orgId,
        name: service.name,
        name_en: service.name_en,
        name_he: service.name_he,
        pack_key: service.pack_key,
        pack_item_key: service.pack_item_key,
        duration_min: 60,
        default_price_minor: 0,
        color: "#2b66f6",
        sort: service.sort,
      }));
      await supabase.from("job_types").insert(jobTypes);
      await supabase.from("booking_services").upsert(
        bookable.map((service, index) => ({
          organization_id: orgId,
          job_type_id: jobTypes[index].id,
          name_en: service.name_en,
          name_he: service.name_he,
          duration_min: 60,
          price_minor: 0,
          book_as: service.book_as,
          active: true,
          sort: service.sort,
        })),
        { onConflict: "organization_id,job_type_id" },
      );
    }

    if (addSampleData) {
      const sampleBatchId = randomUUID();
      const { data: customer } = await supabase
        .from("customers")
        .insert({
          organization_id: orgId,
          name: packLocale === "he" ? "לקוח לדוגמה" : "Sample customer",
          phone: "(555) 010-2026",
          email: "sample@example.com",
          address: "120 Service Lane",
          city: "Austin",
          source: "sample",
          notes:
            packLocale === "he"
              ? "רשומה לדוגמה שאפשר למחוק בכל רגע."
              : "Sample record you can remove at any time.",
          created_by: userId,
          sample_batch_id: sampleBatchId,
        })
        .select("id")
        .single();
      if (customer?.id)
        await supabase.from("jobs").insert({
          organization_id: orgId,
          customer_id: customer.id,
          assigned_to: userId,
          service: packLocale === "he" ? "עבודת שירות לדוגמה" : "Sample service job",
          status: "scheduled",
          price_minor: 0,
          scheduled_date: new Date().toISOString().slice(0, 10),
          start_time: "09:00",
          end_time: "10:30",
          notes:
            packLocale === "he"
              ? "נסו לפתוח את העבודה ולעבור על שלבי הביצוע."
              : "Open this job to try the field workflow.",
          created_by: userId,
          sample_batch_id: sampleBatchId,
        });
    }

    // Match the UI language to the business choice.
    if (isLocale(lang))
      (await cookies()).set("locale", lang, { path: "/", maxAge: 31536000, sameSite: "lax" });

    revalidatePath("/");
    redirect("/");
  }

  const card: React.CSSProperties = {
    width: "100%",
    maxWidth: 880,
    background: "#fff",
    borderRadius: 24,
    padding: 28,
    boxShadow: "0 20px 50px rgba(15,42,94,.12)",
  };
  const label: React.CSSProperties = {
    fontSize: "0.875rem",
    fontWeight: 700,
    color: "#334155",
    display: "block",
    marginBottom: 6,
  };
  const field: React.CSSProperties = {
    width: "100%",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "11px 13px",
    fontSize: "0.9375rem",
    marginBottom: 14,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <form action={createOrg} style={card}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <LanguageToggle current={locale} />
        </div>
        <h1 style={{ fontSize: "1.375rem", fontWeight: 800, marginBottom: 4 }}>
          {t(locale, "onb.welcome")}
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.875rem", marginBottom: 18 }}>
          {t(locale, "onb.desc")}
        </p>

        {joinError === "mismatch" && (
          <div
            style={{
              background: "#fdeaea",
              color: "#b91c1c",
              padding: "11px 14px",
              borderRadius: 12,
              fontSize: "0.875rem",
              marginBottom: 14,
            }}
          >
            {locale === "he"
              ? "ההזמנה הזו נשלחה לכתובת אימייל אחרת. התחברו עם הכתובת שאליה נשלחה ההזמנה, או בקשו מבעל העסק לשלוח הזמנה חדשה."
              : "That invitation was sent to a different email address. Sign in with the address it was sent to, or ask the business owner to send a new invitation."}
          </div>
        )}
        {!joinError && pendingInvite?.organization_name && (
          <div
            style={{
              background: "#fff5e0",
              color: "#a15c07",
              padding: "11px 14px",
              borderRadius: 12,
              fontSize: "0.875rem",
              marginBottom: 14,
            }}
          >
            {locale === "he"
              ? `${pendingInvite.organization_name} הזמינו אתכם להצטרף. פתחו את קישור ההצטרפות מהמייל ששלחנו ל-${pendingInvite.invited_email} כדי להצטרף אליהם במקום ליצור עסק חדש. אם המייל לא הגיע, בקשו מהם לשלוח שוב.`
              : `${pendingInvite.organization_name} has invited you to join. Open the join link in the email we sent to ${pendingInvite.invited_email} to join them instead of creating a new business. If it didn't arrive, ask them to resend it.`}
          </div>
        )}

        <label style={label}>{t(locale, "onb.orgName")}</label>
        <input
          name="orgName"
          required
          defaultValue={String(user.user_metadata?.business_name ?? "")}
          placeholder={t(locale, "onb.orgNamePh")}
          style={field}
        />

        <label style={label}>{t(locale, "onb.yourName")}</label>
        <input
          name="ownerName"
          defaultValue={String(user.user_metadata?.full_name ?? "")}
          placeholder={t(locale, "onb.yourNamePh")}
          style={field}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={label}>{t(locale, "onb.language")}</label>
            <select name="locale" defaultValue={locale} style={field}>
              <option value="en">English</option>
              <option value="he">עברית</option>
            </select>
          </div>
          <div>
            {/*
              USD only. The payment layer is USD-only end to end: Helcim card and
              ACH explicitly refuse a non-USD document, and manual (Zelle/cheque)
              submission violates a CHECK constraint outright. Offering ILS or EUR
              here handed the business a working-looking setup with no functioning
              payment method at all. Language is a separate setting and is
              unaffected — the Hebrew interface still works with USD billing.
            */}
            <label style={label}>{t(locale, "onb.currency")}</label>
            <select name="currency" defaultValue="USD" style={field}>
              <option value="USD">USD ($)</option>
            </select>
          </div>
          <div>
            <label style={label}>{t(locale, "onb.taxLabel")}</label>
            <input name="taxLabel" defaultValue="Sales Tax" style={field} />
          </div>
          <div>
            <label style={label}>{t(locale, "onb.taxRate")}</label>
            <input
              name="taxRate"
              type="number"
              step="0.001"
              min="0"
              defaultValue="0"
              placeholder="8.25"
              style={field}
            />
          </div>
        </div>

        <div style={{ margin: "8px 0 18px", paddingTop: 18, borderTop: "1px solid #e2e8f0" }}>
          <h2 style={{ fontSize: "1.0625rem", fontWeight: 850, marginBottom: 5 }}>
            {locale === "he" ? "אילו שירותים אתם מציעים?" : "What services do you provide?"}
          </h2>
          <p style={{ color: "#64748b", fontSize: "0.875rem", marginBottom: 12 }}>
            {locale === "he"
              ? "נוסיף לספר המחירים שירותים שימושיים עם מחיר ריק, ואותם שירותים יופיעו — באנגלית ובעברית — בעמוד ההזמנות לציבור. אם לא תבחרו תחום, נוסיף רשימת ביקורים כללית קצרה כדי שעמוד ההזמנות לא יישאר ריק. אפשר לערוך הכול אחר כך."
              : "We’ll add a ready-to-use catalog with blank prices, and the same services become your public booking menu in both English and Hebrew. Pick nothing and we add a short general visit list instead, so your booking page is never empty. You can edit everything later."}
          </p>
          <div className="onboarding-trade-grid">
            {INDUSTRY_PACKS.map((pack) => (
              <label key={pack.key} className="onboarding-trade-choice">
                <input type="checkbox" name="trades" value={pack.key} />
                <span>{locale === "he" ? pack.he : pack.en}</span>
                <small>
                  {pack.items.filter((item) => item.kind === "service").length}{" "}
                  {locale === "he" ? "שירותים" : "services"}
                </small>
              </label>
            ))}
          </div>
          <label className="onboarding-option">
            <input type="checkbox" name="includeParts" defaultChecked />
            <span>
              <b>
                {locale === "he"
                  ? "להוסיף גם חלקים וחומרים"
                  : "Also add common parts and materials"}
              </b>
              <small>
                {locale === "he"
                  ? "גם כאן המחירים נשארים ריקים עד שתעדכנו אותם."
                  : "Their prices also stay blank until you set them."}
              </small>
            </span>
          </label>
          <label className="onboarding-option">
            <input type="checkbox" name="sampleData" defaultChecked />
            <span>
              <b>
                {locale === "he" ? "להוסיף לקוח ועבודה לדוגמה" : "Add a sample customer and job"}
              </b>
              <small>
                {locale === "he"
                  ? "דרך מהירה להכיר את המערכת. הרשומות מסומנות כדוגמה."
                  : "A quick way to learn the workflow. Sample records are clearly marked."}
              </small>
            </span>
          </label>
        </div>

        <button
          type="submit"
          style={{
            width: "100%",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 12,
            padding: 14,
            fontSize: "1rem",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {t(locale, "onb.create")}
        </button>
      </form>
    </div>
  );
}
