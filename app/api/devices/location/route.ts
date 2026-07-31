import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function identity() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .maybeSingle();
  return profile?.organization_id
    ? { supabase, user, organizationId: profile.organization_id }
    : null;
}

export async function POST(request: NextRequest) {
  const ctx = await identity();
  if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });
  let body: { latitude?: unknown; longitude?: unknown; accuracy?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const accuracy = Number(body.accuracy);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  )
    return NextResponse.json({ ok: false }, { status: 400 });
  await ctx.supabase.from("technician_location_consents").upsert(
    {
      profile_id: ctx.user.id,
      organization_id: ctx.organizationId,
      consented: true,
      consented_at: new Date().toISOString(),
      revoked_at: null,
    },
    { onConflict: "profile_id" },
  );
  const { error } = await ctx.supabase.from("technician_locations").insert({
    organization_id: ctx.organizationId,
    profile_id: ctx.user.id,
    latitude,
    longitude,
    accuracy_m: Number.isFinite(accuracy) ? Math.max(0, accuracy) : null,
  });
  return NextResponse.json({ ok: !error }, { status: error ? 503 : 200 });
}

export async function DELETE() {
  const ctx = await identity();
  if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });
  const { error } = await ctx.supabase.from("technician_location_consents").upsert(
    {
      profile_id: ctx.user.id,
      organization_id: ctx.organizationId,
      consented: false,
      revoked_at: new Date().toISOString(),
    },
    { onConflict: "profile_id" },
  );
  return NextResponse.json({ ok: !error });
}
