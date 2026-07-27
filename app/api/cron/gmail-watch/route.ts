import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { registerGmailWatch } from "@/lib/integrations/gmail";
import type { IntegrationConnection } from "@/lib/integrations/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false }, { status: 401 });
  const admin = createAdminClient();
  const { data: connections } = await admin.from("integration_connections")
    .select("id, organization_id, provider, status, external_account_id, encrypted_credentials, metadata, error_message, connected_at, last_synced_at")
    .eq("provider", "gmail").in("status", ["connected", "action_required"]);
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const row of connections ?? []) {
    try {
      const connection = row as IntegrationConnection;
      const watch = await registerGmailWatch(connection);
      await admin.from("integration_connections").update({
        status: "connected", metadata: { ...(connection.metadata ?? {}), history_id: watch.historyId, watch_expiration: watch.expiration },
        error_message: null, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", connection.id);
      results.push({ id: connection.id, ok: true });
    } catch (error: any) {
      const message = String(error?.message ?? error).slice(0, 180);
      await admin.from("integration_connections").update({ status: "error", error_message: message, updated_at: new Date().toISOString() }).eq("id", row.id);
      results.push({ id: row.id, ok: false, error: message });
    }
  }
  return NextResponse.json({ ok: results.every((item) => item.ok), results });
}
