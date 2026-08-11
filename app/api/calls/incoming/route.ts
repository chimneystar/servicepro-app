import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formRecord, validateTwilioSignature, webhookUrl } from "@/lib/voice-provider";
// @ts-ignore - shared pure JavaScript is also exercised directly by Node tests.
import { escapeXml, normalizeUsPhone } from "@/lib/core/calls.mjs";
import * as backendData from "@/lib/data/backend";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return response("<Say>Phone service is not connected.</Say>", 503);
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
    return response("", 403);
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return response("<Say>Phone service is unavailable.</Say>", 503);
  }
  const from = normalizeUsPhone(params.From);
  const to = normalizeUsPhone(params.To);
  const callSid = params.CallSid;
  if (!from || !to || !callSid) return response("<Say>We could not connect this call.</Say>", 400);
  const { data: tracked } = await admin
    .from("tracked_phone_numbers")
    .select("id,organization_id,destination_number,recording_enabled,recording_notice_enabled")
    .eq("phone_number", to)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (!tracked) return response("<Say>This number is not active.</Say>", 404);
  // A failure here must not refuse to connect the call — it only means the
  // call is logged without a matched customer, which is the same outcome an
  // unrecognised caller already produces.
  let customers: Awaited<ReturnType<typeof backendData.listCustomerPhonesForOrg>> = [];
  try {
    customers = await backendData.listCustomerPhonesForOrg(admin, tracked.organization_id);
  } catch (e: unknown) {
    console.error(
      "[calls/incoming] could not read the customer list to match the caller:",
      e instanceof Error ? e.message : String(e),
    );
  }
  const customer = customers.find((row) => normalizeUsPhone(row.phone) === from);
  await admin.from("call_events").upsert(
    {
      organization_id: tracked.organization_id,
      provider: "twilio",
      provider_call_id: callSid,
      direction: "inbound",
      status: "ringing",
      from_number: from,
      to_number: to,
      tracked_number_id: tracked.id,
      customer_id: customer?.id ?? null,
      started_at: new Date().toISOString(),
      needs_follow_up: false,
    },
    { onConflict: "organization_id,provider,provider_call_id" },
  );
  const base =
    process.env.TWILIO_WEBHOOK_BASE_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  const destination = escapeXml(tracked.destination_number);
  const statusUrl = escapeXml(`${base}/api/calls/status`);
  const notice =
    tracked.recording_enabled && tracked.recording_notice_enabled
      ? "<Say>This call may be recorded for quality assurance.</Say>"
      : "";
  const recording = tracked.recording_enabled
    ? ` record="record-from-answer-dual" recordingStatusCallback="${statusUrl}" recordingStatusCallbackEvent="completed absent"`
    : "";
  return response(
    `${notice}<Dial action="${statusUrl}" method="POST" answerOnBridge="true"${recording}>${destination}</Dial>`,
  );
}

function response(body: string, status = 200) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status,
    headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" },
  });
}
