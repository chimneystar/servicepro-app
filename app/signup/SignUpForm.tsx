"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import { createClient } from "@/lib/supabase/client";
import { t, type Locale } from "@/lib/i18n";

export default function SignUpForm({ locale }: { locale: Locale }) {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({ ownerName: "", businessName: "", phone: "", email: "", password: "", confirm: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const passwordChecks = useMemo(() => ({ length: form.password.length >= 8, letter: /[A-Za-z]/.test(form.password), number: /\d/.test(form.password), match: form.password.length > 0 && form.password === form.confirm }), [form.password, form.confirm]);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (!Object.values(passwordChecks).every(Boolean)) { setMessage(t(locale, "signup.passwordError")); return; }
    if (!accepted) { setMessage(t(locale, "signup.termsError")); return; }
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/onboarding`,
        data: { full_name: form.ownerName.trim(), business_name: form.businessName.trim(), phone: form.phone.trim(), locale },
      },
    });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    if (data.session) { router.push("/onboarding"); router.refresh(); return; }
    setSent(true);
  }

  if (sent) return (
    <AuthShell locale={locale} eyebrow={t(locale, "signup.almostThere")} title={t(locale, "signup.checkEmail")} description={t(locale, "signup.emailSent", { email: form.email })}>
      <div className="auth-success"><span aria-hidden="true">✉</span><p>{t(locale, "signup.emailHelp")}</p><Link className="auth-submit" href="/login">{t(locale, "signup.backToSignIn")}<b aria-hidden="true">→</b></Link></div>
    </AuthShell>
  );

  return (
    <AuthShell locale={locale} eyebrow={t(locale, "signup.startFree")} title={t(locale, "login.title_signup")} description={t(locale, "signup.description")}>
      <form onSubmit={submit} className="auth-form signup-form">
        <div className="auth-field-grid">
          <label>{t(locale, "signup.ownerName")}<input required autoComplete="name" value={form.ownerName} onChange={(event) => set("ownerName", event.target.value)} placeholder={t(locale, "signup.ownerPlaceholder")} /></label>
          <label>{t(locale, "signup.businessName")}<input required autoComplete="organization" value={form.businessName} onChange={(event) => set("businessName", event.target.value)} placeholder={t(locale, "signup.businessPlaceholder")} /></label>
        </div>
        <div className="auth-field-grid">
          <label>{t(locale, "signup.phone")}<input required type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(event) => set("phone", event.target.value)} placeholder="(555) 123-4567" /></label>
          <label>{t(locale, "login.email")}<input required type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(event) => set("email", event.target.value)} placeholder="you@business.com" /></label>
        </div>
        <label>{t(locale, "login.password")}<span className="password-field"><input required minLength={8} type={showPassword ? "text" : "password"} autoComplete="new-password" value={form.password} onChange={(event) => set("password", event.target.value)} placeholder={t(locale, "login.passwordHint")} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? t(locale, "login.hidePassword") : t(locale, "login.showPassword")}>{showPassword ? "◉" : "○"}</button></span></label>
        <label>{t(locale, "signup.confirmPassword")}<input required minLength={8} type={showPassword ? "text" : "password"} autoComplete="new-password" value={form.confirm} onChange={(event) => set("confirm", event.target.value)} /></label>
        <div className="password-checks" aria-live="polite">
          <span className={passwordChecks.length ? "ok" : ""}>{t(locale, "signup.eightChars")}</span>
          <span className={passwordChecks.letter && passwordChecks.number ? "ok" : ""}>{t(locale, "signup.letterNumber")}</span>
          <span className={passwordChecks.match ? "ok" : ""}>{t(locale, "signup.passwordsMatch")}</span>
        </div>
        <label className="auth-consent"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>{t(locale, "signup.terms")}</span></label>
        {message && <div className="auth-message error" role="alert">{message}</div>}
        <button type="submit" disabled={busy} className="auth-submit">{busy ? t(locale, "login.wait") : t(locale, "signup.createWorkspace")}<span aria-hidden="true">→</span></button>
        <p className="auth-switch">{t(locale, "login.haveAccount")} <Link href="/login">{t(locale, "login.signIn")}</Link></p>
      </form>
    </AuthShell>
  );
}
