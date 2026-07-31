"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import AuthShell from "@/components/AuthShell";
import { signIn, verifyTwoFactor, type LoginState } from "./actions";

const initial: LoginState = { ok: false };

/**
 * Sign-in now posts to a SERVER ACTION rather than calling Supabase from the
 * browser. That is the whole point: only the server can throttle an attempt,
 * record who made it, notice a new device and alert on it. The markup and the
 * copy are unchanged; the second-factor step is new.
 */
export default function LoginForm({ locale }: { locale: Locale }) {
  const router = useRouter();
  const he = locale === "he";
  const [state, formAction, pending] = useActionState(signIn, initial);
  const [mfaState, mfaAction, mfaPending] = useActionState(verifyTwoFactor, initial);
  const [showPassword, setShowPassword] = useState(false);

  const awaitingCode = (state.mfaRequired && !mfaState.ok) || mfaState.mfaRequired;
  const factorId = mfaState.factorId || state.factorId || "";
  const signedIn = (state.ok && !state.mfaRequired) || mfaState.ok;

  useEffect(() => {
    if (!signedIn) return;
    router.push("/");
    router.refresh();
  }, [signedIn, router]);

  if (awaitingCode) return (
    <AuthShell locale={locale} eyebrow={he ? "אימות דו-שלבי" : "Two-factor"} title={he ? "הזינו את הקוד" : "Enter your code"}
      description={he ? "פתחו את אפליקציית האימות ורשמו את הקוד בן שש הספרות." : "Open your authenticator app and enter the six-digit code."}>
      <form action={mfaAction} className="auth-form">
        <input type="hidden" name="factorId" value={factorId} />
        <label>{he ? "קוד אימות" : "Verification code"}
          <input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} placeholder="123456" />
        </label>
        {mfaState.error && <div className="auth-message error" role="alert">{mfaState.error}</div>}
        <button type="submit" disabled={mfaPending} className="auth-submit">{mfaPending ? t(locale, "login.wait") : (he ? "אימות" : "Verify")}<span aria-hidden="true">→</span></button>
      </form>
    </AuthShell>
  );

  return (
    <AuthShell locale={locale} eyebrow={t(locale, "login.welcomeBack")} title={t(locale, "login.title_login")} description={t(locale, "login.loginDescription")}>
      <form action={formAction} className="auth-form">
        <label>{t(locale, "login.email")}<input name="email" type="email" required autoComplete="email" inputMode="email" placeholder="you@business.com" /></label>
        <label>{t(locale, "login.password")}
          <span className="password-field"><input name="password" type={showPassword ? "text" : "password"} required minLength={8} autoComplete="current-password" placeholder={t(locale, "login.passwordHint")} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? t(locale, "login.hidePassword") : t(locale, "login.showPassword")}>{showPassword ? "◉" : "○"}</button></span>
        </label>
        <div className="auth-form-meta"><span /><Link href="/forgot-password">{t(locale, "login.forgot")}</Link></div>
        {state.error && <div className="auth-message error" role="alert">{state.error}</div>}
        <button type="submit" disabled={pending} className="auth-submit">{pending ? t(locale, "login.wait") : t(locale, "login.signIn")}<span aria-hidden="true">→</span></button>
        <p className="auth-switch">{t(locale, "login.noAccount")} <Link href="/signup">{t(locale, "login.createBusiness")}</Link></p>
      </form>
    </AuthShell>
  );
}
