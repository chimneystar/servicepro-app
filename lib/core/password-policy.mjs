// Server-side password policy.
//
// THE DEFECT THIS FIXES: every strength rule in the product lived in a
// `useMemo` in app/signup/SignUpForm.tsx. It ran in the browser, gated a
// button, and was skipped entirely by anyone who called supabase.auth.signUp
// directly. "password1" satisfied it; so did the business's own name.
//
// This module is the rule. It is pure so it can be asserted in both directions,
// and it is called from a server action so the browser cannot decline to run
// it. See the note at the bottom about the ONE path this cannot reach.
//
// Tests: tests/password-policy.test.mjs

export const MIN_LENGTH = 10;
export const MAX_LENGTH = 72; // bcrypt truncates past 72 bytes; longer is a lie.

/**
 * Passwords that appear at the top of every breach corpus. This is a floor,
 * not a substitute for a breach-corpus check — Supabase Auth can be configured
 * to consult HaveIBeenPwned, and that is the real answer. Listed lowercase;
 * comparison is case-insensitive and strips trailing digits/punctuation, so
 * "Password123!" is caught by the "password" entry.
 */
export const COMMON_PASSWORDS = [
  "password", "passw0rd", "letmein", "welcome", "qwerty", "qwertyuiop", "asdfgh",
  "iloveyou", "admin", "administrator", "abc", "abcd", "monkey", "dragon",
  "sunshine", "princess", "football", "baseball", "master", "shadow", "superman",
  "trustno", "starwars", "whatever", "changeme", "secret", "login", "test",
  "service", "servicepro", "company", "business", "summer", "winter", "spring",
  "autumn", "january", "freedom", "hello", "charlie", "michael", "jordan",
];

const KEYBOARD_RUNS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"];

/** Reduce a candidate to its comparable core: lowercase, no trailing digits or punctuation. */
export function passwordStem(password) {
  return String(password ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/[0-9]+$/, "");
}

function hasRun(lowered, minRun) {
  for (const row of KEYBOARD_RUNS) {
    for (let start = 0; start + minRun <= row.length; start += 1) {
      const chunk = row.slice(start, start + minRun);
      if (lowered.includes(chunk)) return true;
      if (lowered.includes([...chunk].reverse().join(""))) return true;
    }
  }
  return false;
}

