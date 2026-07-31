// =====================================================================
//  support-access.mjs — does a support session actually grant anything?
//
//  THE DEFECT THIS FIXES: `support_sessions` records a time-boxed,
//  reason-bound, revocable grant of access to one business — and NO CODE
//  ANYWHERE read it. `lib/platform-admin.ts` gated on the `platform_admins`
//  table alone, so the "Revoke" button changed a timestamp and nothing else:
//  the session record was decoration.
//
//  The rules live here, pure, so every branch is provable — including the one
//  that matters most, that a REVOKED session stops granting immediately.
//
//  Tests: tests/support-access.test.mjs
// =====================================================================

/** guided_write implies read_only; read_only does not imply guided_write. */
const LEVEL_RANK = { read_only: 1, guided_write: 2 };

const asTime = (value) => {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
};

/**
 * Evaluate one `support_sessions` row against the access being attempted.
 *
 * Returns `{ granted, reason }`. Every refusal has a distinct reason so the
 * console can say WHY (revoked vs expired vs wrong business) instead of a
 * uniform "forbidden" that hides a misconfiguration.
 */
export function evaluateSupportSession(session, options = {}) {
  const { now = Date.now(), adminUserId = null, organizationId = null, requiredLevel = "read_only" } = options;
  if (!session) return { granted: false, reason: "no_session" };

  const wanted = LEVEL_RANK[requiredLevel];
  if (!wanted) return { granted: false, reason: "unknown_level" };

  if (adminUserId && session.admin_user_id !== adminUserId) return { granted: false, reason: "wrong_admin" };
  if (organizationId && session.organization_id !== organizationId) return { granted: false, reason: "wrong_organization" };

  // Revocation is checked FIRST among the time conditions: a revoked session
  // must stop working the instant it is revoked, even while unexpired.
  const revokedAt = asTime(session.revoked_at);
  if (revokedAt !== null && revokedAt <= now) return { granted: false, reason: "revoked" };

  const startsAt = asTime(session.starts_at);
  if (startsAt === null) return { granted: false, reason: "invalid_window" };
  if (startsAt > now) return { granted: false, reason: "not_started" };

  const expiresAt = asTime(session.expires_at);
  if (expiresAt === null) return { granted: false, reason: "invalid_window" };
  if (expiresAt <= now) return { granted: false, reason: "expired" };

  const held = LEVEL_RANK[session.access_level];
  if (!held) return { granted: false, reason: "unknown_level" };
  if (held < wanted) return { granted: false, reason: "insufficient_level" };

  return { granted: true, reason: "active", expiresAt, accessLevel: session.access_level, sessionId: session.id ?? null, caseId: session.case_id ?? null };
}

/**
 * Pick the session that grants, out of everything on file for this admin and
 * business. Prefers the one that expires last so a freshly extended grant is
 * used, but ONLY among sessions that actually grant.
 */
export function selectGrantingSession(sessions, options = {}) {
  const rows = Array.isArray(sessions) ? sessions : [];
  let best = null;
  let bestRefusal = { granted: false, reason: "no_session" };
  for (const row of rows) {
    const verdict = evaluateSupportSession(row, options);
    if (!verdict.granted) {
      // Keep the most informative refusal for the operator: a revoked or
      // expired session is a better explanation than "no session".
      if (bestRefusal.reason === "no_session" && verdict.reason !== "no_session") bestRefusal = verdict;
      continue;
    }
    if (!best || verdict.expiresAt > best.expiresAt) best = { ...verdict, session: row };
  }
  return best ?? bestRefusal;
}

/** Bilingual sentence for a refusal reason. */
export function supportAccessMessage(reason, locale = "en") {
  const en = {
    no_session: "No support session grants access to this business. Open a reason-bound session from a support case first.",
    revoked: "That support session has been revoked. Access stopped the moment it was revoked.",
    expired: "That support session has expired. Open a new one from the case if access is still needed.",
    not_started: "That support session has not started yet.",
    wrong_admin: "That support session belongs to another member of platform staff.",
    wrong_organization: "That support session was opened for a different business.",
    insufficient_level: "That support session is read-only. A guided-write session is required for this action.",
    unknown_level: "That support session has an unrecognised access level.",
    invalid_window: "That support session has an unusable validity window.",
    not_platform_staff: "Platform access is required.",
  };
  const he = {
    no_session: "אין גישת תמיכה פעילה לעסק הזה. יש לפתוח גישה מתועדת מתוך פנייה קיימת.",
    revoked: "גישת התמיכה בוטלה. הגישה נפסקה ברגע הביטול.",
    expired: "תוקף גישת התמיכה פג. יש לפתוח גישה חדשה מתוך הפנייה.",
    not_started: "גישת התמיכה עדיין לא התחילה.",
    wrong_admin: "גישת התמיכה שייכת לאיש צוות אחר.",
    wrong_organization: "גישת התמיכה נפתחה עבור עסק אחר.",
    insufficient_level: "גישת התמיכה היא לקריאה בלבד. לפעולה הזו נדרשת כתיבה בליווי.",
    unknown_level: "רמת הגישה של הפנייה אינה מוכרת.",
    invalid_window: "חלון התוקף של גישת התמיכה אינו תקין.",
    not_platform_staff: "נדרשת הרשאת פלטפורמה.",
  };
  const table = locale === "he" ? he : en;
  return table[reason] ?? (locale === "he" ? "הגישה נדחתה." : "Access refused.");
}
