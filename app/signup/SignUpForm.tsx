"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import { t, type Locale } from "@/lib/i18n";
// @ts-ignore -- the SAME rule the server enforces, so the meter cannot disagree
// with the answer. Before this, the browser held the only copy of the policy.
import {
  evaluatePassword,
  describePasswordFailures,
  MIN_LENGTH,
} from "@/lib/core/password-policy.mjs";
import { createAccount, type SignUpState } from "./actions";

const initial: SignUpState = { ok: false };
const problemListStyle = {
  margin: "6px 0 0",
  paddingInlineStart: 18,
  fontSize: "0.875rem",
  lineHeight: 1.5,
} as const;

export default function SignUpForm({ locale }: { locale: Locale }) {
  const router = useRouter();
  const he = locale === "he";
  const [state, formAction, pending] = useActionState(createAccount, initial);
  const [form, setForm] = useState({
    ownerName: "",
    businessName: "",
    phone: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [showPassword, setShowPassword] = useState(false);

  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  // Advisory preview only. The gate is the server action; this exists so
  // somebody is not told "does not meet the policy" after pressing the button
  // with no idea which rule they broke.
  const verdict = useMemo(
    () =>
      evaluatePassword(form.password, {
        email: form.email,
        fullName: form.ownerName,
        businessName: form.businessName,
      }) as { ok: boolean; failures: string[]; score: number },
    [form.password, form.email, form.ownerName, form.businessName],
  );
  const previewProblems = form.password
    ? (describePasswordFailures(verdict.failures, he ? "he" : "en") as string[])
    : [];
  const matches = form.password.length > 0 && form.password === form.confirm;

  const signedIn = state.ok && !state.confirmationSent;
  useEffect(() => {
    if (!signedIn) return;
    router.push("/onboarding");
    router.refresh();
  }, [signedIn, router]);

  if (state.ok && state.confirmationSent)
    return (
      <AuthShell
        locale={locale}
        eyebrow={t(locale, "signup.almostThere")}
        title={t(locale, "signup.checkEmail")}
        description={t(locale, "signup.emailSent", { email: state.email ?? form.email })}
      >
        <div className="auth-success">
          <span aria-hidden="true">✉</span>
          <p>{t(locale, "signup.emailHelp")}</p>
          <Link className="auth-submit" href="/login">
            {t(locale, "signup.backToSignIn")}
            <b aria-hidden="true">→</b>
          </Link>
        </div>
      </AuthShell>
    );

  return (
    <AuthShell
      locale={locale}
      eyebrow={t(locale, "signup.startFree")}
      title={t(locale, "login.title_signup")}
      description={t(locale, "signup.description")}
    >
      <form action={formAction} className="auth-form signup-form">
        <div className="auth-field-grid">
          <label>
            {t(locale, "signup.ownerName")}
            <input
              name="ownerName"
              required
              autoComplete="name"
              value={form.ownerName}
              onChange={(event) => set("ownerName", event.target.value)}
              placeholder={t(locale, "signup.ownerPlaceholder")}
            />
          </label>
          <label>
            {t(locale, "signup.businessName")}
            <input
              name="businessName"
              required
              autoComplete="organization"
              value={form.businessName}
              onChange={(event) => set("businessName", event.target.value)}
              placeholder={t(locale, "signup.businessPlaceholder")}
            />
          </label>
        </div>
        <div className="auth-field-grid">
          <label>
            {t(locale, "signup.phone")}
            <input
              name="phone"
              required
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={(event) => set("phone", event.target.value)}
              placeholder="(555) 123-4567"
            />
          </label>
          <label>
            {t(locale, "login.email")}
            <input
              name="email"
              required
              type="email"
              inputMode="email"
              autoComplete="email"
              value={form.email}
              onChange={(event) => set("email", event.target.value)}
              placeholder="you@business.com"
            />
          </label>
        </div>
        <label>
          {t(locale, "login.password")}
          <span className="password-field">
            <input
              name="password"
              required
              minLength={MIN_LENGTH}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => set("password", event.target.value)}
              placeholder={t(locale, "login.passwordHint")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={
                showPassword ? t(locale, "login.hidePassword") : t(locale, "login.showPassword")
              }
            >
              {showPassword ? "◉" : "○"}
            </button>
          </span>
        </label>
        <label>
          {t(locale, "signup.confirmPassword")}
          <input
            name="confirm"
            required
            minLength={MIN_LENGTH}
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={form.confirm}
            onChange={(event) => set("confirm", event.target.value)}
          />
        </label>
        <div className="password-checks" aria-live="polite">
          <span className={verdict.ok ? "ok" : ""}>
            {he ? `לפחות ${MIN_LENGTH} תווים, מגוונים` : `At least ${MIN_LENGTH} varied characters`}
          </span>
          <span className={matches ? "ok" : ""}>{t(locale, "signup.passwordsMatch")}</span>
        </div>
        {previewProblems.length > 0 && (
          <ul style={problemListStyle}>
            {previewProblems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        <label className="auth-consent">
          <input name="accepted" type="checkbox" />
          <span>{t(locale, "signup.terms")}</span>
        </label>
        {state.error && (
          <div className="auth-message error" role="alert">
            {state.error}
            {state.passwordProblems?.length ? (
              <ul style={problemListStyle}>
                {state.passwordProblems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
        <button type="submit" disabled={pending} className="auth-submit">
          {pending ? t(locale, "login.wait") : t(locale, "signup.createWorkspace")}
          <span aria-hidden="true">→</span>
        </button>
        <p className="auth-switch">
          {t(locale, "login.haveAccount")} <Link href="/login">{t(locale, "login.signIn")}</Link>
        </p>
      </form>
    </AuthShell>
  );
}
