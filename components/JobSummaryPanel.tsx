import type { Locale } from "@/lib/i18n";
import { approveJobSummary, generateJobSummary } from "@/app/(app)/jobs/[id]/actions";

export type SummaryDraft = { id: string; summary: string; provider: string | null; model: string | null; status: string; created_at: string };

export default function JobSummaryPanel({ jobId, locale, drafts }: { jobId: string; locale: Locale; drafts: SummaryDraft[] }) {
  const he = locale === "he"; const latest = drafts[0];
  async function createDraft() { "use server"; await generateJobSummary(jobId); }
  async function approveDraft() { "use server"; if (latest) await approveJobSummary(latest.id,jobId); }
  return <section className="job-summary-card"><header><div><span>{he ? "סיכום עבודה חכם" : "Smart job summary"}</span><small>{he ? "נבנה מההערות, המשימות ורשימת הבדיקה — ורק אתם מאשרים." : "Built from notes, tasks and the checklist—and approved only by your team."}</small></div><form action={createDraft}><button type="submit">{latest ? (he ? "יצירת גרסה חדשה" : "Create new draft") : (he ? "יצירת סיכום" : "Create summary")}</button></form></header>{latest ? <div className="job-summary-copy"><p>{latest.summary}</p><footer><span>{latest.provider || "ServicePro"}{latest.model ? ` · ${latest.model}` : ""}</span>{latest.status === "draft" ? <form action={approveDraft}><button type="submit">{he ? "אישור הסיכום" : "Approve summary"}</button></form> : <b>{he ? "אושר" : "Approved"}</b>}</footer></div> : <div className="activity-empty">{he ? "עדיין אין סיכום. אפשר ליצור טיוטה בלחיצה אחת." : "No summary yet. Create a draft in one click."}</div>}</section>;
}
