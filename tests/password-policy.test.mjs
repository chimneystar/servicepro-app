import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  evaluatePassword, describePasswordFailures, personalTokens, passwordStem,
  MIN_LENGTH, MAX_LENGTH, COMMON_PASSWORDS,
} from "../lib/core/password-policy.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// THE DEFECT: every strength rule lived in a `useMemo` in SignUpForm.tsx. It
// ran in the browser, gated a button, and was skipped entirely by posting to
// supabase.auth.signUp directly. BOTH directions matter here — a policy that
// refuses everything is as useless as one that refuses nothing, because it
// would simply be turned off.
// ---------------------------------------------------------------------------

test("a genuinely strong password is ACCEPTED", () => {
  for (const good of [
    "correct-horse-battery-73",
    "Tw1light#Harbour",
    "9fj2Kd!vqp3Zx",
    "my dog ate 14 shoes",
  ]) {
    const verdict = evaluatePassword(good, { email: "dana@ace-plumbing.com", fullName: "Dana Cohen", businessName: "Ace Plumbing" });
    assert.equal(verdict.ok, true, `${good} must be accepted — ${verdict.failures.join(", ")}`);
    assert.deepEqual(verdict.failures, []);
    assert.ok(verdict.score >= 2);
  }
});

test("everything the old browser-only rule let through is now REFUSED", () => {
  // Each of these satisfied "8 chars, a letter, a number" — the entire policy
  // before this module existed.
  const cases = [
    ["password1", "common_password"],
    ["Password123", "common_password"],
    ["11111111111", "repeated_characters"],
    ["qwerty12345", "sequential_characters"],
    ["abcd1234", "too_short"],
    ["aaaa1111bbbb", "too_few_distinct_characters"],
  ];
  for (const [bad, expected] of cases) {
    const verdict = evaluatePassword(bad);
    assert.equal(verdict.ok, false, `${bad} must be refused`);
    assert.ok(verdict.failures.includes(expected), `${bad} should report ${expected}, got ${verdict.failures.join(",")}`);
  }
});

test("length is bounded at both ends", () => {
  assert.ok(evaluatePassword("aB3!xyzp".slice(0, MIN_LENGTH - 1)).failures.includes("too_short"));
  assert.ok(!evaluatePassword("aB3!xyzpqw").failures.includes("too_short"));
  assert.ok(evaluatePassword("aB3!".repeat(30)).failures.includes("too_long"));
  assert.equal(MAX_LENGTH, 72, "bcrypt silently truncates past 72 bytes; accepting more would be a lie about strength");
});

test("a password must not be the business, the person, or their email", () => {
  const context = { email: "dana@ace-plumbing.com", fullName: "Dana Cohen", businessName: "Ace Plumbing" };
  for (const bad of ["AcePlumbing2024", "danacohen!99", "dana-is-here-99", "plumbing-forever-1"]) {
    const verdict = evaluatePassword(bad, context);
    assert.ok(verdict.failures.includes("contains_personal_information"), `${bad} must be refused as personal`);
  }
  // The identical password is fine for someone whose details it does not contain.
  assert.equal(evaluatePassword("AcePlumbing2024xq", { email: "sam@other.test", fullName: "Sam Lee", businessName: "Zeta Air" }).ok, true);
});

test("short identity fragments are NOT used, so a common word is not banned by accident", () => {
  // "ace" is three letters; banning it would refuse "spaceship-42-blue".
  assert.deepEqual(personalTokens({ email: "am@x.test", fullName: "Al Bo", businessName: "Ace" }), []);
  assert.equal(evaluatePassword("spaceship-42-blue", { businessName: "Ace" }).ok, true);
  assert.ok(personalTokens({ email: "dana@x.test", businessName: "Ace Plumbing" }).includes("plumbing"));
});

