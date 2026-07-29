import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Verify Stripe's signature header without the SDK (HMAC-SHA256, half-open compare). */
function verify(payload: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const t = parts["t"]; const v1 = parts["v1"];
  if (!t || !v1) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1)); } catch { return false; }
}

/**
 * Stripe webhook: when a Checkout session completes, mark the matching invoice
 * paid and record the payment. Idempotent — re-delivery won't double-record.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ ok: false, reason: "not configured" }, { status: 200 });

  const raw = await request.text();
  if (!verify(raw, request.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ ok: false, reason: "bad signature" }, { status: 400 });
  }

  let event: any;
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  if (event?.type !== "checkout.session.completed") return NextResponse.json({ ok: true, ignored: true });

  const session = event.data?.object ?? {};
  const token = session?.metadata?.token;
  const payKind = session?.metadata?.kind;
  if (!token) return NextResponse.json({ ok: true, ignored: true });

  let admin;
  try { admin = createAdminClient(); } catch { return NextResponse.json({ ok: false, reason: "no service role" }, { status: 200 }); }

  // Deposit paid against an ESTIMATE — record a standalone payment.
  if (payKind === "deposit") {
    const { data: est } = await admin.from("estimates").select("id, number, organization_id").eq("public_token", token).maybeSingle();
    if (est) {
      const { data: dup } = await admin.from("payments").select("id").eq("stripe_payment_intent_id", session.payment_intent ?? "__none__").limit(1);
      if (!dup || dup.length === 0) {
        await admin.from("payments").insert({
          organization_id: est.organization_id, invoice_id: null,
          amount_minor: session.amount_total ?? 0, currency: (session.currency ?? "usd").toUpperCase(),
          status: "paid", method: "Credit card", reference: session.payment_intent ?? null, note: `Deposit for estimate #${est.number}`,
          stripe_payment_intent_id: session.payment_intent ?? null, paid_at: new Date().toISOString(),
        });
      }
    }
    return NextResponse.json({ ok: true });
  }

  const { data: inv } = await admin.from("invoices").select("id, organization_id, total_minor, status, stripe_session_id").eq("public_token", token).maybeSingle();
  if (!inv) return NextResponse.json({ ok: true, ignored: true });
  if (inv.stripe_session_id === session.id) return NextResponse.json({ ok: true, already: true }); // idempotent

  await admin.from("invoices").update({
    status: "paid", paid_at: new Date().toISOString(), paid_online: true, stripe_session_id: session.id,
  }).eq("id", inv.id);

  await admin.from("payments").insert({
    organization_id: inv.organization_id, invoice_id: inv.id,
    amount_minor: session.amount_total ?? inv.total_minor, currency: (session.currency ?? "usd").toUpperCase(),
    status: "paid", method: "Credit card", reference: session.payment_intent ?? null,
    stripe_payment_intent_id: session.payment_intent ?? null, paid_at: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
