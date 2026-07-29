/** Normalize a United States phone number to E.164. Returns an empty string when invalid. */
export function normalizeUsPhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
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
  if (["no-answer", "busy", "canceled"].includes(status)) return direction === "inbound" ? "missed" : "failed";
  if (status === "voicemail") return "voicemail";
  return "failed";
}

export function callNeedsFollowUp(status, outcome = "") {
  return ["missed", "voicemail", "failed"].includes(status) || ["callback", "follow_up", "no_answer"].includes(String(outcome).toLowerCase());
}

export function escapeXml(value) {
  return String(value ?? "").replace(/[<>&'\"]/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  })[character]);
}
