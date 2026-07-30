"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { dismissOnboarding } from "@/app/(app)/dashboard-actions";
import { useAppLocale } from "@/components/LocaleProvider";

export type Step = { label: string; done: boolean; href: string };

export default function SetupChecklist({ steps }: { steps: Step[] }) {
  const router = useRouter();
  const he = useAppLocale() === "he";
  const [pending, start] = useTransition();
  const done = steps.filter((step) => step.done).length;
  const percent = Math.round((done / steps.length) * 100);
  const next = steps.find((step) => !step.done);

  return (
    <section className="setup-guide pop-in" aria-labelledby="setup-guide-title">
      <header>
        <div>
          <span>{he ? "הגדרה ראשונית" : "Workspace setup"}</span>
          <h2 id="setup-guide-title">{he ? "מסיימים כמה דברים קטנים ומתחילים לעבוד" : "A few quick steps, then you’re ready to work"}</h2>
          <p>{he ? `${done} מתוך ${steps.length} הושלמו` : `${done} of ${steps.length} complete`}</p>
        </div>
        <button
          type="button"
          onClick={() => start(async () => { await dismissOnboarding(); router.refresh(); })}
          disabled={pending}
        >
          {he ? "לא עכשיו" : "Not now"}
        </button>
      </header>

      <div className="setup-progress" aria-label={he ? `${percent}% הושלמו` : `${percent}% complete`}>
        <i style={{ width: `${percent}%` }} />
      </div>

      {next && (
        <Link className="setup-next" href={next.href}>
          <span aria-hidden="true">{done + 1}</span>
          <div><small>{he ? "השלב הבא" : "Next step"}</small><strong>{next.label}</strong></div>
          <b>{he ? "להמשך" : "Continue"}<i aria-hidden="true">→</i></b>
        </Link>
      )}

      <details className="setup-all">
        <summary>{he ? "כל שלבי ההגדרה" : "View all setup steps"}<span>{steps.length}</span></summary>
        <div>
          {steps.map((step, index) => (
            <Link key={`${step.href}-${index}`} href={step.href} className={step.done ? "done" : ""}>
              <span aria-hidden="true">{step.done ? "✓" : index + 1}</span>
              <strong>{step.label}</strong>
              <b aria-hidden="true">›</b>
            </Link>
          ))}
        </div>
      </details>
    </section>
  );
}
