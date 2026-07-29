import { redirect } from "next/navigation";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function WarrantiesPage() {
  const profile = await requireProfile(); if (profile.role === "tech") redirect("/tech");
  const locale = await getLocale(); const he = locale === "he"; const supabase = await createClient(); const today = new Date().toISOString().slice(0, 10);
  const [{ data: callbacks }, { data: warranties }] = await Promise.all([
    supabase.from("warranty_callbacks").select("id,original_job_id,callback_job_id,issue,priority,responsibility,status,scheduled_for,resolution,reported_at").order("reported_at", { ascending: false }).limit(250),
    supabase.from("job_warranties").select("id,job_id,coverage_type,starts_on,expires_on,status").eq("status", "active").order("expires_on", { ascending: true, nullsFirst: false }).limit(250),
  ]);
  const jobIds = [...new Set([...(callbacks ?? []).flatMap((row) => [row.original_job_id, row.callback_job_id]), ...(warranties ?? []).map((row) => row.job_id)].filter(Boolean))] as string[];
  const { data: jobs } = jobIds.length ? await supabase.from("jobs").select("id,service,scheduled_date,customer_id,customers(name)").in("id", jobIds) : { data: [] };
  const jobMap = new Map((jobs ?? []).map((job) => [job.id, job]));
  const open = (callbacks ?? []).filter((row) => !["resolved", "denied"].includes(row.status)); const urgent = open.filter((row) => row.priority === "urgent");
  const scheduled = open.filter((row) => row.callback_job_id); const expiring = (warranties ?? []).filter((row) => row.expires_on && row.expires_on >= today && row.expires_on <= addDays(today, 30));
  return <div className="warranties-page">
    <header className="warranty-center-hero"><div><span>{he ? "מרכז אחריות" : "Warranty center"}</span><h1>{he ? "מטפלים בחזרות בלי לאבד את הסיפור" : "Handle callbacks without losing the original story"}</h1><p>{he ? "כל פנייה מחוברת לעבודה המקורית, לביקור החוזר ולתוצאה הסופית." : "Every issue stays connected to the original job, return visit, and final outcome."}</p></div><Link href="/jobs">{he ? "פתיחת רשימת העבודות" : "Open jobs"}</Link></header>
    <div className="warranty-center-stats"><Metric label={he ? "פתוחות" : "Open callbacks"} value={open.length} /><Metric label={he ? "דחופות" : "Urgent"} value={urgent.length} tone="coral" /><Metric label={he ? "נקבע להן ביקור" : "Visits scheduled"} value={scheduled.length} /><Metric label={he ? "אחריות מסתיימת החודש" : "Expiring in 30 days"} value={expiring.length} tone="yellow" /></div>
    <div className="warranty-center-grid"><section className="warranty-queue"><header><div><span>{he ? "תור לטיפול" : "Callback queue"}</span><h2>{he ? "מה צריך לקרות עכשיו" : "What needs attention now"}</h2></div><b>{open.length}</b></header>{open.length ? open.map((callback) => { const job = jobMap.get(callback.original_job_id); const customer = relationName(job?.customers); return <article key={callback.id} className={`priority-${callback.priority}`}><div className="warranty-queue-status"><i /><span>{statusLabel(callback.status, he)}</span></div><div><h3>{callback.issue}</h3><p>{customer || (he ? "לקוח" : "Customer")} · {job?.service || (he ? "עבודה" : "Job")}</p><small>{responsibilityLabel(callback.responsibility, he)} · {new Intl.DateTimeFormat(he ? "he-IL" : "en-US", { dateStyle: "medium" }).format(new Date(callback.reported_at))}</small></div><Link href={`/jobs/${callback.original_job_id}`}>{he ? "פתיחה" : "Open"}</Link></article>; }) : <div className="history-empty"><span>✓</span><strong>{he ? "אין חזרות פתוחות" : "The callback queue is clear"}</strong><p>{he ? "חזרה חדשה שנפתחת בעבודה תופיע כאן מיד." : "New callbacks reported on a job will appear here."}</p></div>}</section>
      <aside className="warranty-expiry"><header><span>{he ? "אחריות שמסתיימת בקרוב" : "Coverage expiring soon"}</span><b>{expiring.length}</b></header>{expiring.map((warranty) => { const job = jobMap.get(warranty.job_id); const customer = relationName(job?.customers); return <Link key={warranty.id} href={`/jobs/${warranty.job_id}`}><div><strong>{customer || job?.service}</strong><small>{job?.service} · {coverageLabel(warranty.coverage_type, he)}</small></div><span>{daysBetween(today, warranty.expires_on!)} {he ? "ימים" : "days"}</span></Link>; })}{!expiring.length && <p>{he ? "אין אחריות שמסתיימת ב-30 הימים הקרובים." : "No warranties expire in the next 30 days."}</p>}<div className="warranty-center-note"><b>{he ? "טיפ" : "Tip"}</b><p>{he ? "פותחים אחריות מתוך העבודה שהושלמה. כך כל חזרה נשארת מחוברת למקור." : "Add coverage from the completed job so every callback stays connected to its source."}</p></div></aside>
    </div>
  </div>;
}

function Metric({ label, value, tone = "blue" }: { label: string; value: number; tone?: string }) { return <article className={`tone-${tone}`}><span>{label}</span><strong>{value}</strong></article>; }
function addDays(date: string, amount: number) { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + amount); return value.toISOString().slice(0, 10); }
function daysBetween(a: string, b: string) { return Math.max(0, Math.ceil((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000)); }
function statusLabel(value: string, he: boolean) { return ({ reported: he ? "דווחה" : "Reported", scheduled: he ? "נקבע ביקור" : "Scheduled", in_progress: he ? "בטיפול" : "In progress" } as Record<string,string>)[value] ?? value; }
function responsibilityLabel(value: string, he: boolean) { return ({ review: he ? "ממתין לבדיקת כיסוי" : "Coverage review", covered: he ? "מכוסה" : "Covered", customer: he ? "באחריות הלקוח" : "Customer responsibility", manufacturer: he ? "אחריות יצרן" : "Manufacturer warranty", third_party: he ? "צד שלישי" : "Third party" } as Record<string,string>)[value] ?? value; }
function coverageLabel(value: string, he: boolean) { return ({ workmanship: he ? "עבודה" : "Workmanship", manufacturer: he ? "יצרן" : "Manufacturer", custom: he ? "מותאם" : "Custom" } as Record<string,string>)[value] ?? value; }
function relationName(value: { name: string } | { name: string }[] | null | undefined) { return Array.isArray(value) ? value[0]?.name ?? "" : value?.name ?? ""; }
