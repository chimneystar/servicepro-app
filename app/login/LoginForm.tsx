"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { t, type Locale } from "@/lib/i18n";
import AuthShell from "@/components/AuthShell";

export default function LoginForm({ locale }: { locale: Locale }) {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      router.push("/");
      router.refresh();
    } catch (error: unknown) {
      const raw = error instanceof Error ? error.message : "";
      setMsg(raw.toLowerCase().includes("invalid login") ? t(locale, "login.invalidCredentials") : (raw || t(locale, "err.invalid")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell locale={locale} eyebrow={t(locale, "login.welcomeBack")} title={t(locale, "login.title_login")} description={t(locale, "login.loginDescription")}>
      <form onSubmit={submit} className="auth-form">
        <label>{t(locale, "login.email")}<input type="email" value={email} required autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@business.com" /></label>
        <label>{t(locale, "login.password")}
          <span className="password-field"><input type={showPassword ? "text" : "password"} value={password} required minLength={8} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} placeholder={t(locale, "login.passwordHint")} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? t(locale, "login.hidePassword") : t(locale, "login.showPassword")}>{showPassword ? "◉" : "○"}</button></span>
        </label>
        <div className="auth-form-meta"><span /><Link href="/forgot-password">{t(locale, "login.forgot")}</Link></div>
        {msg && <div className="auth-message error" role="alert">{msg}</div>}
        <button type="submit" disabled={busy} className="auth-submit">{busy ? t(locale, "login.wait") : t(locale, "login.signIn")}<span aria-hidden="true">→</span></button>
        <p className="auth-switch">{t(locale, "login.noAccount")} <Link href="/signup">{t(locale, "login.createBusiness")}</Link></p>
      </form>
    </AuthShell>
  );
}
