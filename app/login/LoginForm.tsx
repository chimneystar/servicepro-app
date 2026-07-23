"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { t, type Locale } from "@/lib/i18n";
import LanguageToggle from "@/components/LanguageToggle";

export default function LoginForm({ locale }: { locale: Locale }) {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg(t(locale, "login.confirmSent"));
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/");
        router.refresh();
      }
    } catch (err: any) {
      setMsg(err?.message ?? t(locale, "err.invalid"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(165deg,#0f2a5e,#1d4ed8 60%,#2563eb)", padding: 20 }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 380, background: "#fff",
        borderRadius: 20, padding: 28, boxShadow: "0 30px 60px rgba(0,0,0,.3)" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <LanguageToggle current={locale} />
        </div>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, margin: "0 auto 12px",
            background: "linear-gradient(135deg,#38bdf8,#2563eb)", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 34 }}>❄️</div>
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>{t(locale, "app.name")}</h1>
          <p style={{ color: "#64748b", fontSize: 14, marginTop: 4 }}>
            {mode === "login" ? t(locale, "login.title_login") : t(locale, "login.title_signup")}
          </p>
        </div>

        <label style={lbl}>{t(locale, "login.email")}</label>
        <input style={inp} type="email" value={email} required
          onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" />

        <label style={lbl}>{t(locale, "login.password")}</label>
        <input style={inp} type="password" value={password} required minLength={8}
          onChange={(e) => setPassword(e.target.value)} placeholder={t(locale, "login.passwordHint")} />

        {msg && <div style={{ background: "#eff6ff", color: "#1d4ed8", padding: "10px 12px",
          borderRadius: 10, fontSize: 13, margin: "6px 0 12px" }}>{msg}</div>}

        <button type="submit" disabled={busy} style={btn}>
          {busy ? t(locale, "login.wait") : mode === "login" ? t(locale, "login.signIn") : t(locale, "login.signUp")}
        </button>

        <div style={{ textAlign: "center", fontSize: 13.5, color: "#64748b", marginTop: 14 }}>
          {mode === "login" ? t(locale, "login.noAccount") : t(locale, "login.haveAccount")}{" "}
          <button type="button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMsg(null); }}
            style={{ background: "none", border: "none", color: "#2563eb", fontWeight: 700, cursor: "pointer" }}>
            {mode === "login" ? t(locale, "login.signUp") : t(locale, "login.signIn")}
          </button>
        </div>
      </form>
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#334155", display: "block", margin: "10px 0 6px" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px", fontSize: 16, outline: "none" };
const btn: React.CSSProperties = { width: "100%", background: "#2563eb", color: "#fff", border: "none", borderRadius: 12, padding: 14, fontSize: 16, fontWeight: 700, cursor: "pointer", marginTop: 8 };
