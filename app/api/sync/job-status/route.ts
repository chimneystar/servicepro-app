import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Event = { clientEventId?: unknown; jobId?: unknown; action?: unknown; createdAt?: unknown };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("organization_id,role").eq("id", user.id).maybeSingle(); if (!profile?.organization_id) return NextResponse.json({ ok: false }, { status: 403 });
  let body: { events?: Event[] }; try { body = await request.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const events = Array.isArray(body.events) ? body.events.slice(0,100) : []; const processed: string[] = [];
  for (const event of events) {
    const clientEventId = typeof event.clientEventId === "string" ? event.clientEventId : ""; const jobId = typeof event.jobId === "string" ? event.jobId : ""; const action = event.action === "start" || event.action === "complete" ? event.action : null;
    if (!uuid.test(clientEventId) || !uuid.test(jobId) || !action) continue;
    const { data: prior } = await supabase.from("sync_outbox_receipts").select("id").eq("profile_id", user.id).eq("client_event_id", clientEventId).maybeSingle(); if (prior) { processed.push(clientEventId); continue; }
    const { data: job } = await supabase.from("jobs").select("id,assigned_to").eq("id", jobId).eq("organization_id", profile.organization_id).maybeSingle();
    if (!job || (profile.role === "tech" && job.assigned_to !== user.id)) continue;
    const now = new Date().toISOString(); const values = action === "start" ? { status: "in_progress", stage: "In Progress", started_at: now } : { status: "done", stage: "Completed", completed_at: now };
    const { error } = await supabase.from("jobs").update(values).eq("id", jobId); if (error) continue;
    const { error: receiptError } = await supabase.from("sync_outbox_receipts").insert({ organization_id: profile.organization_id, profile_id: user.id, client_event_id: clientEventId, job_id: jobId, action_type: action });
    if (!receiptError || receiptError.code === "23505") processed.push(clientEventId);
  }
  return NextResponse.json({ ok: true, processed });
}
