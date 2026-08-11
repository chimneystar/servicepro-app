// =====================================================================
//  skills.mjs — technician certifications and dispatch matching.
//
//  WHY THIS EXISTS (remediation plan 6c.11)
//  ----------------------------------------
//  Dispatch had no way to know who is licensed for gas, HVAC or electrical
//  work. In most jurisdictions that is not a preference, it is a condition of
//  being allowed to do the job at all, and sending an uncertified technician is
//  how a business loses its licence rather than merely its afternoon.
//
//  A certification that has EXPIRED is treated as absent, not as a warning.
//  An expired gas ticket is exactly as illegal as no ticket, and a system that
//  lets it through while showing an amber badge is a system that will let it
//  through.
//
//  Tests: tests/skills.test.mjs
// =====================================================================

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Canonical machine key for a skill.
 *
 * Free text is the enemy here: "Gas Safe", "gas safe" and "gas_safe" are one
 * certification and three unmatchable strings. Everything is folded to
 * [a-z0-9_], which is also the check constraint on
 * `technician_skills.skill_code`, so the database and this module agree.
 * Returns null for anything that cannot be made into a usable key.
 */
export function normalizeSkillCode(value) {
  const code = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return code.length >= 2 && code.length <= 40 ? code : null;
}

/** Normalise a list of required codes: deduplicated, ordered, junk dropped. */
export function normalizeSkillList(values) {
  const out = [];
  for (const value of Array.isArray(values) ? values : String(values ?? "").split(",")) {
    const code = normalizeSkillCode(value);
    if (code && !out.includes(code)) out.push(code);
  }
  return out.sort();
}

/**
 * Is a certification usable on `onDate`?
 *   "valid"    — in force
 *   "expiring" — in force but lapses within `warnDays` (default 30)
 *   "expired"  — lapsed, which counts as NOT HELD
 *   "future"   — issued later than the job; not yet held
 * A certification with no expiry date never lapses, which is correct for the
 * many trades where the ticket is for life.
 */
export function certificationStatus(skill, onDate, { warnDays = 30 } = {}) {
  const day = String(onDate ?? "").slice(0, 10);
  if (!DAY.test(day)) throw new Error(`invalid date: ${onDate}`);
  const issued = String(skill?.issued_on ?? skill?.issuedOn ?? "").slice(0, 10);
  if (DAY.test(issued) && issued > day) return "future";
  const expires = String(skill?.expires_on ?? skill?.expiresOn ?? "").slice(0, 10);
  if (!DAY.test(expires)) return "valid";
  if (expires < day) return "expired";
  const warnFrom = new Date(
    Date.UTC(
      Number(day.slice(0, 4)),
      Number(day.slice(5, 7)) - 1,
      Number(day.slice(8, 10)) + warnDays,
    ),
  )
    .toISOString()
    .slice(0, 10);
  return expires <= warnFrom ? "expiring" : "valid";
}

/** The codes this technician can legally work on `onDate`. */
export function heldSkillCodes(skills, onDate) {
  const held = [];
  for (const skill of skills ?? []) {
    const code = normalizeSkillCode(skill?.skill_code ?? skill?.skillCode);
    if (!code) continue;
    const status = certificationStatus(skill, onDate);
    if (status === "valid" || status === "expiring") held.push(code);
  }
  return held;
}

/**
 * Can this technician take this job?
 *
 * `required` empty — the default for every job that exists today, and the
 * column default — means yes. Nothing that works before this feature starts
 * being refused after it.
 *
 * @returns {{ok:boolean, missing:string[], expired:string[]}}
 *          `missing` is not held at all; `expired` is held but lapsed, and is
 *          reported separately ONLY so the message can say "renew" rather than
 *          "obtain". Both refuse.
 */
export function checkSkillMatch({ required, skills, onDate }) {
  const need = normalizeSkillList(required);
  if (!need.length) return { ok: true, missing: [], expired: [] };
  const usable = heldSkillCodes(skills, onDate);
  const missing = [];
  const expired = [];
  for (const code of need) {
    if (usable.includes(code)) continue;
    const lapsed = (skills ?? []).some(
      (skill) =>
        normalizeSkillCode(skill?.skill_code ?? skill?.skillCode) === code &&
        certificationStatus(skill, onDate) === "expired",
    );
    (lapsed ? expired : missing).push(code);
  }
  return { ok: missing.length === 0 && expired.length === 0, missing, expired };
}

/**
 * Rank a team for a job. Dispatch shows the qualified first and says exactly
 * why the rest are not, instead of leaving a dispatcher to guess.
 *
 * @param {{required:string[], technicians:Array<{id:string,name?:string,skills:Array}>, onDate:string}} input
 */
export function matchTechnicians({ required, technicians, onDate }) {
  const qualified = [];
  const unqualified = [];
  for (const tech of technicians ?? []) {
    const result = checkSkillMatch({ required, skills: tech?.skills ?? [], onDate });
    (result.ok ? qualified : unqualified).push({ id: tech?.id, name: tech?.name ?? "", ...result });
  }
  return { qualified, unqualified };
}

/** A refusal a dispatcher can act on, naming the certification. */
export function describeSkillGap(result, { locale = "en", name = "", labels = {} } = {}) {
  if (!result || result.ok) return null;
  const he = locale === "he";
  const label = (code) => labels[code] ?? code;
  const who = name || (he ? "הטכנאי" : "That technician");
  const parts = [];
  if (result.missing.length) {
    parts.push(
      he
        ? `אין הסמכה ל: ${result.missing.map(label).join(", ")}`
        : `is not certified for: ${result.missing.map(label).join(", ")}`,
    );
  }
  if (result.expired.length) {
    parts.push(
      he
        ? `הסמכה שפגה: ${result.expired.map(label).join(", ")}`
        : `has an EXPIRED certification for: ${result.expired.map(label).join(", ")}`,
    );
  }
  return he
    ? `${who} — ${parts.join("; ")}. עדכנו את ההסמכות ב"צוות" או שנו את דרישות העבודה.`
    : `${who} ${parts.join("; ")}. Record the certification on the Team screen, or change what this job requires.`;
}

/** Suggested starting set for a trade business; free text is still allowed. */
export const COMMON_SKILLS = [
  { code: "gas", en: "Gas", he: "גז" },
  { code: "hvac", en: "HVAC", he: "מיזוג אוויר" },
  { code: "electrical", en: "Electrical", he: "חשמל" },
  { code: "plumbing", en: "Plumbing", he: "אינסטלציה" },
  { code: "refrigeration", en: "Refrigeration", he: "קירור" },
  { code: "boiler", en: "Boiler", he: "דוודים" },
  { code: "solar", en: "Solar", he: "סולארי" },
  { code: "epa_608", en: "EPA 608", he: "EPA 608" },
];
