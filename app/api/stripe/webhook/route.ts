import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function verify(payload: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const values = header.split(",").map((part) => part.trim());
  const timestamp = values.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = values.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || signatures.length === 0) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest();
  return signatures.some((value) => {
    try {
      const received = Buffer.from(value, "hex");
      return received.length === expected.length && crypto.timingSafeEqual(received, expected);
    } catch { return false; }
  });
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ ok: false, reason: "not configured" }, { status: 503 });
  const raw = await request.text();
  if (!verify(raw, request.headers.get("stripe-signature"), secret)) return NextResponse.json({ ok: false, reason: "bad signature" }, { status: 400 });
  let event: any;
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const eventId = String(event?.id ?? "");
  if (!eventId) return NextResponse.json({ ok: false }, { status: 400 });
  const admin = createAdminClient();
  const { data: duplicate } = await admin.from("provider_webhook_events").select("id").eq("provider", "stripe").eq("provider_event_id", eventId).maybeSingle();
  if (duplicate) return NextResponse.json({ ok: true, duplicate: true });

  const connectedAccountId = String(event?.account ?? "");
  const { data: connection } = connectedAccountId
    ? await admin.from("integration_connections").select("organization_id").eq("provider", "stripe").eq("external_account_id", connectedAccountId).maybeSingle()
    : { data: null };
  await admin.from("provider_webhook_events").insert({
    organization_id: connection?.organization_id ?? null,
    provider: "stripe", provider_event_id: eventId, event_type: event.type ?? null, status: "processing",
  });
  try {
    if (event.type === "account.updated" && connectedAccountId) {
      const account = event.data?.object ?? {};
      await admin.from("integration_connections").update({
        status: account.charges_enabled && account.details_submitted ? "connected" : "action_required",
        metadata: { charges_enabled: !!account.charges_enabled, payouts_enabled: !!account.payouts_enabled, details_submitted: !!account.details_submitted, requirements_due: account.requirements?.currently_due ?? [] },
        error_message: account.charges_enabled ? null : "Stripe needs more business information.",
        updated_at: new Date().toISOString(),
      }).eq("provider", "stripe").eq("external_account_id", connectedAccountId);
    } else if (event.type === "checkout.session.completed") {
      await reconcileCheckout(admin, event.data?.object ?? {}, connectedAccountId);
    }
    await admin.from("provider_webhook_events").update({ status: "processed", processed_at: new Date().toISOString() }).eq("provider", "stripe").eq("provider_event_id", eventId);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    await admin.from("provider_webhook_events").update({ status: "failed", error_message: String(error?.message ?? error).slice(0, 300), processed_at: new Date().toISOString() }).eq("provider", "stripe").eq("provider_event_id", eventId);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

async function reconcileCheckout(admin: any, session: any, connectedAccountId: string) {
  const token = session?.metadata?.token;
  const payKind = session?.metadata?.kind;
  const metadataOrg = session?.metadata?.servicepro_organization_id;
  if (!token || !connectedAccountId) return;

  if (payKind === "deposit") {
    const { data: estimate } = await admin.from("estimates").select("id, number, organization_id").eq("public_token", token).maybeSingle();
    if (!estimate || estimate.organization_id !== metadataOrg) return;
    if (!(await accountBelongsTo(admin, connectedAccountId, estimate.organization_id))) throw new Error("Connected account mismatch");
    const { data: duplicate } = await admin.from("payments").select("id").eq("stripe_payment_intent_id", session.payment_intent ?? "__none__").maybeSingle();
    if (!duplicate) await admin.from("payments").insert({
      organization_id: estimate.organization_id, invoice_id: null,
      amount_minor: session.amount_total ?? 0, currency: (session.currency ?? "usd").toUpperCase(),
      status: "paid", method: "Credit card", reference: session.payment_intent ?? null,
      note: `Deposit for estimate #${estimate.number}`, stripe_payment_intent_id: session.payment_intent ?? null,
      paid_at: new Date().toISOString(),
    });
    return;
  }

  const { data: invoice } = await admin.from("invoices").select("id, organization_id, total_minor, stripe_session_id").eq("public_token", token).maybeSingle();
  if (!invoice || invoice.organization_id !== metadataOrg) return;
  if (!(await accountBelongsTo(admin, connectedAccountId, invoice.organization_id))) throw new Error("Connected account mismatch");
  if (invoice.stripe_session_id === session.id) return;
  const { data: duplicatePayment } = await admin.from("payments").select("id").eq("stripe_payment_intent_id", session.payment_intent ?? "__none__").maybeSingle();
  await admin.from("invoices").update({ status: "paid", paid_at: new Date().toISOString(), paid_online: true, stripe_session_id: session.id }).eq("id", invoice.id);
  if (!duplicatePayment) await admin.from("payments").insert({
    organization_id: invoice.organization_id, invoice_id: invoice.id,
    amount_minor: session.amount_total ?? invoice.total_minor, currency: (session.currency ?? "usd").toUpperCase(),
    status: "paid", method: "Credit card", reference: session.payment_intent ?? null,
    stripe_payment_intent_id: session.payment_intent ?? null, paid_at: new Date().toISOString(),
  });
}

async function accountBelongsTo(admin: any, accountId: string, organizationId: string) {
  const { data } = await admin.from("integration_connections").select("id").eq("organization_id", organizationId).eq("provider", "stripe").eq("external_account_id", accountId).maybeSingle();
  return !!data;
}
