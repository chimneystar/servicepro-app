import { NextResponse, type NextRequest } from "next/server";
import { PaymentError, submitManualPayment } from "@/lib/payments/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const token = typeof body.token === "string" ? body.token : "";
    const method = body.method === "zelle" || body.method === "check" ? body.method : null;
    if (!/^[0-9a-f-]{36}$/i.test(token) || !method) throw new PaymentError("Invalid payment submission", "invalid_submission");
    const result = await submitManualPayment({
      publicDocumentToken: token,
      method,
      reference: typeof body.reference === "string" ? body.reference : undefined,
      mailedOn: typeof body.mailedOn === "string" ? body.mailedOn : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const paymentError = error instanceof PaymentError ? error : new PaymentError("Could not record payment", "unexpected", 500);
    return NextResponse.json({ ok: false, code: paymentError.code, error: paymentError.message }, { status: paymentError.status });
  }
}

