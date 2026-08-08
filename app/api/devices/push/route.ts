import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pushDelivery } from "@/lib/push";

/**
 * Enrolment used to end here: the subscription was stored and nothing was ever
 * sent to it, with nothing anywhere saying so. Every response now carries the
 * delivery status, so a device that can never receive a notification is told
 * that at the moment it enrols instead of waiting silently for ever.
 */
function deliveryPayload(locale: "en" | "he") {
  const delivery = pushDelivery(locale);
  return {
    delivery: delivery.available ? "ready" : "unavailable",
    deliveryReason: delivery.reason,
    deliveryMessage: delivery.message,
  };
}

/** Lets the workspace show delivery state without enrolling first. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...deliveryPayload("en") });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.organization_id)
    return NextResponse.json({ ok: false, reason: "profile missing" }, { status: 403 });
  let body: {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
    deviceName?: unknown;
    locale?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid json" }, { status: 400 });
  }
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body.keys?.auth === "string" ? body.keys.auth : "";
  if (!endpoint.startsWith("https://") || !p256dh || !auth)
    return NextResponse.json({ ok: false, reason: "invalid subscription" }, { status: 400 });
  const { error } = await supabase.from("device_subscriptions").upsert(
    {
      organization_id: profile.organization_id,
      profile_id: user.id,
      endpoint: endpoint.slice(0, 2000),
      p256dh: p256dh.slice(0, 500),
      auth_secret: auth.slice(0, 500),
      device_name: typeof body.deviceName === "string" ? body.deviceName.slice(0, 120) : null,
      locale: body.locale === "he" ? "he" : "en",
      enabled: true,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "profile_id,endpoint" },
  );
  if (error) return NextResponse.json({ ok: false, reason: "save failed" }, { status: 503 });
  return NextResponse.json({ ok: true, ...deliveryPayload(body.locale === "he" ? "he" : "en") });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const endpoint = request.nextUrl.searchParams.get("endpoint");
  if (!endpoint) return NextResponse.json({ ok: false }, { status: 400 });
  await supabase
    .from("device_subscriptions")
    .update({ enabled: false })
    .eq("profile_id", user.id)
    .eq("endpoint", endpoint);
  return NextResponse.json({ ok: true });
}
