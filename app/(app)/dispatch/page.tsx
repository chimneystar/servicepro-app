import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import DispatchBoard, {
  type DispatchJob,
  type DispatchTech,
  type DispatchAssignment,
} from "@/components/DispatchBoard";
// @ts-ignore -- pure logic, proven both ways in tests/availability.test.mjs
import { dayAvailability } from "@/lib/core/availability.mjs";
// @ts-ignore -- pure logic, proven both ways in tests/skills.test.mjs
import { heldSkillCodes } from "@/lib/core/skills.mjs";
import * as jobsData from "@/lib/data/jobs";
import * as profilesData from "@/lib/data/profiles";
import * as techniciansData from "@/lib/data/technicians";

export const dynamic = "force-dynamic";

export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/tech");
  const locale = await getLocale();
  const requested = (await searchParams).date;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested ?? "")
    ? requested!
    : new Date().toISOString().slice(0, 10);
  const supabase = await createClient();
  const [jobs, techs, assignments, timeOff, skills] = await Promise.all([
    jobsData.listForDispatchDay(supabase, date),
    profilesData.listAssignable(supabase),
    jobsData.listAssignments(supabase),
    // 6c.3 — the board had no idea who was on holiday. Approved rows covering
    // this day only; `profile_id is null` is a business closure.
    techniciansData.listApprovedTimeOffOn(supabase, date),
    // 6c.11 — who is licensed for what, so the dispatcher can see it before
    // trying an assignment the server will refuse.
    techniciansData.listSkills(supabase),
  ]);
  const normalized = jobs.map((job) => ({
    ...job,
    customers: Array.isArray(job.customers) ? (job.customers[0] ?? null) : job.customers,
  }));
  const nameOf = (id: string | null) => techs.find((row) => row.id === id)?.full_name ?? "";
  const day = dayAvailability(timeOff, date) as {
    closedWindows: { allDay: boolean }[];
    awayWindows: { profileId: string; allDay: boolean; start: number; end: number }[];
  };
  const closed = day.closedWindows.length > 0;
  const hhmm = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const requiredToday = Array.from(
    new Set(normalized.flatMap((job) => ((job as any).required_skills ?? []) as string[])),
  );
  const he = locale === "he";

  return (
    <div>
      {(closed || day.awayWindows.length > 0) && (
        <div
          style={{
            background: closed ? "#fdeaea" : "#fff5e0",
            color: closed ? "#dc2626" : "#a15c07",
            border: "1px solid rgba(0,0,0,.06)",
            borderRadius: 12,
            padding: "10px 14px",
            marginBottom: 12,
            fontSize: "0.8125rem",
          }}
        >
          <b>
            {closed
              ? he
                ? "העסק סגור היום."
                : "The business is closed today."
              : he
                ? "לא זמינים היום"
                : "Off today"}
          </b>
          {!closed && (
            <span>
              {" — "}
              {day.awayWindows.map((window, index) => (
                <span key={`${window.profileId}-${index}`}>
                  {index > 0 ? ", " : ""}
                  {nameOf(window.profileId) || (he ? "ללא שם" : "Unnamed")}
                  {window.allDay ? "" : ` (${hhmm(window.start)}–${hhmm(window.end)})`}
                </span>
              ))}
            </span>
          )}
          <div style={{ marginTop: 4, fontSize: "0.75rem" }}>
            {he
              ? "שיבוץ לאדם שאינו זמין יידחה עם ההסבר."
              : "Assigning work to anyone listed here is refused, with the reason."}
          </div>
        </div>
      )}
      {requiredToday.length > 0 && (
        <div
          style={{
            background: "#e0ebff",
            color: "#1d4ed8",
            borderRadius: 12,
            padding: "10px 14px",
            marginBottom: 12,
            fontSize: "0.8125rem",
          }}
        >
          <b>{he ? "הסמכות נדרשות היום" : "Certifications needed today"}:</b>{" "}
          {requiredToday.join(", ")}
          {". "}
          {techs.map((tech) => {
            const held = heldSkillCodes(
              skills.filter((row) => row.profile_id === tech.id),
              date,
            ) as string[];
            const covers = requiredToday.filter((code) => held.includes(code));
            return covers.length ? (
              <span key={tech.id} style={{ marginInlineEnd: 10 }}>
                {tech.full_name}: {covers.join(", ")}
              </span>
            ) : null;
          })}
        </div>
      )}
      <DispatchBoard
        locale={locale}
        date={date}
        jobs={normalized as DispatchJob[]}
        techs={techs as DispatchTech[]}
        assignments={assignments as DispatchAssignment[]}
      />
    </div>
  );
}