/** Tokens from the person's own identity that must not be the password. */
export function personalTokens({ email, fullName, businessName } = {}) {
  const tokens = new Set();
  const add = (value) => {
    for (const part of String(value ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
      if (part.length >= 4) tokens.add(part);
    }
  };
  add(String(email ?? "").split("@")[0]);
  add(fullName);
  add(businessName);
  return [...tokens];
}

/**
 * Evaluate a password against the policy.
 *
 * Returns machine-readable failure codes so the caller can translate them; a
 * server that answers only "invalid password" teaches nobody how to fix it.
 *
 * @returns {{ ok: boolean, failures: string[], score: number }}
 */
export function evaluatePassword(password, context = {}) {
  const raw = typeof password === "string" ? password : "";
  const failures = [];

  if (raw.length < MIN_LENGTH) failures.push("too_short");
  if (raw.length > MAX_LENGTH) failures.push("too_long");
  if (raw !== raw.trim()) failures.push("surrounding_whitespace");

  const classes =
    (/[a-z]/.test(raw) ? 1 : 0) +
    (/[A-Z]/.test(raw) ? 1 : 0) +
    (/[0-9]/.test(raw) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(raw) ? 1 : 0);
  if (!/[A-Za-z]/.test(raw)) failures.push("needs_letter");
  if (!/[0-9]/.test(raw) && !/[^A-Za-z0-9]/.test(raw)) failures.push("needs_number_or_symbol");

  const lowered = raw.toLowerCase();
  const stem = passwordStem(raw);
  if (stem && COMMON_PASSWORDS.includes(stem)) failures.push("common_password");
  if (stem.length >= 4 && COMMON_PASSWORDS.some((entry) => entry.length >= 5 && stem.includes(entry))) {
    if (!failures.includes("common_password")) failures.push("common_password");
  }

  // Any character repeated 4+ times, or a long keyboard/number run.
  if (/(.)\1{3,}/.test(raw)) failures.push("repeated_characters");
  if (hasRun(lowered, 5)) failures.push("sequential_characters");

  const unique = new Set(raw).size;
  if (raw.length >= MIN_LENGTH && unique < 5) failures.push("too_few_distinct_characters");

  for (const token of personalTokens(context)) {
    if (lowered.includes(token)) { failures.push("contains_personal_information"); break; }
  }

  // Score is advisory only — the gate is `ok`. It exists so the UI can show a
  // meter that agrees with the server instead of one that disagrees with it.
  let score = 0;
  if (raw.length >= MIN_LENGTH) score += 1;
  if (raw.length >= 14) score += 1;
  if (classes >= 3) score += 1;
  if (classes >= 4) score += 1;
  if (unique >= 10) score += 1;
  if (failures.length) score = Math.min(score, 1);

  return { ok: failures.length === 0, failures: [...new Set(failures)], score };
}

const MESSAGES = {
  en: {
    too_short: `Use at least ${MIN_LENGTH} characters.`,
    too_long: `Use no more than ${MAX_LENGTH} characters.`,
    surrounding_whitespace: "Remove the spaces at the start or end.",
    needs_letter: "Include at least one letter.",
    needs_number_or_symbol: "Include at least one number or symbol.",
    common_password: "This is one of the most guessed passwords. Choose something else.",
    repeated_characters: "Avoid repeating the same character four or more times.",
    sequential_characters: "Avoid keyboard runs like “qwerty” or “12345”.",
    too_few_distinct_characters: "Use a wider mix of characters.",
    contains_personal_information: "Don't use your name, email or business name in the password.",
  },
  he: {
    too_short: `השתמשו לפחות ב-${MIN_LENGTH} תווים.`,
    too_long: `אל תעברו ${MAX_LENGTH} תווים.`,
    surrounding_whitespace: "הסירו רווחים בתחילת הסיסמה או בסופה.",
    needs_letter: "כללו לפחות אות אחת.",
    needs_number_or_symbol: "כללו לפחות ספרה אחת או תו מיוחד.",
    common_password: "זו אחת הסיסמאות הנפוצות ביותר. בחרו אחרת.",
    repeated_characters: "הימנעו מחזרה על אותו תו ארבע פעמים או יותר.",
    sequential_characters: "הימנעו מרצפי מקלדת כמו “qwerty” או “12345”.",
    too_few_distinct_characters: "השתמשו במגוון רחב יותר של תווים.",
    contains_personal_information: "אל תשתמשו בשם, במייל או בשם העסק בתוך הסיסמה.",
  },
};

/** Human sentences for the failures, in the caller's language. */
export function describePasswordFailures(failures, locale = "en") {
  const table = MESSAGES[locale === "he" ? "he" : "en"];
  return (failures ?? []).map((code) => table[code] ?? code);
}

// ---------------------------------------------------------------------------
// THE PATH THIS MODULE CANNOT REACH, stated rather than hidden.
//
// Supabase Auth's /auth/v1/signup and /auth/v1/user endpoints are public and
// take the anon key. A determined caller can still set a weak password by
// posting to GoTrue directly, bypassing every server action in this app. The
// only complete fixes are project-level and live outside this repository:
//
//   1. Supabase Dashboard > Authentication > Policies: minimum length and
//      required character classes, plus the HaveIBeenPwned check.
//   2. A `password_verification` / `before user created` Auth Hook running
//      this same rule inside GoTrue.
//
// Both are configuration, not code, and neither can be applied or proven from
// here. This is why ledger item 6b.7 is marked PARTIAL.
// ---------------------------------------------------------------------------
