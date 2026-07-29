"use client";

import { useState } from "react";
import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import { createClient } from "@/lib/supabase/client";
import { t, type Locale } from "@/lib/i18n";

export default function RecoveryForm({ locale }: { locale: Locale }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(null);
    const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
    setBusy(false); if (error) { setMessage(error.message); return; } setSent(true);
  }
  return <AuthShell locale={locale} eyebrow={t(locale,"recovery.eyebrow")} title={sent ? t(locale,"recovery.sentTitle") : t(locale,"recovery.title")} description={sent ? t(locale,"recovery.sentText") : t(locale,"recovery.description")}>
    {sent ? <div className="auth-success"><span aria-hidden="true">✉</span><Link className="auth-submit" href="/login">{t(locale,"signup.backToSignIn")}<b aria-hidden="true">→</b></Link></div> : <form onSubmit={submit} className="auth-form"><label>{t(locale,"login.email")}<input required type="email" inputMode="email" autoComplete="email" value={email} onChange={(event)=>setEmail(event.target.value)} placeholder="you@business.com" /></label>{message && <div className="auth-message error" role="alert">{message}</div>}<button className="auth-submit" disabled={busy}>{busy?t(locale,"login.wait"):t(locale,"recovery.send")}<span aria-hidden="true">→</span></button><p className="auth-switch"><Link href="/login">{t(locale,"recovery.remembered")}</Link></p></form>}
  </AuthShell>;
}
