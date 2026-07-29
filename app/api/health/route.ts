import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = performance.now();
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("organizations").select("id").limit(1);
    if (error) throw error;
    return NextResponse.json({ status: "ok", database: "available", latencyMs: Math.round(performance.now() - startedAt) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "degraded", database: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
