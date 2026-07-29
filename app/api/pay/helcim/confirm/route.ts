import { NextResponse, type NextRequest } from "next/server";
import { confirmHelcimCheckout, PaymentError } from "@/lib/payments/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const requestToken = typeof body.requestToken === "string" ? body.requestToken : "";
    const checkoutToken = typeof body.checkoutToken === "string" ? body.checkoutToken : "";
    if (!requestToken || !checkoutToken || body.eventMessage === undefined) {
      throw new PaymentError("Invalid payment response", "invalid_response");
    }
    return NextResponse.json({ ok: true, ...(await confirmHelcimCheckout({ requestToken, checkoutToken, eventMessage: body.eventMessage })) });
  } catch (error) {
    const paymentError = error instanceof PaymentError ? error : new PaymentError("Could not confirm payment", "unexpected", 500);
    return NextResponse.json({ ok: false, code: paymentError.code, error: paymentError.message }, { status: paymentError.status });
  }
}
