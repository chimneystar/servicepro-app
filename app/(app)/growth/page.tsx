import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import {
  createCampaign,
  createReferralProgram,
  issueReferral,
  pauseCampaign,
  recordAdSpend,
  scheduleCampaign,
  scheduleEstimateFollowup,
} from "./actions";
import ActionForm from "@/components/ActionForm";

export const dynamic = "force-dynamic";

export default async function GrowthPage() {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/tech");
  const locale = await getLocale();
  const he = locale === "he";
  const supabase = await createClient();
  const [
    { data: campaigns },
    { data: programs },
    { data: referrals },
    { data: customers },
    { data: spend },
    { data: estimates },
    { data: followups },
    { data: leads },
    { data: org },
  ] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id,name,channel,status,scheduled_at,sent_count")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("referral_programs")
      .select("id,name,reward_text,active")
      .order("created_at", { ascending: false }),
    // Issued referral codes and the customers who can be given one. Both are new:
    // nothing in the product ever created a `referrals` row before (ledger 5.9).
    supabase
      .from("referrals")
      .select("id,code,status,channel,sent_at,error_message,referrer_customer_id")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("customers")
      .select("id,name")
      .is("deleted_at", null)
      .eq("archived", false)
      .order("name")
      .limit(200),
    supabase
      .from("lead_attribution_costs")
      .select("id,source,campaign,period_start,period_end,spend_minor")
      .order("period_start", { ascending: false })
      .limit(20),
    supabase
      .from("estimates")
      .select("id,number,status,customers!estimates_customer_id_fkey(name)")
      .in("status", ["draft", "sent"])
      .is("deleted_at", null)
      .order("issue_date", { ascending: false })
      .limit(40),
    supabase
      .from("estimate_followups")
      .select("id,estimate_id,channel,scheduled_at,status")
      .order("scheduled_at", { ascending: false })
      .limit(20),
    supabase.from("leads").select("id,source,status").is("deleted_at", null),
    supabase.from("organizations").select("currency").single(),
  ]);
  const currency = org?.currency ?? "USD";
  const money = (minor: number) =>
    new Intl.NumberFormat(he ? "he-IL" : "en-US", { style: "currency", currency }).format(
      minor / 100,
    );
  const saved = he ? "נשמר" : "Saved";
  const leadCounts = Object.entries(
    (leads ?? []).reduce<Record<string, number>>((acc, lead) => {
      const key = lead.source || (he ? "לא ידוע" : "Unknown");
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  return (
    <div className="growth-page">
      <header className="growth-hero">
        <div>
          <span>{he ? "צמיחה והכנסות" : "Growth & revenue"}</span>
          <h1>{he ? "להפוך יותר פניות לעבודות" : "Turn more interest into booked work"}</h1>
          <p>
            {he
              ? "קמפיינים, הפניות, מעקב אחרי הצעות ומדידה של מקורות הלידים."
              : "Campaigns, referrals, estimate follow-up and lead-source measurement."}
          </p>
        </div>
        <Link href="/leads">{he ? "פתיחת צינור המכירות" : "Open sales pipeline"}</Link>
      </header>
      <div className="growth-stats">
        <article>
          <small>{he ? "לידים פעילים" : "Active leads"}</small>
          <strong>{leads?.length ?? 0}</strong>
        </article>
        <article>
          <small>{he ? "קמפיינים" : "Campaigns"}</small>
          <strong>{campaigns?.length ?? 0}</strong>
        </article>
        <article>
          <small>{he ? "מעקבים מתוזמנים" : "Scheduled follow-ups"}</small>
          <strong>{(followups ?? []).filter((row) => row.status === "scheduled").length}</strong>
        </article>
        <article>
          <small>{he ? "הוצאות פרסום שתועדו" : "Recorded ad spend"}</small>
          <strong>{money((spend ?? []).reduce((sum, row) => sum + row.spend_minor, 0))}</strong>
        </article>
      </div>
      <div className="growth-grid">
        <GrowthCard title={he ? "קמפיין אימייל או SMS" : "Email or SMS campaign"}>
          <ActionForm action={createCampaign} className="ops-form" successLabel={saved}>
            <input
              name="name"
              required
              placeholder={he ? "שם הקמפיין" : "Campaign name"}
              aria-label={he ? "שם הקמפיין" : "Campaign name"}
            />
            <div className="ops-form-row">
              <select name="channel" aria-label={he ? "ערוץ" : "Channel"}>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="both">Email + SMS</option>
              </select>
              <select name="segment" aria-label={he ? "קהל יעד" : "Audience"}>
                <option value="all_customers">
                  {he ? "כל הלקוחות שאישרו קבלת הודעות" : "All opted-in customers"}
                </option>
                <option value="past_due">{he ? "חשבוניות באיחור" : "Past-due invoices"}</option>
                <option value="inactive">{he ? "לקוחות לא פעילים" : "Inactive customers"}</option>
              </select>
            </div>
            <input
              name="subject"
              placeholder={he ? "נושא לאימייל" : "Email subject"}
              aria-label={he ? "נושא לאימייל" : "Email subject"}
            />
            <textarea
              name="body"
              required
              placeholder={
                he ? "כותבים כאן הודעה ברורה ואישית." : "Write a clear, personal message."
              }
              aria-label={
                he ? "כותבים כאן הודעה ברורה ואישית." : "Write a clear, personal message."
              }
            />
            <button type="submit">{he ? "שמירה כטיוטה" : "Save draft"}</button>
          </ActionForm>
          <p className="ops-message">
            {he
              ? "קמפיין מתוזמן נשלח על ידי המשימה היומית, פעם אחת בלבד לכל נמען, ורק ללקוחות שלא ביטלו את ההסכמה לערוץ."
              : "A scheduled campaign is sent by the daily job — once per recipient, and only to customers who have not opted out of that channel."}
          </p>
          <div className="growth-mini-list">
            {(campaigns ?? []).map((row) => (
              <div key={row.id}>
                <strong>{row.name}</strong>
                <small>
                  {row.channel.toUpperCase()} · {row.status}
                  {row.scheduled_at
                    ? ` · ${new Intl.DateTimeFormat(he ? "he-IL" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.scheduled_at))}`
                    : ""}
                  {row.status === "sent" ? ` · ${row.sent_count} ${he ? "נשלחו" : "sent"}` : ""}
                </small>
                {(row.status === "draft" || row.status === "paused") && (
                  <ActionForm
                    action={scheduleCampaign}
                    className="ops-inline-form"
                    successLabel={saved}
                  >
                    <input type="hidden" name="id" value={row.id} />
                    <input
                      name="sendAt"
                      type="datetime-local"
                      aria-label={he ? "מועד שליחה" : "Send time"}
                    />
                    <button type="submit">{he ? "תזמון שליחה" : "Schedule send"}</button>
                  </ActionForm>
                )}
                {row.status === "scheduled" && (
                  <ActionForm
                    action={pauseCampaign}
                    className="ops-inline-form"
                    successLabel={saved}
                  >
                    <input type="hidden" name="id" value={row.id} />
                    <button type="submit">{he ? "השהיה" : "Pause"}</button>
                  </ActionForm>
                )}
              </div>
            ))}
          </div>
        </GrowthCard>
        <GrowthCard title={he ? "תוכנית הפניות" : "Referral program"}>
          <ActionForm action={createReferralProgram} className="ops-form" successLabel={saved}>
            <input
              name="name"
              required
              placeholder={he ? "שם התוכנית" : "Program name"}
              aria-label={he ? "שם התוכנית" : "Program name"}
            />
            <input
              name="rewardText"
              required
              placeholder={he ? "למשל: 50$ זיכוי לכל צד" : "e.g. $50 credit for each side"}
              aria-label={he ? "למשל: 50$ זיכוי לכל צד" : "e.g. $50 credit for each side"}
            />
            <button type="submit">{he ? "יצירת תוכנית" : "Create program"}</button>
          </ActionForm>
          <MiniList
            rows={(programs ?? []).map((row) => ({ title: row.name, detail: row.reward_text }))}
          />
          {(programs ?? []).some((row) => row.active) && (
            <ActionForm action={issueReferral} className="ops-form" successLabel={saved}>
              <div className="ops-form-row">
                <select name="programId" required aria-label={he ? "תוכנית" : "Program"}>
                  {(programs ?? [])
                    .filter((row) => row.active)
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                </select>
                <select name="channel" aria-label={he ? "ערוץ" : "Channel"}>
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                </select>
              </div>
              <select name="customerId" required aria-label={he ? "לקוח" : "Customer"}>
                <option value="">{he ? "בחירת לקוח" : "Choose customer"}</option>
                {(customers ?? []).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
              <button type="submit">{he ? "שליחת קוד הפניה" : "Send referral code"}</button>
            </ActionForm>
          )}
          <div className="growth-mini-list">
            {(referrals ?? []).slice(0, 5).map((row) => (
              <div key={row.id}>
                <strong>
                  {row.code} ·{" "}
                  {(customers ?? []).find((customer) => customer.id === row.referrer_customer_id)
                    ?.name ?? ""}
                </strong>
                <small>
                  {row.channel ?? ""} ·{" "}
                  {row.sent_at
                    ? he
                      ? "נשלח"
                      : "sent"
                    : row.error_message
                      ? `${he ? "נכשל" : "failed"}: ${row.error_message}`
                      : he
                        ? "לא נשלח"
                        : "not sent"}
                </small>
              </div>
            ))}
          </div>
        </GrowthCard>
        <GrowthCard title={he ? "מעקב אוטומטי אחרי הצעה" : "Estimate follow-up"}>
          <ActionForm action={scheduleEstimateFollowup} className="ops-form" successLabel={saved}>
            <select name="estimateId" required aria-label={he ? "הצעה" : "Estimate"}>
              <option value="">{he ? "בחירת הצעה" : "Choose estimate"}</option>
              {(estimates ?? []).map((row) => {
                const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
                return (
                  <option key={row.id} value={row.id}>
                    #{row.number} · {customer?.name}
                  </option>
                );
              })}
            </select>
            <div className="ops-form-row">
              <select name="channel" aria-label={he ? "ערוץ" : "Channel"}>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
              <input
                name="scheduledAt"
                type="datetime-local"
                required
                aria-label={he ? "מועד מתוזמן" : "Scheduled time"}
              />
            </div>
            <button type="submit">{he ? "תזמון מעקב" : "Schedule follow-up"}</button>
          </ActionForm>
          <MiniList
            rows={(followups ?? []).map((row) => ({
              title: `${row.channel.toUpperCase()} · ${new Intl.DateTimeFormat(he ? "he-IL" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.scheduled_at))}`,
              detail: row.status,
            }))}
          />
        </GrowthCard>
        <GrowthCard title={he ? "עלות פרסום ומקורות לידים" : "Ad spend & lead sources"}>
          <ActionForm action={recordAdSpend} className="ops-form" successLabel={saved}>
            <div className="ops-form-row">
              <input
                name="source"
                required
                placeholder={he ? "מקור, למשל Google" : "Source, e.g. Google"}
                aria-label={he ? "מקור, למשל Google" : "Source, e.g. Google"}
              />
              <input
                name="campaign"
                placeholder={he ? "שם קמפיין" : "Campaign"}
                aria-label={he ? "שם קמפיין" : "Campaign"}
              />
            </div>
            <div className="ops-form-row">
              <input
                name="periodStart"
                type="date"
                required
                aria-label={he ? "תחילת תקופה" : "Period start"}
              />
              <input
                name="periodEnd"
                type="date"
                required
                aria-label={he ? "סוף תקופה" : "Period end"}
              />
            </div>
            <input
              name="spend"
              type="number"
              min="0"
              step="0.01"
              required
              placeholder={he ? "סכום שהוצא" : "Amount spent"}
              aria-label={he ? "סכום שהוצא" : "Amount spent"}
            />
            <button type="submit">{he ? "שמירת הוצאה" : "Record spend"}</button>
          </ActionForm>
          <div className="source-bars">
            {leadCounts.slice(0, 6).map(([source, count]) => (
              <div key={source}>
                <span>{source}</span>
                <i>
                  <b
                    style={{
                      width: `${Math.max(8, (count / Math.max(1, leadCounts[0]?.[1] ?? 1)) * 100)}%`,
                    }}
                  />
                </i>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </GrowthCard>
      </div>
    </div>
  );
}

function GrowthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="growth-card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function MiniList({ rows }: { rows: { title: string; detail: string }[] }) {
  return (
    <div className="growth-mini-list">
      {rows.length
        ? rows.slice(0, 5).map((row, index) => (
            <div key={`${row.title}-${index}`}>
              <strong>{row.title}</strong>
              <small>{row.detail}</small>
            </div>
          ))
        : null}
    </div>
  );
}
