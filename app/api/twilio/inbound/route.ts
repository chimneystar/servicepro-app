import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordCommunication, normalizePhone } from "@/lib/integrations/communications";
import { twilioCredentials, verifyTwilioSignature } from "@/lib/integrations/twilio";
import { integrationAppUrl } from "@/lib/integrations/url";
import type { IntegrationConnection } from "@/lib/integrations/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const params = new URLSearchParams(await request.text());
  const messageSid = params.get("MessageSid") ?? "";
  const to = normalizePhone(params.get("To") ?? "");
  const from = normalizePhone(params.get("From") ?? "");
  if (!messageSid || !to || !from) return new NextResponse("Invalid request", { status: 400 });
  const admin = createAdminClient();
  const { data: connection } = await admin.from("integration_connections")
    .select("id, organization_id, provider, status, external_account_id, encrypted_credentials, metadata, error_message, connected_at, last_synced_at")
    .eq("provider", "twilio").eq("metadata->>phone_number", to).maybeSingle();
  if (!connection) return new NextResponse("Unknown number", { status: 404 });
  const credentials = twilioCredentials(connection as IntegrationConnection);
  const valid = verifyTwilioSignature({
    authToken: credentials.authToken,
    signature: request.headers.get("x-twilio-signature"),
    url: `${integrationAppUrl()}/api/twilio/inbound`,
    params,
  });
  if (!valid) return new NextResponse("Invalid signature", { status: 403 });
  const { data: duplicate } = await admin.from("provider_webhook_events").select("id").eq("provider", "twilio").eq("provider_event_id", `inbound:${messageSid}`).maybeSingle();
  if (duplicate) return new NextResponse("<Response/>", { status: 200, headers: { "Content-Type": "text/xml" } });
  await admin.from("provider_webhook_events").insert({ organization_id: connection.organization_id, provider: "twilio", provider_event_id: `inbound:${messageSid}`, event_type: "incoming_message", status: "processing" });
  try {
    const { data: customers } = await admin.from("customers").select("id, phone").eq("organization_id", connection.organization_id).is("deleted_at", null);
    const customer = (customers ?? []).find((item: any) => normalizePhone(item.phone ?? "") === from);
    const recorded = await recordCommunication(admin, {
      organizationId: connection.organization_id,
      customerId: customer?.id ?? null,
      channel: "sms",
      direction: "inbound",
      status: "received",
      contactKey: from,
      fromAddress: from,
      toAddress: to,
      body: params.get("Body") ?? "",
      provider: "twilio",
      providerMessageId: messageSid,
      metadata: { num_media: Number(params.get("NumMedia") ?? 0) },
    });
    const mediaCount = Number(params.get("NumMedia") ?? 0);
    if (recorded?.id && mediaCount > 0) {
      const attachments = Array.from({ length: Math.min(mediaCount, 10) }, (_, index) => ({
        organization_id: connection.organization_id,
        communication_id: recorded.id,
        provider_attachment_id: params.get(`MediaUrl${index}`),
        filename: `text-message-attachment-${index + 1}`,
        content_type: params.get(`MediaContentType${index}`),
      }));
      await admin.from("communication_attachments").insert(attachments);
    }
    await admin.from("provider_webhook_events").update({ status: "processed", processed_at: new Date().toISOString() }).eq("provider", "twilio").eq("provider_event_id", `inbound:${messageSid}`);
    return new NextResponse("<Response/>", { status: 200, headers: { "Content-Type": "text/xml" } });
  } catch (error: any) {
    await admin.from("provider_webhook_events").update({ status: "failed", error_message: String(error?.message ?? error).slice(0, 300), processed_at: new Date().toISOString() }).eq("provider", "twilio").eq("provider_event_id", `inbound:${messageSid}`);
    return new NextResponse("Temporary failure", { status: 500 });
  }
}
