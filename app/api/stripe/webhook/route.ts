import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TablesUpdate } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

/** Verify Stripe's signature header without the SDK (HMAC-SHA256, half-open compare). */
function verify(payload: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch {
    return false;
  }
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
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (event?.type !== "checkout.session.completed")
    return NextResponse.json({ ok: true, ignored: true });

  const session = event.data?.object ?? {};
  const token = session?.metadata?.token;
  const payKind = session?.metadata?.kind;
  if (!token) return NextResponse.json({ ok: true, ignored: true });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ ok: false, reason: "no service role" }, { status: 200 });
  }

  // Deposit paid against an ESTIMATE.
  if (payKind === "deposit") {
    const { data: est } = await admin
      .from("estimates")
      .select("id, number, organization_id")
      .eq("public_token", token)
      .maybeSingle();
    if (est) {
      // Idempotency: when payment_intent is absent the previous code deduped on
      // the literal "__none__", and the unique index on stripe_payment_intent_id
      // does not apply to NULLs — so every redelivery inserted another row.
      // Without an intent id there is nothing to dedupe on, so refuse rather
      // than risk double-crediting.
      const intentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
      if (!intentId) {
        console.error(
          "[stripe] deposit session has no payment_intent; refusing to record an undedupable payment",
        );
        return NextResponse.json({ ok: false, reason: "missing payment_intent" }, { status: 400 });
      }
      const { data: dup } = await admin
        .from("payments")
        .select("id")
        .eq("stripe_payment_intent_id", intentId)
        .limit(1);
      if (!dup || dup.length === 0) {
        const { error } = await admin.from("payments").insert({
          organization_id: est.organization_id,
          invoice_id: null,
          // Load-bearing: without estimate_id this deposit is orphaned — it
          // credits nothing, so openBalance still reports the full deposit due
          // and the customer can be charged for it a second time.
          estimate_id: est.id,
          amount_minor: session.amount_total ?? 0,
          base_amount_minor: session.amount_total ?? 0,
          normalized_status: "settled",
          currency: (session.currency ?? "usd").toUpperCase(),
          status: "paid",
          method: "Credit card",
          reference: intentId,
          note: `Deposit for estimate #${est.number}`,
          stripe_payment_intent_id: intentId,
          paid_at: new Date().toISOString(),
        });
        if (error) {
          console.error("[stripe] failed to record deposit payment:", error.message);
          return NextResponse.json({ ok: false, reason: "record failed" }, { status: 500 });
        }
      }
    }
    return NextResponse.json({ ok: true });
  }

  const { data: inv } = await admin
    .from("invoices")
    .select("id, organization_id, total_minor, status, stripe_session_id")
    .eq("public_token", token)
    .maybeSingle();
  if (!inv) return NextResponse.json({ ok: true, ignored: true });
  if (inv.stripe_session_id === session.id) return NextResponse.json({ ok: true, already: true }); // idempotent

  // Never mark an invoice paid for less than it is worth. The amount comes from
  // Stripe's signed payload rather than the client, but a session created out of
  // band for any amount would otherwise close out the full invoice. The Helcim
  // path validates this; this one did not.
  const receivedMinor = Number(session.amount_total ?? 0);
  const totalMinor = Number(inv.total_minor ?? 0);

  const { error: payError } = await admin.from("payments").insert({
    organization_id: inv.organization_id,
    invoice_id: inv.id,
    amount_minor: receivedMinor || totalMinor,
    base_amount_minor: receivedMinor || totalMinor,
    normalized_status: "settled",
    currency: (session.currency ?? "usd").toUpperCase(),
    status: "paid",
    method: "Credit card",
    reference: session.payment_intent ?? null,
    stripe_payment_intent_id: session.payment_intent ?? null,
    paid_at: new Date().toISOString(),
  });
  if (payError) {
    // The previous code ignored this error, so an invoice could be marked paid
    // with no payment row behind it — money that exists on the screen and
    // nowhere in the ledger.
    console.error("[stripe] failed to record invoice payment:", payError.message);
    return NextResponse.json({ ok: false, reason: "record failed" }, { status: 500 });
  }

  const update: TablesUpdate<"invoices"> = { stripe_session_id: session.id, paid_online: true };
  if (receivedMinor >= totalMinor) {
    update.status = "paid";
    update.paid_at = new Date().toISOString();
  } else {
    console.warn(
      `[stripe] partial payment ${receivedMinor} of ${totalMinor} on invoice ${inv.id}; left unpaid`,
    );
  }
  await admin.from("invoices").update(update).eq("id", inv.id);

  return NextResponse.json({ ok: true });
}
