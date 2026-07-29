import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { providers, createCheckoutUrl } from "@/lib/providers";

export const dynamic = "force-dynamic";

/**
 * Public "Pay now" redirect. Looks up the invoice by its opaque token,
 * creates a Stripe Checkout session, and sends the customer to Stripe.
 * If Stripe isn't configured, it just returns them to the document page.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = new URL(request.url).origin;
  const back = `${origin}/p/${token}`;
  if (!providers.stripe()) return NextResponse.redirect(back);

  const isDeposit = new URL(request.url).searchParams.get("deposit") === "1";
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_document", { p_token: token });
  const doc: any = data;
  if (!doc) return NextResponse.redirect(back);

  // Deposit on an estimate, or full payment on an invoice.
  const deposit = doc.deposit_minor ?? 0;
  const payingDeposit = isDeposit && doc.kind === "estimate" && deposit > 0;
  const payingInvoice = doc.kind === "invoice" && doc.status !== "paid" && doc.total_minor > 0;
  if (!payingDeposit && !payingInvoice) return NextResponse.redirect(back);

  const amount = payingDeposit ? deposit : doc.total_minor;
  const label = payingDeposit ? `Deposit — Estimate #${doc.number}` : `Invoice #${doc.number}`;

  try {
    const url = await createCheckoutUrl({
      amountMinor: amount,
      currency: doc.currency ?? "USD",
      description: `${doc.org?.name ?? ""} — ${label}`,
      successUrl: `${back}?paid=1`,
      cancelUrl: back,
      metadata: { token: token, kind: payingDeposit ? "deposit" : "invoice" },
    });
    return NextResponse.redirect(url);
  } catch {
    return NextResponse.redirect(back);
  }
}
