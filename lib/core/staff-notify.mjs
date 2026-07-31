// Staff notification rules (ledger 6c.5). Plain ESM so `node --test` runs it.
//
// WHY THIS EXISTS
// ---------------
// Nothing in the product ever told a technician they had been given a job
// (5.13 built the push SENDER, but push is one channel on one device and a
// technician who has not enabled notifications, or whose browser dropped the
// subscription, learns nothing), and nothing at all told an owner that money
// had arrived. There was no in-app inbox and no email fallback.
//
// This module decides three things, purely:
//   1. WHAT the notification says (bilingual, no HTML, no money in a push body).
//   2. WHO should receive it.
//   3. WHICH channels to attempt, and — critically — when the email fallback is
//      justified. Emailing on top of a delivered push is spam; NOT emailing when
//      push failed is the silent-failure this branch exists to remove.
//
// Consent: staff are not customers, but the rule is the same rule. Rather than
// writing a second opt-out check that can drift, `staffEmailEligibility` shapes
// the profile into a contact row and defers to `contactEligibility` in
// outreach.mjs — the single shared rule — so a NON-BOOLEAN preference is
// refused exactly as it is for a customer. A query that forgot to select the
// column must never read as consent.
//
// Tests: tests/staff-notifications.test.mjs

import { contactEligibility } from "./outreach.mjs";

/** Every staff notification the product can raise. An unknown type is refused. */
export const STAFF_NOTIFICATION_TYPES = Object.freeze([
  "job_assigned",
  "payment_received",
  "job_unassigned",
]);

export function isStaffNotificationType(type) {
  return STAFF_NOTIFICATION_TYPES.includes(String(type ?? ""));
}

/** Channels a staff notification may travel on, in the order they are attempted. */
export const STAFF_CHANNELS = Object.freeze(["inapp", "push", "email"]);

const text = (v) => String(v ?? "").trim();

/**
 * The dedupe key, which is ALSO the claim.
 *
 * A notification is claimed by inserting this key under a unique constraint
 * before anything is sent, so two concurrent writers cannot both notify. It is
 * deterministic and it THROWS on a missing part: a key that silently collapsed
 * to "job_assigned::" would deduplicate every assignment in the business down
 * to one notification, for ever.
 */
export function notificationKey({ type, relatedType, relatedId, profileId }) {
  if (!isStaffNotificationType(type)) throw new TypeError(`unknown notification type: ${type}`);
  const parts = [text(relatedType), text(relatedId), text(profileId)];
  if (parts.some((part) => part === "")) {
    throw new TypeError("notificationKey needs relatedType, relatedId and profileId");
  }
  return [String(type), ...parts].join(":");
}

const L = (locale) => (locale === "he" ? "he" : "en");

/** A localised date/time suffix, or "" when the job has no schedule yet. */
function whenSuffix(locale, date, time) {
  const d = text(date);
  if (!d) return "";
  const t = text(time).slice(0, 5);
  return t ? ` — ${d} ${t}` : ` — ${d}`;
}

/**
 * The words. Bilingual, plain text, and deliberately WITHOUT the amount in the
 * push title for anything but the payment notification: a lock-screen preview
 * is read by whoever is holding the phone.
 */
export function staffNotification(input) {
  const locale = L(input?.locale);
  const type = String(input?.type ?? "");
  if (!isStaffNotificationType(type)) throw new TypeError(`unknown notification type: ${type}`);

  if (type === "job_assigned" || type === "job_unassigned") {
    const service = text(input?.service) || (locale === "he" ? "עבודה" : "Job");
    const customer = text(input?.customerName);
    const suffix = whenSuffix(locale, input?.scheduledDate, input?.startTime);
    const assigned = type === "job_assigned";
    return {
      title:
        locale === "he"
          ? assigned
            ? "עבודה חדשה שויכה אליך"
            : "עבודה הוסרה ממך"
          : assigned
            ? "New job assigned to you"
            : "A job was taken off your list",
      body: `${service}${customer ? ` · ${customer}` : ""}${suffix}`,
      url: `/jobs/${text(input?.jobId)}`,
    };
  }

  // payment_received — the owner's notification. The amount IS the message here,
  // so it is formatted by the caller (money() knows the currency) and passed in.
  const amount = text(input?.amountLabel);
  const customer = text(input?.customerName);
  const invoice = text(input?.invoiceNumber);
  return {
    title: locale === "he" ? `התקבל תשלום ${amount}`.trim() : `Payment received ${amount}`.trim(),
    body:
      [customer, invoice ? (locale === "he" ? `חשבונית #${invoice}` : `Invoice #${invoice}`) : ""]
        .filter(Boolean)
        .join(" · ") || (locale === "he" ? "תשלום חדש נרשם" : "A new payment was recorded"),
    url: text(input?.invoiceId) ? `/invoices/${text(input.invoiceId)}` : "/invoices",
  };
}

