"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revokeCalendarFeed, rotateCalendarFeed } from "./actions";

export type Feed = {
  id: string; token: string; label: string; scope: string;
  expires_at: string; last_accessed_at: string | null; created_at: string;
};

/**
 * One live feed URL.
 *
 * The URL is shown so it can be copied into Google Calendar, and it is labelled
 * as a credential, because it is one: anyone with it reads the schedule until
 * it expires or is revoked.
 */
export default function FeedRow({ feed, origin, daysLeft }: { feed: Feed; origin: string; daysLeft: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `daysLeft` is computed on the server from one captured request time. It is
  // a LABEL only — expiry is decided at lookup by `calendarFeedAccess`, so a
  // stale render can never make a dead token look live to the feed itself.
  const url = `${origin}/api/calendar/${feed.token}`;

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    start(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? "That did not work.");
      else setError(null);
      router.refresh();
    });
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
        <b>{feed.label || (feed.scope === "mine" ? "My schedule" : "Whole schedule")}</b>
        <span style={{ fontSize: 12.5, color: daysLeft <= 14 ? "#b45309" : "#5c6675" }}>
          {daysLeft > 0 ? `expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}` : "expired"}
          {feed.last_accessed_at ? ` · last fetched ${feed.last_accessed_at.slice(0, 10)}` : " · never fetched"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <code style={{ flex: "1 1 260px", background: "#f5f7fb", border: "1px solid #eef1f6", borderRadius: 8, padding: "7px 9px", fontSize: 11.5, overflowX: "auto", whiteSpace: "nowrap" }}>
          {url}
        </code>
        <button
          type="button" style={button}
          onClick={() => { navigator.clipboard?.writeText(url).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
        <button type="button" style={button} disabled={pending} onClick={() => act(() => rotateCalendarFeed(feed.id))}>
          Rotate
        </button>
        <button
          type="button" style={{ ...button, background: "#fdeaea", color: "#b91c1c" }} disabled={pending}
          onClick={() => {
            if (window.confirm("Revoke this feed URL? Any calendar subscribed to it stops updating immediately.")) {
              act(() => revokeCalendarFeed(feed.id));
            }
          }}
        >
          Revoke
        </button>
      </div>

      {error && <div role="alert" style={{ marginTop: 8, color: "#b91c1c", fontSize: 13, fontWeight: 700 }}>{error}</div>}
    </div>
  );
}

const button: React.CSSProperties = {
  background: "#eef2f8", color: "#0b1524", border: "none", borderRadius: 8,
  padding: "7px 11px", fontWeight: 700, fontSize: 12.5, cursor: "pointer",
};
