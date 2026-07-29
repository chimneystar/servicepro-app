import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/lib/i18n";
// @ts-ignore - shared pure JavaScript is also exercised directly by Node tests.
import { formatUsPhone } from "@/lib/core/calls.mjs";

export type JobTimelineEntry = {
  id: string;
  kind: "change" | "note" | "follow_up" | "call" | "warranty" | "callback";
  tone: "blue" | "yellow" | "coral" | "navy";
  title: string;
  detail?: string | null;
  actor?: string | null;
  at: string;
  status?: string | null;
  actionId?: string;
  canComplete?: boolean;
};

const fieldLabels: Record<string, [string, string]> = {
  service: ["Service", "שירות"], status: ["Status", "סטטוס"], stage: ["Job stage", "שלב העבודה"],
  scheduled_date: ["Date", "תאריך"], start_time: ["Start time", "שעת התחלה"], end_time: ["End time", "שעת סיום"],
  assigned_to: ["Technician", "טכנאי"], price_minor: ["Price", "מחיר"], notes: ["Job notes", "הערות עבודה"],
  job_address: ["Service address", "כתובת העבודה"], job_city: ["City", "עיר"], tags: ["Tags", "תגיות"],
  on_my_way_at: ["On my way", "בדרך ללקוח"], started_at: ["Work started", "העבודה התחילה"],
  completed_at: ["Work completed", "העבודה הושלמה"], parent_job_id: ["Original job", "עבודה מקורית"],
};
const ignored = new Set(["id", "organization_id", "created_at", "updated_at", "deleted_at", "slot", "sample_batch_id"]);

function changedFields(oldData: Record<string, unknown> | null, newData: Record<string, unknown> | null, locale: Locale) {
  if (!newData) return [];
  return Object.keys(newData).filter((key) => !ignored.has(key) && JSON.stringify(oldData?.[key]) !== JSON.stringify(newData[key]))
    .map((key) => fieldLabels[key]?.[locale === "he" ? 1 : 0] ?? key.replaceAll("_", " ")).slice(0, 5);
}

