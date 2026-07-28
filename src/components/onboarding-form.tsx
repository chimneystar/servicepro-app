"use client";

import { useActionState } from "react";
import { createBusinessAction, type OnboardingState } from "@/app/onboarding/actions";

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createBusinessAction, {} as OnboardingState);
  return (
    <form action={action} className="onboarding-form">
      <label>
        שם העסק
        <input name="business_name" placeholder="למשל: רון מיזוג אוויר" autoFocus required />
      </label>
      <p>זה השם שיופיע לצוות. תמיד אפשר לשנות אותו אחר כך.</p>
      {state.error && <p className="form-message error" role="alert">{state.error}</p>}
      <button className="primary-btn wide" disabled={pending} type="submit">
        {pending ? "פותחים את העסק…" : "כניסה לעסק"}
      </button>
    </form>
  );
}
