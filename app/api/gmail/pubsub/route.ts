import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/integrations/crypto";
import { syncGmailHistory } from "@/lib/integrations/gmail";
import type { IntegrationConnection } from "@/lib/integrations/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const expected = process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN;
  const provided = new URL(request.url).searchParams.get("token") ?? "";
  if (!expected || !safeEqual(expected, provided)) return NextResponse.json({ ok: false }, { status: 403 });
  const envelope = await request.json().catch(() => null);
  const messageId = String(envelope?.message?.messageId ?? "");
  let notification: { emailAddress?: string; historyId?: string } = {};
  try { notification = JSON.parse(Buffer.from(String(envelope?.message?.data ?? ""), "base64").toString("utf8")); } catch { /* handled below */ }
  if (!messageId || !notification.emailAddress || !notification.historyId) return NextResponse.json({ ok: false }, { status: 400 });
  const admin = createAdminClient();
  const { data: existing } = await admin.from("provider_webhook_events").select("id").eq("provider", "gmail").eq("provider_event_id", messageId).maybeSingle();
  if (existing) return NextResponse.json({ ok: true, duplicate: true });
  const { data: connection } = await admin.from("integration_connections")
    .select("id, organization_id, provider, status, external_account_id, encrypted_credentials, metadata, error_message, connected_at, last_synced_at")
    .eq("provider", "gmail").eq("metadata->>email", notification.emailAddress.toLowerCase()).maybeSingle();
  if (!connection) return NextResponse.json({ ok: true, ignored: true });
  await admin.from("provider_webhook_events").insert({ organization_id: connection.organization_id, provider: "gmail", provider_event_id: messageId, event_type: "mailbox_update", status: "processing" });
  try {
    await syncGmailHistory(admin, connection as IntegrationConnection, notification.historyId);
    await admin.from("provider_webhook_events").update({ status: "processed", processed_at: new Date().toISOString() }).eq("provider", "gmail").eq("provider_event_id", messageId);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    const message = String(error?.message ?? error).slice(0, 300);
    await admin.from("provider_webhook_events").update({ status: "failed", error_message: message, processed_at: new Date().toISOString() }).eq("provider", "gmail").eq("provider_event_id", messageId);
    await admin.from("integration_connections").update({ status: "error", error_message: message, updated_at: new Date().toISOString() }).eq("id", connection.id);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
