"use client";

import { useState } from "react";
import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import { createClient } from "@/lib/supabase/client";
import { t, type Locale } from "@/lib/i18n";

export default function ResetPasswordForm({ locale }: { locale: Locale }) {
  const [password,setPassword]=useState(""); const [confirm,setConfirm]=useState(""); const [busy,setBusy]=useState(false); const [done,setDone]=useState(false); const [message,setMessage]=useState<string|null>(null);
  async function submit(event:React.FormEvent){event.preventDefault();setMessage(null);if(password.length<8||!/[A-Za-z]/.test(password)||!/\d/.test(password)||password!==confirm){setMessage(t(locale,"signup.passwordError"));return;}setBusy(true);const {error}=await createClient().auth.updateUser({password});setBusy(false);if(error){setMessage(error.message);return;}setDone(true);}
  return <AuthShell locale={locale} eyebrow={t(locale,"recovery.eyebrow")} title={done?t(locale,"recovery.doneTitle"):t(locale,"recovery.newTitle")} description={done?t(locale,"recovery.doneText"):t(locale,"recovery.newDescription")}>
    {done?<div className="auth-success"><span aria-hidden="true">✓</span><Link className="auth-submit" href="/login">{t(locale,"login.signIn")}<b aria-hidden="true">→</b></Link></div>:<form className="auth-form" onSubmit={submit}><label>{t(locale,"login.password")}<input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event)=>setPassword(event.target.value)}/></label><label>{t(locale,"signup.confirmPassword")}<input required minLength={8} type="password" autoComplete="new-password" value={confirm} onChange={(event)=>setConfirm(event.target.value)}/></label>{message&&<div className="auth-message error" role="alert">{message}</div>}<button className="auth-submit" disabled={busy}>{busy?t(locale,"login.wait"):t(locale,"recovery.save")}<span aria-hidden="true">→</span></button></form>}
  </AuthShell>;
}
