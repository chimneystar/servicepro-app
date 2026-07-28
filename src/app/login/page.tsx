import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getAuthenticatedUserId } from "@/lib/data";

export const metadata = { title: "כניסה" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const userId = await getAuthenticatedUserId();
  if (userId) redirect("/app");

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="brand lockup"><span className="brand-mark" aria-hidden="true" /><span>ServicePro</span></div>
        <div>
          <p className="eyebrow">העסק שלך, בלי הבלגן</p>
          <h1>יודעים מה קורה היום.<br />ויודעים מה צריך לעשות עכשיו.</h1>
          <p>לקוחות, עבודות, חשבוניות והוצאות — במקום אחד שנעים לעבוד איתו גם במשרד וגם בשטח.</p>
        </div>
        <div className="auth-proof">
          <span>עברית טבעית</span><span>מתאים לנייד</span><span>נתונים מאובטחים</span>
        </div>
      </section>
      <AuthForm />
    </main>
  );
}
