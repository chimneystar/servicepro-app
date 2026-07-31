"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { dismissOnboarding } from "@/app/(app)/dashboard-actions";
import { useAppLocale } from "@/components/LocaleProvider";
import { ActionError, useActionStatus } from "@/components/ActionStatus";

export type Step = { label: string; done: boolean; href: string };

export default function SetupChecklist({ steps }: { steps: Step[] }) {
  const router = useRouter();
  const he = useAppLocale() === "he";
  const { pending, error, run } = useActionStatus(he);
  const done = steps.filter((s) => s.done).length;
  const pct = Math.round((done / steps.length) * 100);

  return (
    <div className="pop-in" style={{ background: "linear-gradient(135deg,#0f2a5e,#2563eb)", color: "#fff", borderRadius: 16, padding: 18, marginBottom: 16, boxShadow: "0 18px 50px rgba(15,42,94,.18)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <div style={{ fontSize: "1.0625rem", fontWeight: 800 }}>{he ? "מסיימים את ההגדרה" : "Finish setting up"}</div>
          <div style={{ fontSize: "0.8125rem", opacity: .9 }}>{he ? `${done} מתוך ${steps.length} הושלמו · ${pct}% מוכן` : `${done} of ${steps.length} complete · ${pct}% ready`}</div>
        </div>
        <button type="button" onClick={() => run(() => dismissOnboarding(), () => router.refresh())} disabled={pending} style={{ background: "rgba(255,255,255,.18)", color: "#fff", border: "none", borderRadius: 8, padding: "6px 10px", fontWeight: 700, fontSize: "0.75rem", cursor: "pointer" }}>{he ? "הסתרה" : "Dismiss"}</button>
      </div>

      <div style={{ height: 7, background: "rgba(255,255,255,.22)", borderRadius: 99, margin: "12px 0 14px" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "#fff", borderRadius: 99, transition: "width .4s ease" }} />
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {steps.map((s, i) => (
          <Link key={i} href={s.href} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,.10)", borderRadius: 10, padding: "10px 12px", textDecoration: "none", color: "#fff" }}>
            <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8125rem", background: s.done ? "#22c55e" : "rgba(255,255,255,.25)", fontWeight: 800 }}>{s.done ? "✓" : ""}</span>
            <span style={{ flex: 1, fontWeight: 600, fontSize: "0.875rem", textDecoration: s.done ? "line-through" : "none", opacity: s.done ? .8 : 1 }}>{s.label}</span>
            {!s.done && <span style={{ opacity: .8 }}>›</span>}
          </Link>
        ))}
      </div>
      <ActionError error={error} />
    </div>
  );
}
