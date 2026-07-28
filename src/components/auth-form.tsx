"use client";

import { useActionState, useState } from "react";
import { signInAction, signUpAction, type AuthState } from "@/app/login/actions";

const initialState: AuthState = {};

export function AuthForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signInState, signIn, signInPending] = useActionState(signInAction, initialState);
  const [signUpState, signUp, signUpPending] = useActionState(signUpAction, initialState);
  const state = mode === "signin" ? signInState : signUpState;
  const pending = mode === "signin" ? signInPending : signUpPending;

  return (
    <div className="auth-card">
      <div className="auth-tabs" aria-label="בחירת פעולה">
        <button className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")} type="button">
          כניסה
        </button>
        <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")} type="button">
          פתיחת חשבון
        </button>
      </div>

      <form action={mode === "signin" ? signIn : signUp} className="auth-form">
        {mode === "signup" && (
          <label>
            איך קוראים לך?
            <input name="display_name" autoComplete="name" placeholder="למשל: אברהם רון" required />
          </label>
        )}
        <label>
          מייל
          <input name="email" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" dir="ltr" required />
        </label>
        <label>
          סיסמה
          <input name="password" type="password" minLength={8} autoComplete={mode === "signin" ? "current-password" : "new-password"} placeholder="לפחות 8 תווים" required />
        </label>

        {state.error && <p className="form-message error" role="alert">{state.error}</p>}
        {state.message && <p className="form-message success" role="status">{state.message}</p>}

        <button className="primary-btn wide" disabled={pending} type="submit">
          {pending ? "רק רגע…" : mode === "signin" ? "כניסה ל‑ServicePro" : "פתיחת החשבון"}
        </button>
      </form>
    </div>
  );
}
