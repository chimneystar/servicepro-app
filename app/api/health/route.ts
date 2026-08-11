import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
// @ts-ignore — proven both ways in tests/rate-limit.test.mjs
import { consume, clientKey } from "@/lib/core/rate-limit.mjs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Unauthenticated, and it runs a service-role query per hit — a free,
  // unthrottled database liveness and latency oracle.
  const limit = consume(`health:${clientKey(request.headers)}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { status: "rate_limited" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }
  const startedAt = performance.now();
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("organizations").select("id").limit(1);
    if (error) throw error;
    return NextResponse.json(
      { status: "ok", database: "available", latencyMs: Math.round(performance.now() - startedAt) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "degraded", database: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
