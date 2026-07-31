import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildBookingSlots, type BookingHours } from "@/lib/booking";
// @ts-ignore — proven both ways in tests/rate-limit.test.mjs
import { consume, clientKey } from "@/lib/core/rate-limit.mjs";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? "";
  const serviceId = url.searchParams.get("service") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !serviceId) return NextResponse.json({ slots: [] }, { status: 400 });

  // Unauthenticated, service-role, and four queries per call. Anyone with the
  // organisation UUID (it is in the public /book/<org> URL) could enumerate the
  // business's whole calendar day by day. Keyed per caller so a real customer
  // clicking through dates is unaffected.
  const limit = consume(`booking:slots:${clientKey(request.headers)}:${org}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ slots: [], error: "rate_limited" }, {
      status: 429,
      headers: { "retry-after": String(limit.retryAfterSeconds) },
    });
  }

  try {
    const admin = createAdminClient();
    const [{ data: settings }, { data: service }, { data: jobs }, { count: capacity }] = await Promise.all([
      admin.from("booking_settings").select("enabled,hours_json,slot_interval_min,arrival_window_min,min_notice_hours,max_days_ahead,use_team_capacity,timezone").eq("organization_id",org).single(),
      admin.from("booking_services").select("id,duration_min").eq("organization_id",org).eq("id",serviceId).eq("active",true).single(),
      admin.from("jobs").select("start_time,end_time").eq("organization_id",org).eq("scheduled_date",date).is("deleted_at",null).neq("status","cancelled"),
      admin.from("profiles").select("id",{count:"exact",head:true}).eq("organization_id",org).eq("active",true).in("role",["owner","tech"]),
    ]);
    if (!settings?.enabled || !service) return NextResponse.json({ slots: [] }, { status: 404 });
    // timezone drives the day boundary and the minimum-notice cutoff. Without it
    // the maths runs in the SERVER's zone (UTC on Vercel) and offers slots that
    // have already passed for the business. See db/029_booking_timezone.sql.
    const slots = buildBookingSlots({ date, hours: settings.hours_json as BookingHours, intervalMin: settings.slot_interval_min, durationMin: service.duration_min, arrivalWindowMin: settings.arrival_window_min, minNoticeHours: settings.min_notice_hours, maxDaysAhead: settings.max_days_ahead, capacity: settings.use_team_capacity ? Math.max(1,capacity ?? 1) : 1, busy: (jobs ?? []).map((row)=>({start:row.start_time,end:row.end_time})), timeZone: settings.timezone });
    return NextResponse.json({ slots }, { headers: { "cache-control":"no-store" } });
  } catch { return NextResponse.json({ slots: [] }, { status: 503 }); }
}