/**
 * Which teammates hear about money arriving.
 *
 * Owners always. Office members only when they can actually see payments —
 * telling somebody about a payment they are not permitted to open is a
 * disclosure, not a courtesy. Technicians never. An INACTIVE profile never,
 * whatever their role: deactivating a member must stop the notifications too.
 *
 * `rows`: { id, role, active, can_manage_payments }
 */
export function paymentNotificationRecipients(rows) {
  return (rows ?? [])
    .filter((row) => row && row.active !== false)
    .filter((row) => {
      const role = String(row.role ?? "");
      if (role === "owner") return true;
      if (role === "office") return row.can_manage_payments === true;
      return false;
    })
    .map((row) => String(row.id));
}

/**
 * May we email this teammate?
 *
 * Delegates to `contactEligibility` — the single shared opt-out rule — so the
 * non-boolean refusal comes for free. `notify_email_opt_in` is a real column
 * (migration 040) with a default of true; a profile row selected without it is
 * refused as `email_opt_in_unknown`, never treated as consent.
 */
export function staffEmailEligibility(profile) {
  return contactEligibility(
    {
      email: profile?.email ?? null,
      email_opt_in: profile?.notify_email_opt_in,
      // An inactive teammate is treated exactly as a deleted contact is.
      deleted_at: profile && profile.active === false ? "inactive" : null,
    },
    "email",
  );
}

/**
 * Which channels to attempt, and why.
 *
 * `inapp` is unconditional: the inbox row IS the notification, and it is what
 * makes "nobody was told" impossible to hide. `push` is attempted whenever push
 * is available at all. `email` is the FALLBACK — attempted only when push did
 * not put the message on a device, because a teammate who got the push does not
 * also need the mail, and a teammate who got nothing must not be left silent.
 *
 * @param {{pushAvailable?: boolean, pushDelivered?: number, emailAvailable?: boolean,
 *          emailEligible?: boolean, urgent?: boolean}} input
 */
export function deliveryPlan(input) {
  const pushAvailable = input?.pushAvailable === true;
  const delivered = Number(input?.pushDelivered ?? 0);
  const pushReached = pushAvailable && delivered > 0;

  const channels = ["inapp"];
  if (pushAvailable) channels.push("push");

  let emailReason = "";
  if (!input?.emailAvailable) emailReason = "no_email_provider";
  else if (input?.emailEligible === false) emailReason = "not_eligible";
  else if (pushReached && input?.urgent !== true) emailReason = "push_delivered";

  if (!emailReason) channels.push("email");
  return { channels, emailFallback: !emailReason, emailSkipReason: emailReason };
}

/**
 * Did this notification reach ANYBODY outside the app?
 *
 * The inbox row always exists, so `ok` here answers the harder question the
 * cron and the action need in order to log honestly.
 */
export function notificationOutcome({ inapp, push, email }) {
  const reached = [];
  if (push?.delivered > 0) reached.push("push");
  if (email?.sent) reached.push("email");
  return {
    ok: Boolean(inapp?.recorded),
    reached,
    // `inbox_only` is not a failure — it is the honest description of a
    // teammate with no devices and no email provider connected.
    status: reached.length ? "sent" : inapp?.recorded ? "inbox_only" : "failed",
  };
}
