"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
// @ts-ignore — pure date-window arithmetic, unit-tested by node:test.
import { visibleRange, covers } from "@/lib/core/query-window.mjs";

export type CalJob = {
  id: string;
  title: string;
  service: string;
  status: string;
  date: string;
  start: string | null;
  end: string | null;
  tech: string;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const HE_MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];
const He = { Sun: "א", Mon: "ב", Tue: "ג", Wed: "ד", Thu: "ה", Fri: "ו", Sat: "ש" } as Record<
  string,
  string
>;
const START_H = 7,
  END_H = 20,
  HOUR = 46;

function statusColor(s: string): [string, string] {
  const m: Record<string, string> = {
    scheduled: "#2563eb|#fff",
    in_progress: "#b45309|#fff",
    done: "#15803d|#fff",
    cancelled: "#94a3b8|#fff",
  };
  return (m[s] ?? "#2563eb|#fff").split("|") as [string, string];
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfWeek = (d: Date) => addDays(d, -d.getDay());
const minutes = (hhmm: string | null) => {
  if (!hhmm) return START_H * 60;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export default function Calendar({
  jobs,
  he = false,
  typeColors = {},
  rangeFrom = "",
  rangeTo = "",
  truncated = false,
}: {
  jobs: CalJob[];
  he?: boolean;
  typeColors?: Record<string, string>;
  /** The date window /schedule actually loaded. Empty means "unbounded". */
  rangeFrom?: string;
  rangeTo?: string;
  truncated?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"day" | "week" | "month">("week");
  // Initialize date-dependent state AFTER mount so server HTML (which has no
  // "now") and the client agree — avoids hydration mismatch (#418/#423).
  const [cursor, setCursor] = useState<Date | null>(null);
  const [today, setToday] = useState("");
  /* eslint-disable react-hooks/set-state-in-effect --
     client time and viewport are intentionally initialized after hydration */
  useEffect(() => {
    setCursor(new Date());
    setToday(iso(new Date()));
    if (typeof window !== "undefined" && window.innerWidth < 700) setView("day");
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // The page no longer ships every job in the organisation, so paging out of
  // the loaded window has to fetch the next one. Without this the user would
  // page into an empty-looking month and believe the work had vanished.
  //
  // fetchWindow() pads a whole month either side of the anchor, and
  // tests/query-window.test.mjs proves exhaustively that it contains every
  // visibleRange() for that anchor — so this cannot loop.
  const needed = cursor ? visibleRange(iso(cursor), view) : null;
  const loaded = rangeFrom && rangeTo ? { from: rangeFrom, to: rangeTo } : null;
  const outOfRange = !!(needed && loaded && !covers(loaded, needed));
  useEffect(() => {
    if (!outOfRange || !cursor) return;
    router.replace(`/schedule?anchor=${iso(cursor)}`, { scroll: false });
  }, [outOfRange, cursor, router]);

  if (!cursor) {
    return (
      <div
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 14,
          boxShadow: "0 6px 18px rgba(15,42,94,.06)",
          padding: 24,
        }}
      >
        <div className="skeleton" style={{ height: 44, marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 260 }} />
      </div>
    );
  }

  const move = (dir: number) => {
    const d = new Date(cursor);
    if (view === "day") d.setDate(d.getDate() + dir);
    else if (view === "week") d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setCursor(d);
  };

  const months = he ? HE_MONTHS : MONTHS;
  const label =
    view === "month"
      ? `${months[cursor.getMonth()]} ${cursor.getFullYear()}`
      : view === "day"
        ? `${he ? He[DAYS[cursor.getDay()]] : DAYS[cursor.getDay()]} ${cursor.getDate()} ${months[cursor.getMonth()]}`
        : (() => {
            const s = startOfWeek(cursor);
            const e = addDays(s, 6);
            return `${s.getDate()} ${months[s.getMonth()].slice(0, 3)} – ${e.getDate()} ${months[e.getMonth()].slice(0, 3)} ${e.getFullYear()}`;
          })();

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 14,
        boxShadow: "0 6px 18px rgba(15,42,94,.06)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid #eef1f6",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" onClick={() => setCursor(new Date())} style={btnGhost}>
            {he ? "היום" : "Today"}
          </button>
          <button
            type="button"
            onClick={() => move(-1)}
            aria-label={he ? "הקודם" : "Previous"}
            style={navBtn}
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            aria-label={he ? "הבא" : "Next"}
            style={navBtn}
          >
            ›
          </button>
          <b style={{ fontSize: "1rem", marginInlineStart: 6 }}>{label}</b>
        </div>
        <div style={{ display: "flex", background: "#eef2f8", borderRadius: 10, padding: 3 }}>
          {(["day", "week", "month"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={{ ...seg, ...(view === v ? segOn : {}) }}
            >
              {he ? { day: "יום", week: "שבוע", month: "חודש" }[v] : cap(v)}
            </button>
          ))}
        </div>
      </div>

      {outOfRange && (
        <div style={notice}>{he ? "טוענים את התקופה הזאת…" : "Loading this period…"}</div>
      )}
      {truncated && !outOfRange && (
        <div style={{ ...notice, background: "#fff7ed", borderColor: "#fed7aa", color: "#9a3412" }}>
          {he
            ? "יש כאן יותר עבודות ממה שאפשר להציג בבת אחת. אפשר לעבור לתצוגת שבוע או יום כדי לראות הכול."
            : "This period has more jobs than can be shown at once. Switch to the week or day view to see them all."}
        </div>
      )}
      <div className="scroll-x">
        {view === "month" ? (
          <MonthView cursor={cursor} jobs={jobs} today={today} he={he} typeColors={typeColors} />
        ) : (
          <TimeGrid
            cursor={cursor}
            jobs={jobs}
            today={today}
            he={he}
            days={view === "day" ? 1 : 7}
            typeColors={typeColors}
          />
        )}
      </div>
    </div>
  );
}

function TimeGrid({
  cursor,
  jobs,
  today,
  days,
  he,
  typeColors = {},
}: {
  cursor: Date;
  jobs: CalJob[];
  today: string;
  days: number;
  he: boolean;
  typeColors?: Record<string, string>;
}) {
  const first = days === 1 ? new Date(cursor) : startOfWeek(cursor);
  const cols = Array.from({ length: days }, (_, i) => addDays(first, i));
  const hours = Array.from({ length: END_H - START_H }, (_, i) => START_H + i);

  return (
    <div style={{ minWidth: days === 7 ? 680 : undefined }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `56px repeat(${days},1fr)`,
          borderBottom: "1px solid #eef1f6",
        }}
      >
        <div />
        {cols.map((d) => {
          const isToday = iso(d) === today;
          return (
            <div
              key={iso(d)}
              style={{
                textAlign: "center",
                padding: "8px 0",
                borderInlineStart: "1px solid #eef1f6",
              }}
            >
              <div style={{ fontSize: "0.875rem", color: "#5c6675", fontWeight: 700 }}>
                {he ? He[DAYS[d.getDay()]] : DAYS[d.getDay()]}
              </div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  fontWeight: 800,
                  fontSize: "0.9375rem",
                  marginTop: 2,
                  background: isToday ? "#2563eb" : "transparent",
                  color: isToday ? "#fff" : "#0b1524",
                }}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `56px repeat(${days},1fr)`,
          maxHeight: 560,
          overflowY: "auto",
          position: "relative",
        }}
      >
        <div>
          {hours.map((h) => (
            <div
              key={h}
              style={{
                height: HOUR,
                fontSize: "0.875rem",
                color: "#5c6675",
                textAlign: "end",
                paddingInlineEnd: 6,
                paddingTop: 2,
              }}
            >
              {fmtHour(h, he)}
            </div>
          ))}
        </div>
        {cols.map((d) => {
          const dayJobs = jobs.filter((j) => j.date === iso(d));
          return (
            <div
              key={iso(d)}
              style={{ position: "relative", borderInlineStart: "1px solid #eef1f6" }}
            >
              {hours.map((h) => (
                <div key={h} style={{ height: HOUR, borderTop: "1px solid #f1f4f9" }} />
              ))}
              {dayJobs.map((j) => {
                const top = ((minutes(j.start) - START_H * 60) / 60) * HOUR;
                const dur = Math.max(30, minutes(j.end) - minutes(j.start) || 60);
                const h = (dur / 60) * HOUR;
                const bg = typeColors[j.service] || statusColor(j.status)[0];
                return (
                  <a
                    key={j.id}
                    href={`/jobs/${j.id}`}
                    title={`${j.title} · ${j.service}`}
                    style={{
                      position: "absolute",
                      top: Math.max(0, top),
                      left: 3,
                      right: 3,
                      height: Math.max(24, h - 3),
                      background: bg,
                      color: "#fff",
                      borderRadius: 7,
                      padding: "4px 7px",
                      fontSize: "0.875rem",
                      overflow: "hidden",
                      boxShadow: "0 2px 6px rgba(0,0,0,.15)",
                      textDecoration: "none",
                      display: "block",
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>
                      {(j.start ?? "").slice(0, 5)} {j.title}
                    </div>
                    <div style={{ opacity: 0.9 }}>
                      {j.service}
                      {j.tech ? " · " + j.tech : ""}
                    </div>
                  </a>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthView({
  cursor,
  jobs,
  today,
  he,
  typeColors = {},
}: {
  cursor: Date;
  jobs: CalJob[];
  today: string;
  he: boolean;
  typeColors?: Record<string, string>;
}) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  return (
    <div style={{ minWidth: 620 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7,1fr)",
          borderBottom: "1px solid #eef1f6",
        }}
      >
        {DAYS.map((d) => (
          <div
            key={d}
            style={{
              textAlign: "center",
              padding: "8px 0",
              fontSize: "0.875rem",
              fontWeight: 700,
              color: "#5c6675",
            }}
          >
            {he ? He[d] : d}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
        {cells.map((d) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const dayJobs = jobs.filter((j) => j.date === iso(d));
          const isToday = iso(d) === today;
          return (
            <div
              key={iso(d)}
              style={{
                minHeight: 92,
                borderInlineStart: "1px solid #f1f4f9",
                borderTop: "1px solid #f1f4f9",
                padding: 5,
                background: inMonth ? "#fff" : "#fafbfd",
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  fontSize: "0.875rem",
                  fontWeight: 700,
                  background: isToday ? "#2563eb" : "transparent",
                  color: isToday ? "#fff" : inMonth ? "#0b1524" : "#b6bfcc",
                }}
              >
                {d.getDate()}
              </div>
              {dayJobs.slice(0, 3).map((j) => {
                const bg = typeColors[j.service] || statusColor(j.status)[0];
                return (
                  <a
                    key={j.id}
                    href={`/jobs/${j.id}`}
                    style={{
                      display: "block",
                      marginTop: 3,
                      background: bg,
                      color: "#fff",
                      borderRadius: 5,
                      padding: "2px 6px",
                      fontSize: "0.875rem",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      textDecoration: "none",
                    }}
                  >
                    {(j.start ?? "").slice(0, 5)} {j.title}
                  </a>
                );
              })}
              {dayJobs.length > 3 && (
                <div style={{ fontSize: "0.875rem", color: "#5c6675", marginTop: 2 }}>
                  +{dayJobs.length - 3} {he ? "נוספות" : "more"}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const fmtHour = (h: number, he: boolean) =>
  he
    ? `${String(h).padStart(2, "0")}:00`
    : h === 12
      ? "12 PM"
      : h > 12
        ? `${h - 12} PM`
        : `${h} AM`;
const notice: React.CSSProperties = {
  background: "#eef2f8",
  border: "1px solid #e2e8f0",
  color: "#334155",
  padding: "8px 14px",
  fontSize: "0.875rem",
  fontWeight: 600,
};
const navBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  background: "#fff",
  cursor: "pointer",
  fontSize: "1rem",
  color: "#334155",
};
const btnGhost: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: "0.875rem",
};
const seg: React.CSSProperties = {
  border: "none",
  background: "transparent",
  padding: "6px 14px",
  borderRadius: 8,
  fontWeight: 700,
  fontSize: "0.875rem",
  color: "#5c6675",
  cursor: "pointer",
};
const segOn: React.CSSProperties = {
  background: "#fff",
  color: "#0b1524",
  boxShadow: "0 1px 3px rgba(0,0,0,.12)",
};