export async function loadJobHistory(jobId: string, locale: Locale, currentProfileId: string): Promise<JobTimelineEntry[]> {
  const he = locale === "he"; const supabase = await createClient();
  const [auditResult, actionsResult, callsResult, warrantyResult, callbacksResult] = await Promise.all([
    supabase.from("audit_log").select("id,action,actor,old_data,new_data,at").eq("table_name", "jobs").eq("row_id", jobId).order("at", { ascending: false }).limit(60),
    supabase.from("job_actions").select("id,action_type,title,body,status,due_at,assigned_to,created_by,completed_by,completed_at,created_at").eq("job_id", jobId).order("created_at", { ascending: false }),
    supabase.from("call_events").select("id,direction,status,from_number,to_number,reason,outcome,notes,needs_follow_up,handled_by,duration_seconds,started_at").eq("job_id", jobId).order("started_at", { ascending: false }),
    supabase.from("job_warranties").select("id,coverage_type,starts_on,expires_on,status,created_by,created_at").eq("job_id", jobId).maybeSingle(),
    supabase.from("warranty_callbacks").select("id,issue,priority,responsibility,status,scheduled_for,resolution,created_by,resolved_by,resolved_at,reported_at,callback_job_id").eq("original_job_id", jobId).order("reported_at", { ascending: false }),
  ]);

  const audit = auditResult.data ?? []; const actions = actionsResult.data ?? []; const calls = callsResult.data ?? [];
  const warranty = warrantyResult.data; const callbacks = callbacksResult.data ?? [];
  const actorIds = [...new Set([
    ...audit.map((row) => row.actor), ...actions.flatMap((row) => [row.created_by, row.completed_by, row.assigned_to]),
    ...calls.map((row) => row.handled_by), ...(warranty ? [warranty.created_by] : []),
    ...callbacks.flatMap((row) => [row.created_by, row.resolved_by]),
  ].filter(Boolean))] as string[];
  const { data: people } = actorIds.length ? await supabase.from("profiles").select("id,full_name").in("id", actorIds) : { data: [] };
  const names = new Map((people ?? []).map((person) => [person.id, person.full_name]));
  const who = (id: string | null) => id ? names.get(id) ?? null : null;

  const entries: JobTimelineEntry[] = audit.map((row) => {
    const fields = row.action === "UPDATE" ? changedFields(row.old_data, row.new_data, locale) : [];
    const title = row.action === "INSERT" ? (he ? "העבודה נפתחה" : "Job created") : row.action === "DELETE" ? (he ? "העבודה נמחקה" : "Job deleted") : (he ? "פרטי העבודה עודכנו" : "Job details updated");
    return { id: `audit-${row.id}`, kind: "change", tone: row.action === "DELETE" ? "coral" : "blue", title, detail: fields.length ? (he ? `מה השתנה: ${fields.join(", ")}` : `Changed: ${fields.join(", ")}`) : null, actor: who(row.actor), at: row.at };
  });
  actions.forEach((row) => {
    const isFollowUp = row.action_type === "follow_up";
    entries.push({ id: `action-${row.id}`, kind: isFollowUp ? "follow_up" : "note", tone: isFollowUp && row.status === "open" ? "yellow" : "navy", title: row.title, detail: row.body || (row.due_at ? `${he ? "לביצוע עד" : "Due"} ${new Intl.DateTimeFormat(he ? "he-IL" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.due_at))}` : null), actor: who(row.created_by), at: row.created_at, status: row.status, actionId: row.id, canComplete: row.status === "open" && (!row.assigned_to || row.assigned_to === currentProfileId) });
    if (row.completed_at) entries.push({ id: `action-done-${row.id}`, kind: "follow_up", tone: "navy", title: he ? `הושלם: ${row.title}` : `Completed: ${row.title}`, actor: who(row.completed_by), at: row.completed_at, status: "done" });
  });
  calls.forEach((row) => {
    const missed = ["missed", "failed", "voicemail"].includes(row.status);
    const direction = row.direction === "inbound" ? (he ? "שיחה נכנסת" : "Inbound call") : (he ? "שיחה יוצאת" : "Outbound call");
    const otherNumber = row.direction === "inbound" ? row.from_number : row.to_number;
    const duration = row.duration_seconds ? `${Math.floor(row.duration_seconds / 60)}:${String(row.duration_seconds % 60).padStart(2, "0")}` : null;
    entries.push({ id: `call-${row.id}`, kind: "call", tone: missed ? "coral" : "blue", title: `${direction} · ${formatUsPhone(otherNumber)}`, detail: [row.reason, row.outcome, duration ? `${he ? "משך" : "Duration"} ${duration}` : null, row.notes].filter(Boolean).join(" · "), actor: who(row.handled_by), at: row.started_at, status: row.needs_follow_up ? "follow_up" : row.status });
  });
  if (warranty) entries.push({ id: `warranty-${warranty.id}`, kind: "warranty", tone: "yellow", title: he ? "נוספה אחריות לעבודה" : "Warranty added", detail: `${warranty.starts_on}${warranty.expires_on ? ` → ${warranty.expires_on}` : ` · ${he ? "ללא תאריך סיום" : "No end date"}`}`, actor: who(warranty.created_by), at: warranty.created_at, status: warranty.status });
  callbacks.forEach((row) => {
    entries.push({ id: `callback-${row.id}`, kind: "callback", tone: row.priority === "urgent" ? "coral" : "yellow", title: he ? "דווחה חזרה במסגרת אחריות" : "Warranty callback reported", detail: row.issue, actor: who(row.created_by), at: row.reported_at, status: row.status });
    if (row.scheduled_for && row.callback_job_id) entries.push({ id: `callback-scheduled-${row.id}`, kind: "callback", tone: "blue", title: he ? "נקבע ביקור חוזר" : "Return visit scheduled", detail: row.scheduled_for, at: `${row.scheduled_for}T12:00:00.000Z`, status: "scheduled" });
    if (row.resolved_at) entries.push({ id: `callback-resolved-${row.id}`, kind: "callback", tone: "navy", title: row.status === "denied" ? (he ? "בקשת האחריות נדחתה" : "Warranty request denied") : (he ? "החזרה נסגרה" : "Callback resolved"), detail: row.resolution, actor: who(row.resolved_by), at: row.resolved_at, status: row.status });
  });
  return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 120);
}
