"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveAppearance, type AppearanceResult } from "./actions";
import type { Locale } from "@/lib/i18n";

type Preferences = {
  theme: "light" | "dark" | "system";
  contrast: "normal" | "high";
  textScale: "normal" | "large";
  reduceMotion: boolean;
};

const initial: AppearanceResult = { ok: false };

export default function AppearanceForm({ locale, initialValues }: { locale: Locale; initialValues: Preferences }) {
  const he = locale === "he";
  const [values, setValues] = useState(initialValues);
  const [state, action] = useActionState(saveAppearance, initial);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = values.theme;
    root.dataset.contrast = values.contrast;
    root.dataset.textScale = values.textScale;
    root.dataset.reduceMotion = String(values.reduceMotion);
  }, [values]);

  return <form action={action} className="appearance-form">
    <fieldset className="appearance-section">
      <legend>{he ? "ערכת צבעים" : "Color theme"}</legend>
      <p>{he ? "אפשר לבחור מצב קבוע או להתאים אוטומטית למכשיר." : "Choose a fixed theme or follow this device automatically."}</p>
      <div className="appearance-choice-grid">
        {([
          ["system", he ? "כמו במכשיר" : "System", he ? "מתחלף אוטומטית" : "Changes automatically", "◐"],
          ["light", he ? "בהיר" : "Light", he ? "רקע לבן ובהיר" : "Bright, clean surfaces", "☀"],
          ["dark", he ? "כהה" : "Dark", he ? "נוח יותר בתאורה חלשה" : "Comfortable in low light", "☾"],
        ] as const).map(([value, title, text, icon]) => <label key={value} className="appearance-choice">
          <input type="radio" name="theme" value={value} checked={values.theme === value} onChange={() => setValues((current) => ({ ...current, theme: value }))} />
          <span aria-hidden="true">{icon}</span><strong>{title}</strong><small>{text}</small>
        </label>)}
      </div>
    </fieldset>

    <fieldset className="appearance-section">
      <legend>{he ? "קריאות ונגישות" : "Readability & accessibility"}</legend>
      <p>{he ? "ההגדרות האלה משפיעות רק על החשבון שלך." : "These preferences apply only to your account."}</p>
      <div className="appearance-switches">
        <label><span><strong>{he ? "ניגודיות גבוהה" : "High contrast"}</strong><small>{he ? "גבולות וטקסט ברורים יותר" : "Stronger borders and clearer text"}</small></span><input type="checkbox" name="contrast" value="high" checked={values.contrast === "high"} onChange={(event) => setValues((current) => ({ ...current, contrast: event.target.checked ? "high" : "normal" }))} /></label>
        <input type="hidden" name="contrast" value={values.contrast} />
        <label><span><strong>{he ? "טקסט גדול" : "Larger text"}</strong><small>{he ? "מגדיל טקסט ופקדים חשובים" : "Makes text and important controls larger"}</small></span><input type="checkbox" name="largeTextPreview" checked={values.textScale === "large"} onChange={(event) => setValues((current) => ({ ...current, textScale: event.target.checked ? "large" : "normal" }))} /></label>
        <input type="hidden" name="textScale" value={values.textScale} />
        <label><span><strong>{he ? "פחות תנועה" : "Reduce motion"}</strong><small>{he ? "מצמצם אנימציות ומעברים" : "Minimizes animations and transitions"}</small></span><input type="checkbox" name="reduceMotion" checked={values.reduceMotion} onChange={(event) => setValues((current) => ({ ...current, reduceMotion: event.target.checked }))} /></label>
      </div>
    </fieldset>

    <div className="appearance-actions"><SaveButton he={he} />{state.ok && <span role="status">✓ {he ? "המראה נשמר" : "Appearance saved"}</span>}{state.error && <span role="alert" className="form-error">{state.error}</span>}</div>
  </form>;
}

function SaveButton({ he }: { he: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="ops-primary" disabled={pending}>{pending ? (he ? "שומרים…" : "Saving…") : (he ? "שמירת מראה" : "Save appearance")}</button>;
}

