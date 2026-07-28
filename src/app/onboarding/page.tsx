import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/onboarding-form";
import { getMembershipContext } from "@/lib/data";

export const metadata = { title: "פתיחת העסק" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const context = await getMembershipContext();
  if (!context) redirect("/login");
  if (context.membership) redirect("/app");

  return (
    <main className="onboarding-page">
      <section className="onboarding-card">
        <div className="brand lockup"><span className="brand-mark" aria-hidden="true" /><span>ServicePro</span></div>
        <p className="eyebrow">עוד חצי דקה ומתחילים</p>
        <h1>איך קוראים לעסק?</h1>
        <p>נפתח לך סביבת עבודה נקייה. משם אפשר להוסיף לקוח ראשון ולשבץ עבודה.</p>
        <OnboardingForm />
      </section>
    </main>
  );
}
