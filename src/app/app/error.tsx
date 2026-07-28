"use client";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="error-page">
      <div className="error-card">
        <p className="eyebrow">החיבור נעצר</p>
        <h1>לא הצלחנו לטעון את העסק</h1>
        <p>כדאי לבדוק שהחיבור ל‑Supabase פעיל ושקובץ ה‑SQL הורץ, ואז לנסות שוב.</p>
        <button className="primary-btn" onClick={reset}>ניסיון נוסף</button>
      </div>
    </main>
  );
}