test("the common-password check survives the obvious decorations", () => {
  assert.equal(passwordStem("Password123!"), "password");
  assert.equal(passwordStem("Letmein!!"), "letmein");
  assert.ok(COMMON_PASSWORDS.includes("password"));
  for (const bad of ["Password123!", "letmein-2024", "MonkeyMonkey11", "changeme-99"]) {
    assert.equal(evaluatePassword(bad).ok, false, `${bad} must be refused`);
  }
});

test("whitespace at the edges is refused rather than silently trimmed", () => {
  // Trimming would mean the password stored is not the password typed, and the
  // person could never sign in from a client that does not trim.
  assert.ok(evaluatePassword("  correct-horse-73  ").failures.includes("surrounding_whitespace"));
  assert.equal(evaluatePassword("correct-horse-73").ok, true);
});

test("non-strings and empty input are refused, never thrown on", () => {
  for (const value of [undefined, null, 12345678901, {}, []]) {
    const verdict = evaluatePassword(value);
    assert.equal(verdict.ok, false);
    assert.ok(verdict.failures.includes("too_short"));
  }
});

test("every failure code has a sentence in both languages", () => {
  const codes = new Set();
  for (const bad of ["", "password1", "11111111111", "qwerty12345", "  aB3!xyzpq  ", "a".repeat(200), "aaaa1111bbbb", "1234567890123"]) {
    for (const code of evaluatePassword(bad, { email: "d@x.test" }).failures) codes.add(code);
  }
  assert.ok(codes.size >= 6, "the sample should exercise most of the rule set");
  for (const locale of ["en", "he"]) {
    const sentences = describePasswordFailures([...codes], locale);
    assert.equal(sentences.length, codes.size);
    for (const [index, sentence] of sentences.entries()) {
      assert.notEqual(sentence, [...codes][index], `code ${[...codes][index]} has no ${locale} sentence`);
      assert.ok(sentence.length > 5);
    }
  }
});

// ---------------------------------------------------------------------------
// Structural: the policy has to be reachable from the SERVER, or none of the
// above matters. Comments are stripped first so a mention in prose cannot
// satisfy the check.
// ---------------------------------------------------------------------------
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

test("signup validates the password on the server, not only in the browser", () => {
  const action = strip(readFileSync(join(root, "app/signup/actions.ts"), "utf8"));
  assert.match(action, /^"use server"/m, "it must be a server action");
  assert.ok(action.includes("evaluatePassword"), "the server must run the rule");
  assert.ok(action.includes("supabase.auth.signUp"), "the server, not the browser, calls Supabase");
  // The origin must not come from the client — §2.20's branded-phishing finding.
  assert.ok(!action.includes("window.location"), "no client-supplied origin");
  assert.ok(action.includes("appUrl()"), "the redirect target is derived server-side");
});

test("the sign-up form no longer holds the only copy of the rule", () => {
  const form = strip(readFileSync(join(root, "app/signup/SignUpForm.tsx"), "utf8"));
  assert.ok(!form.includes("supabase.auth.signUp"), "the browser must not create the account directly any more");
  assert.ok(form.includes("createAccount"), "it posts to the server action");
  assert.ok(form.includes("password-policy.mjs"), "the meter uses the same module the server uses");
});

test("changing a password is held to the same policy", () => {
  const action = strip(readFileSync(join(root, "app/(app)/settings/security/actions.ts"), "utf8"));
  assert.ok(action.includes("evaluatePassword"), "an account could otherwise be downgraded to '1234' a minute after signup");
  assert.ok(action.includes("signInWithPassword"), "the current password is re-verified before it can be replaced");
  assert.ok(action.includes("updateUser"), "and only then is it changed");
});

test("the module states the path it cannot reach instead of implying completeness", () => {
  const source = readFileSync(join(root, "lib/core/password-policy.mjs"), "utf8");
  assert.match(source, /GoTrue|Auth Hook/, "the direct-to-Supabase bypass must be written down, not glossed over");
});
