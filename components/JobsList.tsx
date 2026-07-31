"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

export type JobRow = {
  id: string; service: string; stage: string; tags: string[]; price_minor: number;
  scheduled_date: string; start_time: string | null; stage_changed_at: string;
  customer: string; address: string; tech: string | null;
};
export type StageDef = { name: string; color: string; is_done: boolean; is_cancelled: boolean };

const SYM: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };

export default function JobsList({ jobs, stages, currency, nowMs, truncated = false, loadedCount = 0, totalCount = 0, loadMoreHref = null }: {
  jobs: JobRow[]; stages: StageDef[]; currency: string; nowMs: number;
  /** Set when the server capped the query — the tab counts below describe the
   *  loaded page, not the whole business, and saying so is the whole point. */
  truncated?: boolean; loadedCount?: number; totalCount?: number; loadMoreHref?: string | null;
}) {
  const he = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const cur = SYM[currency] ?? "$";
  const now = nowMs; // provided by the server so SSR and hydration agree
  const colorOf = (s: string) => stages.find((x) => x.name === s)?.color ?? "#57606f";
  const allTags = useMemo(() => Array.from(new Set(jobs.flatMap((j) => j.tags ?? []))).sort(), [jobs]);
  const count = (name: string) => jobs.filter((j) => j.stage === name).length;

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return jobs.filter((j) => {
      if (tab !== "all" && j.stage !== tab) return false;
      if (tag && !(j.tags ?? []).includes(tag)) return false;
      if (s && ![j.customer, j.service, j.address, ...(j.tags ?? [])].some((f) => (f ?? "").toLowerCase().includes(s))) return false;
      return true;
    });
  }, [jobs, tab, tag, q]);

  const daysIn = (iso: string) => Math.floor((now - new Date(iso).getTime()) / 864e5);
  const fmt = (d: string, t: string | null) => { const x = new Date(d + "T00:00:00"); return `${x.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}${t ? " · " + t.slice(0, 5) : ""}`; };

  return (
    <div>
      {truncated && (
        <div role="status" style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", borderRadius: 12, padding: "10px 14px", fontSize: "0.8125rem", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>Showing the {loadedCount} most recent of {totalCount} jobs. The counts and search below cover only these.</span>
          {loadMoreHref && <Link href={loadMoreHref} style={{ color: "#9a3412", fontWeight: 800, whiteSpace: "nowrap" }}>Load more →</Link>}
        </div>
      )}

      {/* Status tabs */}
      <div className="scroll-x" style={{ display: "flex", gap: 6, borderBottom: "1px solid #e2e8f0", marginBottom: 12, paddingBottom: 2 }}>
        <TabBtn label="All" n={jobs.length} on={tab === "all"} onClick={() => setTab("all")} color="#0b1524" />
        {stages.map((s) => <TabBtn key={s.name} label={s.name} n={count(s.name)} on={tab === s.name} onClick={() => setTab(s.name)} color={s.color} />)}
      </div>

      {/* Search + tag filter */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} aria-hidden="true">🔍</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client, service, address, tag…" aria-label="Search client, service, address, tag…" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 12, padding: "11px 12px 11px 38px", fontSize: "1rem", outline: "none" }} />
        </div>
        {allTags.length > 0 && (
          <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label={he ? "סינון לפי תגית" : "Filter by tag"} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "11px 12px", fontSize: "0.875rem", background: "#fff", fontWeight: 600 }}>
            <option value="">All tags</option>
            {allTags.map((t) => <option key={t} value={t}>🏷 {t}</option>)}
          </select>
        )}
      </div>
      <div style={{ fontSize: "0.8125rem", color: "#5c6675", margin: "0 2px 8px" }}>{shown.length} job{shown.length === 1 ? "" : "s"}</div>

      {/* Rows */}
      <div className="rlist">
        {shown.map((j) => {
          const st = stages.find((x) => x.name === j.stage);
          const d = daysIn(j.stage_changed_at);
          const stale = d > 14 && !st?.is_done && !st?.is_cancelled;
          return (
            <Link className="ritem" href={`/jobs/${j.id}`} key={j.id} style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
              <div className="rmain">
                <div className="rtitle">{j.customer} · {j.service}</div>
                <div className="rsub">{fmt(j.scheduled_date, j.start_time)}{j.tech ? ` · ${j.tech}` : ""}{j.address ? ` · ${j.address}` : ""}</div>
                {(j.tags ?? []).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                    {j.tags.map((t) => <span key={t} className="pill" style={{ background: "#eef2f8", color: "#5c6675", fontSize: "0.8125rem" }}>{t}</span>)}
                  </div>
                )}
              </div>
              <div className="rend">
                <span className="pill" style={{ background: colorOf(j.stage) + "22", color: colorOf(j.stage) }}>{j.stage}</span>
                <b style={{ fontSize: "0.875rem" }}>{cur}{(j.price_minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
                <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: stale ? "#dc2626" : "#94a3b8", background: stale ? "#fdeaea" : "transparent", padding: stale ? "2px 6px" : 0, borderRadius: 6 }}>{d}d in status</span>
              </div>
            </Link>
          );
        })}
        {shown.length === 0 && <div className="rempty">No jobs match. Try a different status, tag, or search.</div>}
      </div>
    </div>
  );
}

function TabBtn({ label, n, on, onClick, color }: { label: string; n: number; on: boolean; onClick: () => void; color: string }) {
  return (
    <button type="button" onClick={onClick} style={{ border: "none", background: "transparent", padding: "8px 12px 10px", cursor: "pointer", whiteSpace: "nowrap", fontSize: "0.875rem", fontWeight: 700, color: on ? color : "#5c6675", borderBottom: on ? `3px solid ${color}` : "3px solid transparent", marginBottom: -3 }}>
      {label} <span style={{ background: on ? color : "#eef2f8", color: on ? "#fff" : "#8892a2", borderRadius: 20, padding: "1px 7px", fontSize: "0.8125rem", marginInlineStart: 3 }}>{n}</span>
    </button>
  );
}
