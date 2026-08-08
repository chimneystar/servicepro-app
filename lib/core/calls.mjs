/** Normalize a United States phone number to E.164. Returns an empty string when invalid. */
export function normalizeUsPhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

/**
 * The trailing digits to hand Postgres as an ILIKE suffix when looking a phone
 * number up.
 *
 * THE BUG: `logCall` selected up to 1000 customers and scanned them in
 * JavaScript to find one phone match. That is not merely slow — past 1000
 * customers it is simply WRONG, because the matching row can fall outside the
 * arbitrary page the query returned, and the call gets filed against no
 * customer at all.
 *
 * Suffix rather than whole-number matching, because the same number is stored
 * as "+15551234567", "(555) 123-4567" or "555.123.4567" depending on where it
 * came from. Four digits is what survives every one of those formats
 * contiguously; the exact match is then re-checked in normalized form against
 * the handful of rows that come back.
 *
 * The result is digits only, so it can never carry an ILIKE wildcard.
 */
export function phoneSearchSuffix(value, length = 4) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= length ? digits.slice(-length) : "";
}

export function formatUsPhone(value) {
  const normalized = normalizeUsPhone(value);
  if (!normalized) return String(value ?? "");
  const digits = normalized.slice(2);
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function mapVoiceStatus(value, direction = "inbound") {
  const status = String(value ?? "").toLowerCase();
  if (["queued", "initiated"].includes(status)) return "initiated";
  if (status === "ringing") return "ringing";
  if (["answered", "in-progress"].includes(status)) return "in_progress";
  if (status === "completed") return "completed";
  if (["no-answer", "busy", "canceled"].includes(status))
    return direction === "inbound" ? "missed" : "failed";
  if (status === "voicemail") return "voicemail";
  return "failed";
}

export function callNeedsFollowUp(status, outcome = "") {
  return (
    ["missed", "voicemail", "failed"].includes(status) ||
    ["callback", "follow_up", "no_answer"].includes(String(outcome).toLowerCase())
  );
}

export function escapeXml(value) {
  return String(value ?? "").replace(
    /[<>&'\"]/g,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[character],
  );
}
