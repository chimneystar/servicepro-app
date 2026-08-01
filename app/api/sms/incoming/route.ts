import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formRecord, validateTwilioSignature, webhookUrl } from "@/lib/voice-provider";
// @ts-ignore - shared pure JavaScript is also exercised directly by Node tests.
import { normalizeUsPhone } from "@/lib/core/calls.mjs";
// @ts-ignore - proven both ways in tests/security.test.mjs
import { isSmsOptOut, isSmsOptIn } from "@/lib/core/security.mjs";
import * as backendData from "@/lib/data/backend";

export const dynamic = "force-dynamic";

/**
 * Twilio inbound-SMS webhook. Point your Twilio number's "A message comes in"
 * URL here. Logs the incoming text against the owning organisation so it shows
 * up in that business's Messages inbox.
 *
 * SECURITY — this route previously had three defects, all fixed here:
 *   1. No signature validation at all, so anyone could forge inbound messages.
 *      (The sibling voice webhooks always validated; this one did not.)
 *   2. It scanned EVERY customer row in the entire platform with the
 *      service-role client to guess an organisation.
 *   3. On no match it filed the message under `organizations.limit(1)` — an
 *      arbitrary business.
 *
 * The organisation is now resolved the same way /api/calls/incoming resolves
 * it: from the tracked phone number the message was sent TO. If that number is
 * not registered we drop the message rather than guess a tenant.
 *
 * Requires TWILIO_AUTH_TOKEN and SUPABASE_SERVICE_ROLE_KEY.
 */
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
  ) {
    return twiml(403);
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return twiml(503);
  }

  const from = String(params.From ?? "");
  const to = String(params.To ?? "");
  const body = String(params.Body ?? "");
  if (!from || !to || !body) return twiml();

  // Resolve the tenant from the number the customer texted, never by scanning.
  const { data: tracked } = await admin
    .from("tracked_phone_numbers")
    .select("organization_id")
    .eq("phone_number", normalizeUsPhone(to))
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (!tracked?.organization_id) {
    // Unregistered number: accept the webhook so Twilio stops retrying, but
    // record nothing. Filing it under a guessed organisation is worse than
    // dropping it.
    console.warn(`[sms/incoming] no active tracked number for ${to}; message dropped`);
    return twiml();
  }

  const organizationId = tracked.organization_id as string;
  const normalizedFrom = normalizeUsPhone(from);

  // Customer lookup is scoped to the resolved organisation. A failure here
  // must not drop the inbound message — it only means it is recorded without
  // a matched customer, the same outcome an unrecognised sender already
  // produces.
  let customers: Awaited<ReturnType<typeof backendData.listCustomerPhonesWithPhoneForOrg>> = [];
  try {
    customers = await backendData.listCustomerPhonesWithPhoneForOrg(admin, organizationId);
  } catch (e: unknown) {
    console.error(
      "[sms/incoming] could not read the customer list to match the sender:",
      e instanceof Error ? e.message : String(e),
    );
  }
  const customer = customers.find(
    (row: { id: string; phone: string | null }) =>
      normalizeUsPhone(row.phone ?? "") === normalizedFrom,
  );

  // A customer replying STOP must not keep receiving reminders; START re-subscribes.
  // Both matchers are proven in both directions in tests/security.test.mjs.
  if (customer?.id) {
    if (isSmsOptOut(body)) {
      await admin
        .from("customers")
        .update({ sms_opt_in: false })
        .eq("id", customer.id)
        .eq("organization_id", organizationId);
    } else if (isSmsOptIn(body)) {
      await admin
        .from("customers")
        .update({ sms_opt_in: true })
        .eq("id", customer.id)
        .eq("organization_id", organizationId);
    }
  }

  const { error } = await admin.from("sms_messages").insert({
    organization_id: organizationId,
    direction: "inbound",
    from_phone: from,
    to_phone: to,
    body,
    provider: "twilio",
    status: "received",
    created_at: new Date().toISOString(),
  });
  if (error) console.error("[sms/incoming] failed to record message:", error.message);

  return twiml();
}

function twiml(status = 200) {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status,
    headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" },
  });
}
