import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { appUrl } from "@/lib/providers";
import ActionForm from "@/components/ActionForm";
import FeedRow, { type Feed } from "./FeedRow";
import { createCalendarFeed } from "./actions";
// @ts-ignore -- shared JS module, proven both ways in tests/calendar-feed.test.mjs
import {
  CALENDAR_TOKEN_TTL_DAYS, CALENDAR_WINDOW_FUTURE_DAYS, CALENDAR_WINDOW_PAST_DAYS, ORG_SCOPE_ROLES,
} from "@/lib/core/calendar.mjs";

/**
 * Calendar subscriptions (ledger 6c.7).
 *
 * Owners and technicians live in Google Calendar and this product exported
 * nothing. This screen mints, rotates and revokes the feed URLs — and says, in
 * words, that the URL is a credential, because a subscribable link that needs
 * no password is exactly that.
 *
 * A technician reaches this page too (unlike the rest of /reports) because a
 * technician's own schedule is the main thing worth subscribing to. They can
 * only ever create a `mine` feed.
 */
export const dynamic = "force-dynamic";

export default async function CalendarFeedPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: feeds } = await supabase.from("calendar_feed_tokens")
    .select("id, token, label, scope, expires_at, last_accessed_at, created_at")
    .is("revoked_at", null).order("created_at", { ascending: false });

  const origin = appUrl().replace(/\/$/, "");
  const canOrgScope = ORG_SCOPE_ROLES.includes(profile.role);
  // Server request time, captured once. Expiry is decided at LOOKUP by
  // `calendarFeedAccess`; this is only how the list is grouped and labelled.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const daysLeft = (feed: Feed) => Math.ceil((new Date(feed.expires_at).getTime() - nowMs) / 86400000);
  const live = (feeds ?? []).filter((f: Feed) => new Date(f.expires_at).getTime() > nowMs);
  const expired = (feeds ?? []).filter((f: Feed) => new Date(f.expires_at).getTime() <= nowMs);

  return (
    <div style={{ maxWidth: 760 }}>
      <Link href="/reports" style={back}>‹ Reports</Link>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: "8px 0 4px" }}>Calendar subscriptions</h1>
      <p style={{ color: "#5c6675", fontSize: "0.8125rem", marginBottom: 14 }}>
        Subscribe to your schedule from Google Calendar, Apple Calendar or Outlook. Paste the URL into
        &ldquo;Add calendar → From URL&rdquo;.
      </p>

      <div style={{ background: "#fff7ed", border: "1px solid #fcd9a8", color: "#9a3412", borderRadius: 12, padding: "12px 14px", fontSize: "0.8125rem", marginBottom: 16 }}>
        <b>Treat this URL as a password.</b> Anyone who has it can read the schedule it covers, with no login,
        until it expires or you revoke it. It expires automatically after <b>{CALENDAR_TOKEN_TTL_DAYS} days</b> —
        rotate it to get a new one. The feed carries the service, the time, the customer&rsquo;s name and the
        address only: <b>no prices, no notes, and no payment links</b>, and it covers{" "}
        {CALENDAR_WINDOW_PAST_DAYS} days back to {CALENDAR_WINDOW_FUTURE_DAYS} days ahead.
      </div>

      {!origin && (
        <div role="alert" style={{ background: "#fdeaea", border: "1px solid #f5b5b5", color: "#b91c1c", borderRadius: 12, padding: "11px 14px", fontSize: "0.8125rem", marginBottom: 16 }}>
          NEXT_PUBLIC_APP_URL is not configured, so the full feed URL cannot be shown. Set it and reload.
        </div>
      )}

      <ActionForm action={createCalendarFeed} successLabel="Calendar feed created" className="ops-form">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
          <input name="label" placeholder="Name this feed (optional)" aria-label="Name this feed (optional)" maxLength={80} style={input} />
          <select name="scope" defaultValue="mine" style={input} aria-label="What this feed covers">
            <option value="mine">My jobs only</option>
            {canOrgScope && <option value="organization">The whole schedule</option>}
          </select>
          <button type="submit" style={primary}>+ Create feed</button>
        </div>
      </ActionForm>

      {!canOrgScope && (
        <p style={{ fontSize: "0.8125rem", color: "#5c6675", marginBottom: 14 }}>
          Technicians can subscribe to their own jobs. A whole-schedule feed would put every customer address in
          the business behind one long-lived URL, so it is offered to owners and office members only.
        </p>
      )}

      <h3 style={h3}>Live feeds ({live.length})</h3>
      {live.map((feed: Feed) => <FeedRow key={feed.id} feed={feed} origin={origin} daysLeft={daysLeft(feed)} />)}
      {live.length === 0 && <div className="rempty">No calendar feeds yet.</div>}

      {expired.length > 0 && (
        <>
          <h3 style={h3}>Expired ({expired.length})</h3>
          <p style={{ fontSize: "0.8125rem", color: "#5c6675" }}>
            These have aged out and no longer serve anything. Rotate one to get a working URL again.
          </p>
          {expired.map((feed: Feed) => <FeedRow key={feed.id} feed={feed} origin={origin} daysLeft={daysLeft(feed)} />)}
        </>
      )}
    </div>
  );
}

const back: React.CSSProperties = { color: "#2563eb", fontWeight: 700, fontSize: "0.875rem", textDecoration: "none" };
const h3: React.CSSProperties = { fontSize: "1rem", fontWeight: 800, margin: "18px 0 8px" };
const input: React.CSSProperties = { border: "1px solid #d7dee9", borderRadius: 9, padding: "9px 11px", fontSize: "0.875rem", minWidth: 180 };
const primary: React.CSSProperties = { background: "#2563eb", color: "#fff", border: "none", borderRadius: 9, padding: "9px 16px", fontWeight: 700, fontSize: "0.875rem", cursor: "pointer" };
