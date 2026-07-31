import { NextResponse, type NextRequest } from "next/server";
import { PaymentError, startHelcimCheckout } from "@/lib/payments/server";
// @ts-ignore — proven both ways in tests/rate-limit.test.mjs
import { consume, clientKey } from "@/lib/core/rate-limit.mjs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { token?: unknown };
    const token = typeof body.token === "string" ? body.token : "";
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw new PaymentError("Invalid payment link", "invalid_token");

    // Unauthenticated, and every call makes an outbound request to Helcim. It
    // had no throttle at all: a loop against a known payment link could run up
    // the merchant's API usage and spam checkout sessions.
    const limit = consume(`pay:init:${clientKey(request.headers)}:${token}`, 10, 60_000);
    if (!limit.allowed) {
      throw new PaymentError("Too many attempts. Please wait a moment and try again.", "rate_limited", 429);
    }

    return NextResponse.json({ ok: true, ...(await startHelcimCheckout(token)) });
  } catch (error) {
    const paymentError = error instanceof PaymentError ? error : new PaymentError("Could not start payment", "unexpected", 500);
    return NextResponse.json({ ok: false, code: paymentError.code, error: paymentError.message }, { status: paymentError.status });
  }
}
