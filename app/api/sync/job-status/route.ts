import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Event = { clientEventId?: unknown; jobId?: unknown; action?: unknown; createdAt?: unknown };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Offline outbox drain. A technician's queued start/complete actions are replayed
 * here when their device reconnects.
 *
 * Three defects fixed:
 *
 *  1. COMPLETING A JOB LEFT THE CLOCK RUNNING. The job page's completeJob closes
 *     the caller's open job_time_entries; this path only set status and
 *     completed_at. A technician completing from /tech instead of the job page
 *     left an open time entry for ever, and the job page bills an open entry
 *     against the current time on every render — so hours inflated indefinitely
 *     on a finished job.
 *
 *  2. REJECTED EVENTS WERE NEVER DROPPED. Anything failing the ownership check
 *     hit `continue` and never entered `processed`. The client only removes
 *     acknowledged ids, so a permanently-invalid event stayed in localStorage and
 *     was re-sent on every reconnect — a "N updates waiting to sync" badge the
 *     technician could never clear.
 *
 *  3. STAGE NAMES WERE HARDCODED. "In Progress" and "Completed" are
 *     org-configurable via job_statuses. An organisation that renamed its
 *     pipeline got jobs stamped with a stage matching no tab on the jobs list,
 *     so synced jobs vanished from every filter.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("organization_id,role").eq("id", user.id).maybeSingle();
  if (!profile?.organization_id) return NextResponse.json({ ok: false }, { status: 403 });

  let body: { events?: Event[] };
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }

  const events = Array.isArray(body.events) ? body.events.slice(0, 100) : [];

  // `processed` = stored successfully. `rejected` = will NEVER succeed, so the
  // client must discard it instead of retrying for ever. Anything in neither
  // list is a transient failure and is safe to retry.
  const processed: string[] = [];
  const rejected: string[] = [];

  // Stage names are per-organisation; fall back to defaults only if uncustomised.
  const { data: statuses } = await supabase
    .from("job_statuses").select("name,is_done,sort").eq("organization_id", profile.organization_id).order("sort");
  const doneStage = statuses?.find((s) => s.is_done)?.name ?? "Completed";
  const progressStage = statuses?.find((s) => !s.is_done && /progress/i.test(s.name))?.name
    ?? statuses?.find((s) => !s.is_done)?.name
    ?? "In Progress";

  for (const event of events) {
    const clientEventId = typeof event.clientEventId === "string" ? event.clientEventId : "";
    const jobId = typeof event.jobId === "string" ? event.jobId : "";
    const action = event.action === "start" || event.action === "complete" ? event.action : null;

    // No usable id at all — nothing to acknowledge or reject against.
    if (!uuid.test(clientEventId)) continue;
    // Malformed beyond repair: tell the client to drop it.
    if (!uuid.test(jobId) || !action) { rejected.push(clientEventId); continue; }

    const { data: prior } = await supabase.from("sync_outbox_receipts")
      .select("id").eq("profile_id", user.id).eq("client_event_id", clientEventId).maybeSingle();
    if (prior) { processed.push(clientEventId); continue; }

    const { data: job } = await supabase.from("jobs")
      .select("id,assigned_to").eq("id", jobId).eq("organization_id", profile.organization_id).maybeSingle();

    // Not this org's job, or not assigned to this technician: a permanent
    // refusal, not a transient one.
    if (!job || (profile.role === "tech" && job.assigned_to !== user.id)) { rejected.push(clientEventId); continue; }

    const now = new Date().toISOString();
    const values = action === "start"
      ? { status: "in_progress", stage: progressStage, started_at: now }
      : { status: "done", stage: doneStage, completed_at: now };

    const { error } = await supabase.from("jobs").update(values).eq("id", jobId);
    if (error) continue; // transient — allow a retry

    // Close any clock this technician left running, matching completeJob.
    if (action === "complete") {
      const { error: clockError } = await supabase.from("job_time_entries")
        .update({ ended_at: now }).eq("job_id", jobId).eq("user_id", user.id).is("ended_at", null);
      if (clockError) console.error(`[sync] failed to close time entries for job ${jobId}:`, clockError.message);
    }

    const { error: receiptError } = await supabase.from("sync_outbox_receipts").insert({
      organization_id: profile.organization_id, profile_id: user.id,
      client_event_id: clientEventId, job_id: jobId, action_type: action,
    });
    if (!receiptError || receiptError.code === "23505") processed.push(clientEventId);
  }

  return NextResponse.json({ ok: true, processed, rejected });
}
