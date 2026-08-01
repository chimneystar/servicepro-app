import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { formRecord, validateTwilioSignature, webhookUrl } from "@/lib/voice-provider";
// @ts-ignore - shared pure JavaScript is also exercised directly by Node tests.
import { callNeedsFollowUp, mapVoiceStatus } from "@/lib/core/calls.mjs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return twiml(503);
  const form = await request.formData();
  const params = formRecord(form);
  if (
    !validateTwilioSignature(
      webhookUrl(request.url),
      params,
      request.headers.get("x-twilio-signature"),
      token,
    )
  )
    return twiml(403);
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return twiml(503);
  }
  const callSid = params.CallSid || params.ParentCallSid;
  if (!callSid) return twiml(400);
  const { data: call } = await admin
    .from("call_events")
    .select("id,status")
    .eq("provider", "twilio")
    .eq("provider_call_id", callSid)
    .limit(1)
    .maybeSingle();
  if (!call) return twiml(200);
  const providerStatus = params.DialCallStatus || params.CallStatus || params.RecordingStatus;
  const status = mapVoiceStatus(providerStatus, "inbound");
  const seconds = Math.max(
    0,
    Math.round(
      Number(params.DialCallDuration || params.CallDuration || params.RecordingDuration || 0),
    ),
  );
  const update: TablesUpdate<"call_events"> = {
    status,
    duration_seconds: Number.isFinite(seconds) ? seconds : 0,
    needs_follow_up: callNeedsFollowUp(status),
    ended_at: ["completed", "missed", "failed", "voicemail"].includes(status)
      ? new Date().toISOString()
      : null,
  };
  if (status === "in_progress" || status === "completed")
    update.answered_at = new Date().toISOString();
  if (params.RecordingUrl && params.RecordingStatus !== "absent") {
    update.recording_url = params.RecordingUrl;
    update.recording_consent = true;
  }
  await admin.from("call_events").update(update).eq("id", call.id);
  return twiml(200);
}

function twiml(status: number) {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status,
    headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" },
  });
}
