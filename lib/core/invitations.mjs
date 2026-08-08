// =====================================================================
//  invitations.mjs — the invitation that was never sent, and the token
//  that protected nothing.
//
//  TWO DEFECTS THIS FIXES:
//   1. `team/actions.ts` generated a `token`, wrote it, and NEVER SENT AN
//      EMAIL. Grep for `sendEmail` across the whole team flow: there was
//      none. The UI told the owner to go and tell the person themselves.
//   2. `accept_invitation()` matched on EMAIL ALONE, so possession of the
//      mailbox was the only control and the token protected nothing at all.
//
//  This module holds the pure half — link construction, escaping, and the
//  token shape the acceptance RPC now requires — so it is testable without a
//  mail provider or a database.
//
//  Tests: tests/invitations.test.mjs
// =====================================================================

import { escapeHtml } from "./security.mjs";

/** Tokens are `randomUUID()` (122 bits of entropy). Nothing else is accepted. */
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidInvitationToken(token) {
  return TOKEN_RE.test(String(token ?? "").trim());
}

/**
 * The acceptance link.
 *
 * `baseUrl` is derived SERVER-side by the caller (never from a request header),
 * matching the rule established when `autoSendDocument` was fixed. A missing
 * base URL returns null rather than a broken `undefined/join?...` link.
 */
export function invitationAcceptUrl(baseUrl, token) {
  const base = String(baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (!base || !isValidInvitationToken(token)) return null;
  let url;
  try {
    url = new URL(`${base}/join`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.searchParams.set("token", String(token).trim());
  return url.toString();
}

const ROLE_LABEL = {
  owner: { en: "Owner", he: "בעלים" },
  office: { en: "Office", he: "משרד" },
  tech: { en: "Technician", he: "טכנאי" },
};

/** Subject + HTML + plain text for the invitation email. Everything escaped. */
export function invitationEmail({
  locale = "en",
  businessName,
  inviterName = "",
  role = "tech",
  acceptUrl,
}) {
  const he = locale === "he";
  const business = escapeHtml(businessName || (he ? "העסק" : "the business"));
  const inviter = escapeHtml(String(inviterName || "").trim());
  const roleText = escapeHtml((ROLE_LABEL[role] ?? ROLE_LABEL.tech)[he ? "he" : "en"]);
  const link = escapeHtml(acceptUrl ?? "");
  const subject = he
    ? `הוזמנתם להצטרף ל${businessName || "עסק"} ב-ServicePro`
    : `You're invited to join ${businessName || "a business"} on ServicePro`;

  const lead = he
    ? `${inviter ? `${inviter} הזמין/ה אתכם` : "הוזמנתם"} להצטרף ל<b>${business}</b> בתפקיד <b>${roleText}</b>.`
    : `${inviter ? `${inviter} has invited you` : "You have been invited"} to join <b>${business}</b> as <b>${roleText}</b>.`;
  const cta = he ? "קבלת ההזמנה" : "Accept the invitation";
  const note = he
    ? "הקישור אישי ותקף 7 ימים. אם לא ציפיתם להזמנה הזו, אפשר להתעלם מההודעה."
    : "This link is personal and valid for 7 days. If you weren't expecting this invitation, you can ignore this message.";

  const html = `<p>${lead}</p><p><a href="${link}">${cta}</a></p><p>${escapeHtml(note)}</p><p style="color:#64748b;font-size:12px">${link}</p>`;
  const text = `${he ? "הוזמנתם להצטרף ל" : "You're invited to join "}${businessName ?? ""}\n\n${acceptUrl ?? ""}\n\n${note}`;
  return { subject, html, text };
}

/**
 * Turn an invitation row into what the owner needs to see.
 *
 * The old screen showed a pending invite with no indication of whether anyone
 * had ever been told about it — because nobody ever had. Delivery state is now
 * part of the row and is shown plainly, including failure.
 */
export function describeInviteDelivery(invite, locale = "en") {
  const he = locale === "he";
  const status = String(invite?.delivery_status ?? "").trim() || "pending";
  if (status === "sent") {
    return { tone: "ok", text: he ? "ההזמנה נשלחה במייל" : "Invitation emailed" };
  }
  if (status === "failed") {
    return {
      tone: "error",
      text: he
        ? `שליחת ההזמנה נכשלה${invite?.delivery_error ? ` — ${invite.delivery_error}` : ""}`
        : `Invitation email failed${invite?.delivery_error ? ` — ${invite.delivery_error}` : ""}`,
    };
  }
  if (status === "unavailable") {
    return {
      tone: "warn",
      text: he
        ? "ההזמנה נשמרה אך לא נשלחה: שירות המייל אינו מחובר. יש לשלוח את הקישור באופן ידני או לחבר את Resend."
        : "Invitation saved but NOT emailed: no email provider is connected. Send the link yourself or connect Resend.",
    };
  }
  return { tone: "warn", text: he ? "ההזמנה טרם נשלחה" : "Invitation not sent yet" };
}
