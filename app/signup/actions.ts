"use server";

import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { getRequestContext } from "@/lib/request-context";
import { appUrl } from "@/lib/providers";
// @ts-ignore -- pure logic, proven both ways in tests/rate-limit.test.mjs
import { consume } from "@/lib/core/rate-limit.mjs";
// @ts-ignore -- pure logic, proven both ways in tests/password-policy.test.mjs
import { evaluatePassword, describePasswordFailures } from "@/lib/core/password-policy.mjs";

export type SignUpState = {
  ok: boolean;
  error?: string;
  /** Password rules the server refused, already in the caller's language. */
  passwordProblems?: string[];
  /** True when Supabase created the user but requires email confirmation. */
  confirmationSent?: boolean;
  email?: string;
};

/**
 * Account creation, moved to the server so the password policy is real.
 *
 * THE DEFECT: every strength rule lived in a `useMemo` in SignUpForm.tsx. It
 * gated a button in the browser and nothing else. Posting straight to
 * supabase.auth.signUp — which the anon key permits — skipped it entirely, so
 * the effective policy on an account that controls a business's money was
 * whatever Supabase's default happened to be.
 *
 * The same rule now runs here, where the browser cannot decline to run it. See
 * the note at the bottom of lib/core/password-policy.mjs for the ONE path this
 * still cannot reach, and why 6b.7 is PARTIAL rather than DONE.
 */
export async function createAccount(
  _previous: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const locale = (await getLocale()) === "he" ? "he" : "en";
  const he = locale === "he";

  const ownerName = String(formData.get("ownerName") ?? "").trim();
  const businessName = String(formData.get("businessName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const accepted = formData.get("accepted") === "on";

  if (!ownerName || !businessName || !email.includes("@")) {
    return { ok: false, error: he ? "מלאו את כל השדות הנדרשים." : "Fill in every required field." };
  }
  if (!accepted) {
    return { ok: false, error: he ? "יש לאשר את התנאים." : "Please accept the terms." };
  }
  if (password !== confirm) {
    return { ok: false, error: he ? "הסיסמאות אינן תואמות." : "The passwords do not match." };
  }

  const verdict = evaluatePassword(password, { email, fullName: ownerName, businessName }) as {
    ok: boolean;
    failures: string[];
  };
  if (!verdict.ok) {
    return {
      ok: false,
      error: he ? "הסיסמה אינה עומדת בדרישות." : "That password does not meet the policy.",
      passwordProblems: describePasswordFailures(verdict.failures, locale) as string[],
    };
  }

  // Account creation is an unauthenticated endpoint like any other.
  const context = await getRequestContext();
  const limit = consume(`signup:${context.ip ?? "unknown"}`, 5, 600_000);
  if (!limit.allowed) {
    return {
      ok: false,
      error: he
        ? "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות."
        : "Too many attempts. Try again in a few minutes.",
    };
  }

  // The redirect target is derived from server configuration, never from a
  // client-supplied origin — the same rule the document-sending path was fixed
  // to follow after §2.20's branded-phishing finding.
  const base = appUrl();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      ...(base ? { emailRedirectTo: `${base.replace(/\/$/, "")}/onboarding` } : {}),
      data: { full_name: ownerName, business_name: businessName, phone, locale },
    },
  });

  if (error) return { ok: false, error: error.message };
  if (data.session) return { ok: true, email };
  return { ok: true, confirmationSent: true, email };
}
