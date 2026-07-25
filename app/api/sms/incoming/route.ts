import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Twilio inbound-SMS webhook. Point your Twilio number's "A message comes in"
 * URL here. Logs the incoming text against the matching customer's org so it
 * shows up in the Messages inbox. Requires SUPABASE_SERVICE_ROLE_KEY.
 */
export async function POST(request: NextRequest) {
  let admin;
  try { admin = createAdminClient(); } catch { return twiml(); }

  const form = await request.formData();
  const from = String(form.get("From") ?? "");
  const to = String(form.get("To") ?? "");
  const body = String(form.get("Body") ?? "");
  if (!from || !body) return twiml();

  const last10 = from.replace(/[^0-9]/g, "").slice(-10);
  // Find the customer (and therefore org) this number belongs to.
  const { data: customers } = await admin.from("customers").select("organization_id, phone").not("phone", "is", null);
  const match = (customers ?? []).find((c: any) => (c.phone ?? "").replace(/[^0-9]/g, "").slice(-10) === last10);
  let orgId = match?.organization_id as string | undefined;
  if (!orgId) { const { data: org } = await admin.from("organizations").select("id").limit(1).maybeSingle(); orgId = org?.id; }
  if (!orgId) return twiml();

  await admin.from("sms_messages").insert({
    organization_id: orgId, direction: "inbound", from_phone: from, to_phone: to, body,
    provider: "twilio", status: "received", created_at: new Date().toISOString(),
  });
  return twiml();
}

function twiml() {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { "Content-Type": "text/xml" } });
}
