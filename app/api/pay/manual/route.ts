import { NextResponse, type NextRequest } from "next/server";
import { PaymentError, submitManualPayment } from "@/lib/payments/server";
// @ts-ignore — proven both ways in tests/rate-limit.test.mjs
import { consume, clientKey } from "@/lib/core/rate-limit.mjs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const token = typeof body.token === "string" ? body.token : "";
    const method = body.method === "zelle" || body.method === "check" ? body.method : null;
    if (!/^[0-9a-f-]{36}$/i.test(token) || !method)
      throw new PaymentError("Invalid payment submission", "invalid_submission");

    // Unauthenticated. Each call creates a manual payment claim for staff to
    // review, so an unthrottled loop floods the business's review queue.
    const limit = consume(`pay:manual:${clientKey(request.headers)}:${token}`, 5, 300_000);
    if (!limit.allowed) {
      throw new PaymentError(
        "Too many submissions. Please wait a few minutes.",
        "rate_limited",
        429,
      );
    }
    const result = await submitManualPayment({
      publicDocumentToken: token,
      method,
      reference: typeof body.reference === "string" ? body.reference : undefined,
      mailedOn: typeof body.mailedOn === "string" ? body.mailedOn : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const paymentError =
      error instanceof PaymentError
        ? error
        : new PaymentError("Could not record payment", "unexpected", 500);
    return NextResponse.json(
      { ok: false, code: paymentError.code, error: paymentError.message },
      { status: paymentError.status },
    );
  }
}
