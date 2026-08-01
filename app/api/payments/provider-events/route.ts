import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHelcimWebhook } from "@/lib/payments/helcim";
import { reconcileHelcimTransaction } from "@/lib/payments/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const verifierToken = process.env.HELCIM_PAYMENT_WEBHOOK_VERIFIER;
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

  let body: { id?: unknown; type?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid json" }, { status: 400 });
  }
  const transactionId =
    typeof body.id === "string" || typeof body.id === "number" ? String(body.id) : "";
  if (!transactionId) return NextResponse.json({ ok: true, ignored: true });

  const admin = createAdminClient();
  const { data: duplicate } = await admin
    .from("payment_events")
    .select("id")
    .eq("provider", "helcim")
    .eq("provider_event_id", webhookId)
    .maybeSingle();
  if (duplicate) return NextResponse.json({ ok: true, duplicate: true });

  try {
    const result = await reconcileHelcimTransaction(transactionId);
    await admin.from("payment_events").insert({
      organization_id: result?.organizationId ?? null,
      provider: "helcim",
      provider_event_id: webhookId,
      event_type: typeof body.type === "string" ? body.type : "transaction",
      payload_digest: crypto.createHash("sha256").update(rawBody).digest("hex"),
      sanitized_data: result?.transaction ?? { transactionId },
      status: result ? "processed" : "needs_review",
      processed_at: result ? new Date().toISOString() : null,
    });
    return NextResponse.json({ ok: true, matched: !!result });
  } catch {
    return NextResponse.json({ ok: false, reason: "reconciliation failed" }, { status: 503 });
  }
}
