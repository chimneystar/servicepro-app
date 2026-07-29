import { NextResponse, type NextRequest } from "next/server";
import { PaymentError, startHelcimCheckout } from "@/lib/payments/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { token?: unknown };
    const token = typeof body.token === "string" ? body.token : "";
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw new PaymentError("Invalid payment link", "invalid_token");
    return NextResponse.json({ ok: true, ...(await startHelcimCheckout(token)) });
  } catch (error) {
    const paymentError = error instanceof PaymentError ? error : new PaymentError("Could not start payment", "unexpected", 500);
    return NextResponse.json({ ok: false, code: paymentError.code, error: paymentError.message }, { status: paymentError.status });
  }
}
