"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type { Locale } from "@/lib/i18n";
import { addJobTechnician, moveDispatchJob, removeJobTechnician } from "@/app/(app)/dispatch/actions";

export type DispatchTech = { id: string; full_name: string; role: string };
export type DispatchAssignment = { job_id: string; profile_id: string | null; is_lead: boolean };
export type DispatchJob = { id: string; service: string; status: string; scheduled_date: string; end_date: string | null; start_time: string | null; end_time: string | null; assigned_to: string | null; job_address: string | null; job_city: string | null; customers: { name: string } | null };

export default function DispatchBoard({ locale, date, jobs: initialJobs, techs, assignments: initialAssignments }: { locale: Locale; date: string; jobs: DispatchJob[]; techs: DispatchTech[]; assignments: DispatchAssignment[] }) {
  const he = locale === "he";
  const [jobs, setJobs] = useState(initialJobs);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const columns = useMemo(() => [{ id: "", full_name: he ? "לא משובצות" : "Unassigned", role: "" }, ...techs], [he, techs]);

  const failed = he ? "לא הצלחנו לעדכן את השיבוץ." : "We couldn't update that assignment.";

  function move(jobId: string, profileId: string | null) {
    const before = jobs;
    const beforeAssignments = assignments;
    setJobs((rows) => rows.map((job) => job.id === jobId ? { ...job, assigned_to: profileId } : job));
    // The outgoing lead's row goes with the job; leaving it made the board show
    // the previous technician as extra crew on a job they no longer had.
    setAssignments((rows) => rows.filter((row) => !(row.job_id === jobId && row.is_lead && row.profile_id !== profileId)));
    setNotice(null);
    startTransition(async () => {
      const result = await moveDispatchJob(jobId, profileId);
      if (!result.ok) { setJobs(before); setAssignments(beforeAssignments); setNotice(result.error || failed); }
    });
  }

  function add(jobId: string, profileId: string) {
    if (!profileId || assignments.some((row) => row.job_id === jobId && row.profile_id === profileId)) return;
    setNotice(null);
    startTransition(async () => {
      const result = await addJobTechnician(jobId, profileId);
      // A crew double-book is refused by the database; the dispatcher has to be
      // told why, not left looking at a select box that quietly did nothing.
      if (result.ok) setAssignments((rows) => [...rows, { job_id: jobId, profile_id: profileId, is_lead: false }]);
      else setNotice(result.error || failed);
    });
  }

  function remove(jobId: string, profileId: string) {
    setNotice(null);
    startTransition(async () => {
      const result = await removeJobTechnician(jobId, profileId);
      if (result.ok) setAssignments((rows) => rows.filter((row) => !(row.job_id === jobId && row.profile_id === profileId)));
      else setNotice(result.error || failed);
    });
  }

  const dayLabel = new Intl.DateTimeFormat(he ? "he-IL" : "en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${date}T12:00:00`));
  return <div className="dispatch-page">
    <header className="dispatch-heading"><div><span>{he ? "מרכז שיבוץ" : "Dispatch center"}</span><h1>{dayLabel}</h1><p>{he ? "גררו עבודה לטכנאי, או הוסיפו עוד אנשי צוות לעבודה." : "Drag a job to a technician, or add more team members to the job."}</p></div><form><input type="date" name="date" defaultValue={date} aria-label={he ? "תאריך" : "Date"} /><button>{he ? "מעבר" : "Go"}</button></form></header>
    {notice && <div className="dispatch-notice">{notice}</div>}
    <div className={`dispatch-board ${pending ? "is-saving" : ""}`}>
      {columns.map((column) => {
        const rows = jobs.filter((job) => (job.assigned_to ?? "") === column.id);
        return <section key={column.id || "unassigned"} className="dispatch-column" onDragOver={(event) => event.preventDefault()} onDrop={(event) => move(event.dataTransfer.getData("text/job-id"), column.id || null)}>
          <header><div className="dispatch-avatar">{column.id ? column.full_name.slice(0,1).toUpperCase() : "?"}</div><strong>{column.full_name || (he ? "ללא שם" : "Unnamed")}</strong><b>{rows.length}</b></header>
          <div className="dispatch-stack">{rows.map((job) => {
            const extra = assignments.filter((row) => row.job_id === job.id && row.profile_id && row.profile_id !== job.assigned_to);
            return <article key={job.id} className="dispatch-card" draggable onDragStart={(event) => event.dataTransfer.setData("text/job-id", job.id)}>
              <div className="dispatch-time">{(job.start_time ?? "").slice(0,5) || "—"}<small>{job.end_date && job.end_date !== job.scheduled_date ? (he ? "מספר ימים" : "Multi-day") : job.status.replaceAll("_", " ")}</small></div>
              <Link href={`/jobs/${job.id}`}><strong>{job.service}</strong><p>{job.customers?.name || (he ? "לקוח" : "Customer")}{job.job_city ? ` · ${job.job_city}` : ""}</p></Link>
              {extra.length > 0 && <div className="dispatch-assignees">{extra.map((row) => <button type="button" key={row.profile_id!} onClick={() => remove(job.id, row.profile_id!)} title={he ? "הסרה" : "Remove"}>{techs.find((tech) => tech.id === row.profile_id)?.full_name || "?"} ×</button>)}</div>}
              <select value="" onChange={(event) => add(job.id, event.target.value)} aria-label={he ? "הוספת טכנאי" : "Add technician"}><option value="">{he ? "+ הוספת טכנאי" : "+ Add technician"}</option>{techs.filter((tech) => tech.id !== job.assigned_to && !extra.some((row) => row.profile_id === tech.id)).map((tech) => <option key={tech.id} value={tech.id}>{tech.full_name}</option>)}</select>
            </article>;
          })}{rows.length === 0 && <div className="dispatch-dropzone">{he ? "אפשר לגרור לכאן עבודה" : "Drop a job here"}</div>}</div>
        </section>;
      })}
    </div>
  </div>;
}
