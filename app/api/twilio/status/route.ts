import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { twilioCredentials, verifyTwilioSignature } from "@/lib/integrations/twilio";
import { integrationAppUrl } from "@/lib/integrations/url";
import type { IntegrationConnection } from "@/lib/integrations/types";

export const dynamic = "force-dynamic";

const statusMap: Record<string, string> = {
  accepted: "queued", scheduled: "queued", queued: "queued", sending: "queued",
  sent: "sent", delivered: "delivered", undelivered: "failed", failed: "failed",
};

export async function POST(request: NextRequest) {
  const params = new URLSearchParams(await request.text());
  const sid = params.get("MessageSid") ?? "";
  const admin = createAdminClient();
  const { data: communication } = await admin.from("communications").select("id, organization_id").eq("provider", "twilio").eq("provider_message_id", sid).maybeSingle();
  if (!communication) return NextResponse.json({ ok: true, ignored: true });
  const { data: connection } = await admin.from("integration_connections")
    .select("id, organization_id, provider, status, external_account_id, encrypted_credentials, metadata, error_message, connected_at, last_synced_at")
    .eq("organization_id", communication.organization_id).eq("provider", "twilio").maybeSingle();
  if (!connection) return NextResponse.json({ ok: false }, { status: 404 });
  const credentials = twilioCredentials(connection as IntegrationConnection);
  if (!verifyTwilioSignature({ authToken: credentials.authToken, signature: request.headers.get("x-twilio-signature"), url: `${integrationAppUrl()}/api/twilio/status`, params })) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  const twilioStatus = params.get("MessageStatus") ?? "";
  const status = statusMap[twilioStatus] ?? "queued";
  await admin.from("communications").update({
    status,
    delivered_at: status === "delivered" ? new Date().toISOString() : null,
    error_message: status === "failed" ? `${params.get("ErrorCode") ?? "Twilio delivery failure"}: ${params.get("ErrorMessage") ?? "Message was not delivered"}`.slice(0, 300) : null,
  }).eq("id", communication.id);
  return NextResponse.json({ ok: true });
}
