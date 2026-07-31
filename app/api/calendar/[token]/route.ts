import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
// @ts-ignore -- shared JS module, proven both ways in tests/calendar-feed.test.mjs
import {
  CALENDAR_MAX_EVENTS, buildCalendar, calendarFeedAccess, calendarWindow, redactEvent,
} from "@/lib/core/calendar.mjs";
// @ts-ignore -- shared JS module
import { clientKey, consume } from "@/lib/core/rate-limit.mjs";

/**
 * Subscribable iCal feed (ledger 6c.7).
 *
 * THE URL IS A CREDENTIAL. Google Calendar will fetch it hourly, for ever,
 * with no login, from an IP nobody controls. It is therefore bounded by the
 * rules migration 023 §10 settled on for portal links after those turned out to
 * be permanent and irrevocable:
 *
 *   * The token is evaluated on EVERY request by `calendarFeedAccess`, which
 *     checks revocation FIRST, then expiry, then scope. Nothing is cached and
 *     the response is `no-store`, so revoking a feed stops it immediately.
 *   * The query selects only the columns a calendar needs. No price, no notes,
 *     no customer phone or email, and no `public_token` — which is what makes a
 *     leaked feed URL a schedule disclosure and not a payment link.
 *   * Scope `mine` is filtered to the holder's own jobs, in SQL, not in the
 *     renderer. `organization` is only ever issued to an owner or office
 *     member (enforced by the app AND by a database trigger).
 *   * The window is bounded to −90/+365 days and the event count is capped, so
 *     a feed can never become a full export of the business.
 *
 * A refusal always answers 404 with no body. Distinguishing "expired" from
 * "never existed" to an anonymous caller would turn this endpoint into a token
 * oracle.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DENY = () => new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  // A feed URL is guessable only by brute force; make brute force expensive.
  // Generous, because a legitimate subscriber polls hourly from one address
  // while several teammates may share an office IP.
  const limit = consume(`calendar:${clientKey(request.headers)}`, 60, 60_000) as { allowed: boolean; retryAfterSeconds: number };
  if (!limit.allowed) {
    return new NextResponse(null, {
      status: 429,
      headers: { "Cache-Control": "no-store", "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(token ?? ""))) return DENY();

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    console.error("[calendar] feed unavailable: no service role key is configured");
    return new NextResponse(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const { data: feed } = await admin.from("calendar_feed_tokens")
    .select("id, organization_id, profile_id, scope, expires_at, revoked_at, label")
    .eq("token", token).maybeSingle();

  const access = calendarFeedAccess(feed, new Date().toISOString()) as
    | { ok: true; scope: string; organizationId: string; profileId: string | null }
    | { ok: false; reason: string };
  if (!access.ok) {
    // Logged server-side with the real reason; the caller is told nothing.
    console.warn(`[calendar] feed refused (${access.reason})`);
    return DENY();
  }

  const window = calendarWindow(new Date().toISOString().slice(0, 10)) as { start: string; end: string };

  // ONLY these columns. Adding `price_minor`, `notes` or `public_token` here
  // would put them in a passwordless URL; tests/calendar-feed.test.mjs asserts
  // this select does not.
  let query = admin.from("jobs")
    .select("id, service, status, scheduled_date, end_date, start_time, end_time, job_address, job_city, updated_at, customers(name)")
    .eq("organization_id", access.organizationId)
    .is("deleted_at", null)
    .gte("scheduled_date", window.start)
    .lte("scheduled_date", window.end)
    .order("scheduled_date", { ascending: true })
    .limit(CALENDAR_MAX_EVENTS);

  if (access.scope === "mine") query = query.eq("assigned_to", access.profileId);

  const { data: jobs, error } = await query;
  if (error) {
    console.error(`[calendar] feed query failed: ${error.message}`);
    return new NextResponse(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const { data: org } = await admin.from("organizations").select("name").eq("id", access.organizationId).maybeSingle();
  const origin = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");

  const body = buildCalendar({
    events: (jobs ?? []).map((job) => redactEvent(job)),
    name: access.scope === "mine" ? `${org?.name ?? "ServicePro"} — my schedule` : `${org?.name ?? "ServicePro"} — schedule`,
    origin,
    stampISO: new Date().toISOString(),
  }) as string;

  // Best-effort access trail. A feed nobody has fetched for months is a feed an
  // owner can revoke with confidence, and a spike is visible.
  const { error: touchError } = await admin.from("calendar_feed_tokens")
    .update({ last_accessed_at: new Date().toISOString() })
    .eq("id", (feed as { id: string }).id);
  if (touchError) console.warn(`[calendar] could not record feed access: ${touchError.message}`);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="servicepro.ics"',
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
