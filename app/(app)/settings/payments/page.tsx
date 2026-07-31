import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import PaymentSettingsForm from "./PaymentSettingsForm";
import { beginHelcimOnboarding, releaseAchHold, reviewManualPayment } from "./actions";
import { heldDeposits, mayOverrideAchHold } from "@/lib/payments/deposits";
import type { PaymentSettings } from "@/lib/payments/types";

export const dynamic = "force-dynamic";

const defaults = (organizationId: string): PaymentSettings => ({
  organization_id: organizationId,
  card_enabled: true,
  ach_enabled: true,
  zelle_enabled: false,
  check_enabled: false,
  fee_saver_enabled: true,
  ach_hold_until_settled: true,
  save_methods_enabled: true,
  tips_enabled: false,
  suggested_tip_percents: [15, 20, 25],
  default_deposit_type: "none",
  default_deposit_bps: 0,
  default_deposit_minor: 0,
  zelle_recipient_name: null,
  zelle_email: null,
  zelle_phone: null,
  zelle_qr_url: null,
  zelle_instructions: null,
  check_payee: null,
  check_address: null,
  check_city_state_zip: null,
  check_memo_instructions: null,
  receipt_email_enabled: true,
  receipt_sms_enabled: true,
});

export default async function PaymentSettingsPage() {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const locale = await getLocale();
  const he = locale === "he";
  const supabase = await createClient();
  const isOwner = profile.role === "owner";
  const { data: ownPermission } = isOwner
    ? { data: null }
    : await supabase
        .from("profile_payment_permissions")
        .select("can_confirm_manual_payments")
        .eq("profile_id", profile.id)
        .maybeSingle();
  const canReview = isOwner || !!ownPermission?.can_confirm_manual_payments;
  const [{ data: settings }, { data: connection }, { data: organization }, { data: submissions }] =
    await Promise.all([
      supabase
        .from("payment_settings")
        .select("*")
        .eq("organization_id", profile.organization_id!)
        .maybeSingle(),
      supabase
        .from("merchant_connections")
        .select(
          "status, status_reason, card_enabled, ach_enabled, terminal_enabled, fee_saver_eligible, approved_at",
        )
        .eq("organization_id", profile.organization_id!)
        .maybeSingle(),
      supabase.from("organizations").select("currency").eq("id", profile.organization_id!).single(),
      supabase
        .from("manual_payment_submissions")
        .select(
          "id, payment_request_id, method, amount_minor, reference, mailed_on, submitted_at, status",
        )
        .eq("status", "verification_pending")
        .order("submitted_at", { ascending: false })
        .limit(20),
    ]);

  // Deposits whose money has been SENT but not CLEARED. The
  // `ach_hold_until_settled` switch is what puts them here, and
  // `can_override_ach_holds` — a permission that granted nothing until now — is
  // what lets someone let the work start anyway.
  const canOverrideHolds = await mayOverrideAchHold(profile.id, profile.role);
  const awaitingClearance = canOverrideHolds ? await heldDeposits(profile.organization_id!) : [];

  const status = connection?.status ?? "not_started";
  const statusCopy: Record<string, [string, string]> = {
    not_started: [
      he ? "החיבור ל־Helcim בהכנה" : "Helcim connection is being prepared",
      he
        ? "בקשת השותף נמצאת בתהליך. אפשר כבר להגדיר Zelle, צ׳קים ומקדמות."
        : "The partner application is in progress. You can already configure Zelle, checks and deposits.",
    ],
    application_started: [
      he ? "הבקשה התחילה" : "Application started",
      he
        ? "השלימו את הפרטים ב־Helcim כדי להפעיל כרטיס ו־ACH."
        : "Complete the Helcim application to activate card and ACH payments.",
    ],
    under_review: [
      he ? "Helcim בודקים את הבקשה" : "Helcim is reviewing the application",
      he
        ? "אין צורך לעשות דבר כרגע. נעדכן כשהחשבון מוכן."
        : "Nothing is needed right now. This page will update when the account is ready.",
    ],
    action_required: [
      he ? "Helcim צריכים עוד פרטים" : "Helcim needs more information",
      he
        ? "פתחו את הבקשה והשלימו את הפרטים החסרים."
        : "Open the application and provide the missing details.",
    ],
    approved: [
      he ? "התשלומים מחוברים" : "Payments connected",
      he
        ? "כרטיס ו־ACH מוכנים לעבודה לפי ההגדרות למטה."
        : "Card and ACH are ready according to the settings below.",
    ],
    rejected: [
      he ? "הבקשה לא אושרה" : "Application not approved",
      he
        ? "פנו ל־Helcim לקבלת פרטים. Zelle וצ׳קים עדיין זמינים."
        : "Contact Helcim for details. Zelle and checks remain available.",
    ],
    suspended: [
      he ? "התשלומים המקוונים מושהים" : "Online payments are paused",
      he
        ? "Zelle וצ׳קים עדיין זמינים אם הפעלתם אותם."
        : "Zelle and checks remain available if enabled.",
    ],
  };
  const [statusTitle, statusText] = statusCopy[status] ?? statusCopy.not_started;

  return (
    <div className="settings-shell payment-center">
      <div className="payment-page-top">
        <div>
          <Link href={isOwner ? "/settings" : "/invoices"} className="payment-back">
            ← {isOwner ? (he ? "הגדרות" : "Settings") : he ? "חשבוניות" : "Invoices"}
          </Link>
          <h1>
            {isOwner
              ? he
                ? "תשלומים והפקדות"
                : "Payments & deposits"
              : he
                ? "בדיקת תשלומים"
                : "Payment review"}
          </h1>
          <p>
            {isOwner
              ? he
                ? "הגדירו פעם אחת איך לקוחות משלמים, והמערכת תציג להם רק את מה שצריך."
                : "Set up how customers pay once, and ServicePro will show them only what they need."
              : he
                ? "כאן מאשרים תשלומי Zelle וצ׳קים לאחר שבדקתם שהם התקבלו."
                : "Confirm Zelle and check payments here after verifying that they were received."}
          </p>
        </div>
        {isOwner && (
          <span className="payment-free-badge">
            {he ? "האפליקציה חינמית כרגע" : "Free during launch"}
          </span>
        )}
      </div>

      {isOwner && (
        <section
          className={`helcim-status-card ${status === "approved" ? "connected" : "pending"}`}
        >
          <div className="helcim-status-orbit">
            <span>H</span>
          </div>
          <div className="helcim-status-copy">
            <span className="payment-eyebrow">HELCIM</span>
            <h2>{statusTitle}</h2>
            <p>{statusText}</p>
            <div className="helcim-capabilities">
              <span className={connection?.card_enabled ? "ready" : ""}>
                {he ? "כרטיס" : "Card"}
              </span>
              <span className={connection?.ach_enabled ? "ready" : ""}>ACH</span>
              <span className={connection?.terminal_enabled ? "ready" : ""}>
                {he ? "מסוף" : "Terminal"}
              </span>
              <span className={connection?.fee_saver_eligible ? "ready" : ""}>Fee Saver</span>
            </div>
          </div>
          {status !== "approved" && (
            <form action={beginHelcimOnboarding}>
              <button type="submit" className="helcim-connect-button">
                {status === "not_started"
                  ? he
                    ? "המשך כשיהיה מוכן"
                    : "Continue when ready"
                  : he
                    ? "המשך בקשה"
                    : "Continue application"}
              </button>
            </form>
          )}
        </section>
      )}

      <div className={`payment-center-grid ${isOwner ? "" : "office-review-only"}`}>
        {isOwner && (
          <main>
            <PaymentSettingsForm
              locale={locale}
              settings={(settings ?? defaults(profile.organization_id!)) as PaymentSettings}
              currency={organization?.currency ?? "USD"}
            />
          </main>
        )}
        <aside className="payment-review-column">
          <section className="settings-section sticky-review">
            <div className="review-heading">
              <div>
                <span className="payment-eyebrow">{he ? "דורש בדיקה" : "Needs review"}</span>
                <h3>{he ? "Zelle וצ׳קים" : "Zelle & checks"}</h3>
              </div>
              <b>{submissions?.length ?? 0}</b>
            </div>
            {!canReview ? (
              <div className="payment-empty">
                <span>🔒</span>
                <strong>{he ? "נדרשת הרשאה מבעלי העסק" : "Owner permission required"}</strong>
                <small>
                  {he
                    ? "בעלי העסק יכולים לאפשר לך לאשר תשלומים דרך מסך הצוות."
                    : "The owner can grant payment-review access from the team screen."}
                </small>
              </div>
            ) : !submissions?.length ? (
              <div className="payment-empty">
                <span>✓</span>
                <strong>{he ? "הכול מסודר" : "All caught up"}</strong>
                <small>
                  {he
                    ? "תשלומים חדשים שדורשים אישור יופיעו כאן."
                    : "New payments that need verification will appear here."}
                </small>
              </div>
            ) : (
              <div className="manual-review-list">
                {submissions.map((submission) => (
                  <form
                    action={reviewManualPayment}
                    key={submission.id}
                    className="manual-review-card"
                  >
                    <input type="hidden" name="submission_id" value={submission.id} />
                    <div>
                      <span className={`manual-method ${submission.method}`}>
                        {submission.method === "zelle" ? "Zelle" : he ? "צ׳ק" : "Check"}
                      </span>
                      <strong>${(Number(submission.amount_minor) / 100).toFixed(2)}</strong>
                    </div>
                    <small>
                      {submission.reference || (he ? "ללא מספר אסמכתא" : "No reference provided")}
                    </small>
                    {submission.mailed_on && (
                      <small>
                        {he ? "נשלח בתאריך" : "Mailed"}: {submission.mailed_on}
                      </small>
                    )}
                    <input
                      name="reason"
                      placeholder={he ? "הערה פנימית, אם צריך" : "Internal note, if needed"}
                      aria-label={he ? "הערה פנימית, אם צריך" : "Internal note, if needed"}
                    />
                    <div className="manual-review-actions">
                      <button type="submit" name="decision" value="confirm">
                        {he ? "אישור קבלה" : "Confirm received"}
                      </button>
                      <button type="submit" name="decision" value="reject" className="reject">
                        {he ? "דחייה" : "Reject"}
                      </button>
                    </div>
                  </form>
                ))}
              </div>
            )}
          </section>
          {canOverrideHolds && (
            <section className="settings-section">
              <div className="review-heading">
                <div>
                  <span className="payment-eyebrow">
                    {he ? "ממתין לסליקת הבנק" : "Awaiting bank clearance"}
                  </span>
                  <h3>{he ? "מקדמות ב־ACH" : "ACH deposits"}</h3>
                </div>
                <b>{awaitingClearance.length}</b>
              </div>
              {!awaitingClearance.length ? (
                <div className="payment-empty">
                  <span>✓</span>
                  <strong>{he ? "אין מקדמות בהמתנה" : "Nothing waiting on a bank"}</strong>
                  <small>
                    {he
                      ? "העברות ACH שנשלחו ועדיין לא נסגרו יופיעו כאן עד לאישור הבנק."
                      : "ACH transfers that have been sent but not yet cleared appear here until the bank confirms them."}
                  </small>
                </div>
              ) : (
                <div className="manual-review-list">
                  {awaitingClearance.map((deposit) => (
                    <form
                      action={releaseAchHold}
                      key={deposit.milestoneId}
                      className="manual-review-card"
                    >
                      <input type="hidden" name="milestone_id" value={deposit.milestoneId} />
                      <div>
                        <span className="manual-method">{he ? "מקדמה" : "Deposit"}</span>
                        <strong>${(deposit.amountMinor / 100).toFixed(2)}</strong>
                      </div>
                      <small>
                        {[
                          deposit.customerName,
                          deposit.estimateNumber ? `#${deposit.estimateNumber}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || (he ? "הצעת מחיר" : "Estimate")}
                      </small>
                      <small>
                        {he
                          ? "העבודה מוחזקת עד שהבנק מאשר. אפשר לשחרר על אחריות העסק."
                          : "Work is held until the bank confirms. You can release it early at the business's risk."}
                      </small>
                      <input
                        name="reason"
                        placeholder={he ? "סיבה לשחרור מוקדם" : "Why release early?"}
                        aria-label={he ? "סיבה לשחרור מוקדם" : "Why release early?"}
                      />
                      <div className="manual-review-actions">
                        <button type="submit">{he ? "שחרור העבודה" : "Release the work"}</button>
                      </div>
                    </form>
                  ))}
                </div>
              )}
            </section>
          )}
          <section className="payment-safety-note">
            <b>{he ? "מה לעולם לא נשמר" : "What ServicePro never stores"}</b>
            <p>
              {he
                ? "מספרי כרטיס מלאים, פרטי חשבון בנק ומסמכי זיהוי נשארים אצל Helcim."
                : "Full card numbers, bank credentials and identity documents stay with Helcim."}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
