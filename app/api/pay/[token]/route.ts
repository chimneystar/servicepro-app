import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { providers, createCheckoutUrl } from "@/lib/providers";

export const dynamic = "force-dynamic";

/**
 * Public "Pay now" redirect. Looks up the invoice by its opaque token,
 * creates a Stripe Checkout session, and sends the customer to Stripe.
 * If Stripe isn't configured, it just returns them to the document page.
 */
export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  const origin = new URL(request.url).origin;
  const back = `${origin}/p/${params.token}`;
  if (!providers.stripe()) return NextResponse.redirect(back);

  const supabase = createClient();
  const { data } = await supabase.rpc("public_document", { p_token: params.token });
  const doc: any = data;
  if (!doc || doc.kind !== "invoice" || doc.status === "paid" || !doc.total_minor) {
    return NextResponse.redirect(back);
  }

  try {
    const url = await createCheckoutUrl({
      amountMinor: doc.total_minor,
      currency: doc.currency ?? "USD",
      description: `${doc.org?.name ?? "Invoice"} — Invoice #${doc.number}`,
      successUrl: `${back}?paid=1`,
      cancelUrl: back,
      metadata: { token: params.token, kind: "invoice" },
    });
    return NextResponse.redirect(url);
  } catch {
    return NextResponse.redirect(back);
  }
}
