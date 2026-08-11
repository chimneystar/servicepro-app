import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptPaymentSecret } from "@/lib/payments/crypto";
import { safeHelcimTransaction, verifyHelcimWebhook } from "@/lib/payments/helcim";

export const dynamic = "force-dynamic";

function connectionStatus(event: string) {
  const normalized = event.toLowerCase();
  if (normalized === "approved") return "approved";
  if (normalized === "rejected" || normalized === "declined") return "rejected";
  if (normalized.includes("action")) return "action_required";
  return "under_review";
}

export async function POST(request: NextRequest) {
  const verifierToken = process.env.HELCIM_CONNECTED_WEBHOOK_VERIFIER;
  if (!verifierToken)
    return NextResponse.json({ ok: false, reason: "not configured" }, { status: 503 });
  const rawBody = await request.text();
  const webhookId = request.headers.get("webhook-id");
  const valid = verifyHelcimWebhook({
    rawBody,
    webhookId,
    timestamp: request.headers.get("webhook-timestamp"),
    signature: request.headers.get("webhook-signature"),
    verifierToken,
  });
  // `|| !webhookId` is a no-op at runtime: verifyHelcimWebhook returns false
  // when the header is missing, so this branch was already taken. Stating it
  // here is what lets the compiler see that `provider_event_id` — NOT NULL in
  // `payment_events` — cannot be null below, and removes the two `!` the
  // insert and the duplicate check needed.
  if (!valid || !webhookId)
    return NextResponse.json({ ok: false, reason: "bad signature" }, { status: 400 });

  let body: { apiToken?: unknown; event?: unknown; connectedAccountId?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid json" }, { status: 400 });
  }
  const organizationId = typeof body.connectedAccountId === "string" ? body.connectedAccountId : "";
  const event = typeof body.event === "string" ? body.event : "";
  if (!/^[0-9a-f-]{36}$/i.test(organizationId) || !event) {
    return NextResponse.json({ ok: false, reason: "invalid account" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: duplicate } = await admin
    .from("payment_events")
    .select("id")
    .eq("provider", "helcim")
    .eq("provider_event_id", webhookId)
    .maybeSingle();
  if (duplicate) return NextResponse.json({ ok: true, duplicate: true });

  const status = connectionStatus(event);
  const now = new Date().toISOString();
  const { error: connectionError } = await admin.from("merchant_connections").upsert(
    {
      organization_id: organizationId,
      connected_account_id: organizationId,
      status,
      card_enabled: status === "approved",
      ach_enabled: status === "approved",
      fee_saver_eligible: status === "approved",
      approved_at: status === "approved" ? now : null,
      last_webhook_at: now,
    },
    { onConflict: "organization_id" },
  );
  if (connectionError)
    return NextResponse.json({ ok: false, reason: "connection update failed" }, { status: 503 });

  if (status === "approved" && typeof body.apiToken === "string" && body.apiToken) {
    const encrypted = encryptPaymentSecret(body.apiToken);
    const { error } = await admin.from("merchant_secrets").upsert(
      {
        organization_id: organizationId,
        encrypted_api_token: encrypted,
        token_last_four: body.apiToken.slice(-4),
        rotated_at: now,
      },
      { onConflict: "organization_id" },
    );
    if (error)
      return NextResponse.json({ ok: false, reason: "secret storage failed" }, { status: 503 });
  }

  await admin.from("payment_events").insert({
    organization_id: organizationId,
    provider: "helcim",
    provider_event_id: webhookId,
    event_type: `connected_account_${event}`,
    payload_digest: crypto.createHash("sha256").update(rawBody).digest("hex"),
    sanitized_data: safeHelcimTransaction({ status: event }),
    status: "processed",
    processed_at: now,
  });
  return NextResponse.json({ ok: true });
}
